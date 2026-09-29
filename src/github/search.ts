import { Array, Duration, Effect, Option, Redacted, Schedule } from "effect";
import {
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { RateLimiter } from "effect/unstable/persistence";
import { GithubRepoSearchResponseSchema } from "../domain/github.ts";
import { Store, type CrawlCursor, type CrawlState } from "../store/store.ts";

/**
 * The GitHub crawl: the top TypeScript repositories by stars, through the
 * Repository Search endpoint. Search caps every query at 1000 results, so
 * the crawl walks star intervals: once a query runs out of pages, the next
 * one is bounded by the lowest star count seen (`stars:<=N`).
 *
 * Every page is committed together with the cursor of the next one, so an
 * interrupted crawl resumes at the page it stopped at, and a completed crawl
 * is not repeated (unless `--recrawl`, or a larger budget extends it).
 */

/**
 * Parses the URL of the `rel="next"` entry out of an RFC 8288 `Link` header
 * value. Returns `Option.none()` when there is no such entry, which is how
 * GitHub signals the last page.
 */
const parseNextLink = (header: string): Option.Option<string> =>
  Array.findFirst(header.split(","), (link) => link.includes('rel="next"')).pipe(
    Option.flatMap((link) => Option.fromUndefinedOr(/<([^>]+)>/.exec(link)?.[1])),
  );

const buildSearchUrl = (maxStars: number | null): string =>
  `https://api.github.com/search/repositories?${new URLSearchParams({
    q:
      maxStars === null
        ? "language:typescript fork:false archived:false"
        : `language:typescript fork:false archived:false stars:<=${maxStars}`,
    sort: "stars",
    order: "desc",
    per_page: "100",
    page: "1",
  })}`;

const initialCursor: CrawlCursor = {
  url: buildSearchUrl(null),
  lastSeenStars: null,
  intervalBound: null,
};

/**
 * GitHub's Search endpoint signals quota exhaustion with 403 responses (not
 * 429) carrying `retry-after` and/or `x-ratelimit-reset` headers. The delay
 * is the largest of the two server-indicated values (`retry-after` can be a
 * worthless 0 while the primary window is still exhausted); one minute is
 * the fallback when neither is present.
 */
const rateLimitDelay = (response: HttpClientResponse.HttpClientResponse): Duration.Duration => {
  const fromHeader = (name: string, toSeconds: (value: number) => number): number =>
    Headers.get(response.headers, name).pipe(
      Option.map(Number),
      Option.filter(Number.isFinite),
      Option.map(toSeconds),
      Option.getOrElse(() => 0),
    );
  const seconds = Math.max(
    fromHeader("retry-after", (s) => s + 1),
    fromHeader("x-ratelimit-reset", (epoch) => Math.max(epoch - Date.now() / 1000, 1)),
  );
  return seconds > 0 ? Duration.seconds(seconds) : Duration.minutes(1);
};

/** The cursor after a page: its `next` link, or the next star interval. */
const nextCursor = (
  cursor: CrawlCursor,
  nextPageUrl: Option.Option<string>,
  lastSeenStars: number | null,
): CrawlCursor | null => {
  if (Option.isSome(nextPageUrl)) {
    return { url: nextPageUrl.value, lastSeenStars, intervalBound: cursor.intervalBound };
  }
  if (lastSeenStars === null) return null;
  // If the whole interval was a single star count, the bound cannot stay
  // equal or the same query would be re-issued forever.
  const bound =
    cursor.intervalBound === null
      ? lastSeenStars
      : lastSeenStars < cursor.intervalBound
        ? lastSeenStars
        : lastSeenStars - 1;
  return bound >= 1
    ? { url: buildSearchUrl(bound), lastSeenStars: null, intervalBound: bound }
    : null;
};

export interface CrawlOptions {
  readonly budget: number;
  readonly apiKey: Redacted.Redacted<string>;
  readonly recrawl: boolean;
}

export interface CrawlSummary {
  readonly pages: number;
  readonly newRepos: number;
  readonly totalRepos: number;
  readonly skipped: boolean;
}

/**
 * Crawls until the store holds at least `budget` repositories and the
 * crawl has moved past the star count at rank `budget` (so ties at the
 * cut-off are all seen before the top-N is taken).
 */
export const runCrawl = (options: CrawlOptions) =>
  Effect.gen(function* () {
    const store = yield* Store;
    const limiter = yield* RateLimiter.RateLimiter;

    if (options.recrawl) yield* store.resetCrawl;

    const state = yield* store.crawlState;
    const already = yield* store.repoCount;

    if (Option.isSome(state) && state.value.complete && state.value.budget >= options.budget) {
      yield* Effect.log(
        `Crawl already complete for a budget of ${state.value.budget} (${already} repositories); skipped (--recrawl to redo)`,
      );
      return { pages: 0, newRepos: 0, totalRepos: already, skipped: true } satisfies CrawlSummary;
    }

    let cursor: CrawlCursor | null = Option.match(state, {
      onNone: () => initialCursor,
      onSome: (s) => s.cursor,
    });
    let pages = Option.match(state, { onNone: () => 0, onSome: (s) => s.pages });
    if (Option.isSome(state)) {
      yield* Effect.log(`Resuming the crawl at page ${pages + 1} (${already} repositories cached)`);
    }

    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.withRateLimiter({ limiter, key: "github-search", window: "1 minute", limit: 15 }),
      HttpClient.mapRequest(HttpClientRequest.bearerToken(options.apiKey)),
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({ schedule: Schedule.exponential(100), times: 3 }),
    );

    const fetchPage = (
      url: string,
      retriesLeft = 3,
    ): Effect.Effect<
      HttpClientResponse.HttpClientResponse,
      HttpClientError.HttpClientError | RateLimiter.RateLimiterError
    > =>
      client.get(url).pipe(
        Effect.catchIf(HttpClientError.isHttpClientError, (error) =>
          Effect.gen(function* () {
            const status = error.response?.status;
            if (
              retriesLeft <= 0 ||
              error.response === undefined ||
              (status !== 403 && status !== 429)
            ) {
              return yield* error;
            }
            const delay = rateLimitDelay(error.response);
            yield* Effect.log(
              `Rate limited (HTTP ${status}); retrying in ${Duration.toMillis(delay) / 1000}s`,
            );
            yield* Effect.sleep(delay);
            return yield* fetchPage(url, retriesLeft - 1);
          }),
        ),
      );

    let newRepos = 0;
    let complete = false;

    while (cursor !== null && !complete) {
      const current: CrawlCursor = cursor;
      const response = yield* fetchPage(current.url);
      const body = yield* HttpClientResponse.schemaBodyJson(GithubRepoSearchResponseSchema)(
        response,
      );
      pages++;

      if (current.lastSeenStars === null) {
        yield* Effect.log(
          `Starting interval ${current.intervalBound === null ? "any stars" : `stars<=${current.intervalBound}`}`,
        );
      }

      const lastSeenStars = Option.getOrElse(
        Option.map(Array.last(body.items), (repo) => repo.stargazersCount),
        () => current.lastSeenStars,
      );
      cursor = nextCursor(
        current,
        Headers.get(response.headers, "link").pipe(Option.flatMap(parseNextLink)),
        lastSeenStars,
      );

      const pageState: CrawlState = { cursor, complete: false, budget: options.budget, pages };
      newRepos += yield* store.saveCrawlPage(body.items, pageState);

      const total = yield* store.repoCount;
      const cutOff = yield* store.starsAtRank(options.budget);
      complete =
        cursor === null ||
        (cutOff !== undefined && lastSeenStars !== null && lastSeenStars < cutOff);

      yield* Effect.log(
        `Page ${pages}: +${body.items.length} repos, down to ★${lastSeenStars ?? 0}; ${total} cached` +
          (cutOff === undefined ? "" : `, cut-off ★${cutOff}`),
      );

      if (complete) yield* store.setCrawlState({ ...pageState, complete: true });
    }

    const totalRepos = yield* store.repoCount;
    yield* Effect.log(
      `Crawl complete: ${pages} pages, ${newRepos} new, ${totalRepos} repositories cached`,
    );
    return { pages, newRepos, totalRepos, skipped: false } satisfies CrawlSummary;
  });
