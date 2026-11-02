import { Array, Clock, Duration, Effect, Option, Redacted, Schedule } from "effect";
import {
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/http";
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
 * How long to wait after a rate-limited (403 / 429) search response, in the
 * order GitHub documents: the `retry-after` header when present; otherwise,
 * when the primary quota is used up (`x-ratelimit-remaining: 0`), until
 * `x-ratelimit-reset`; otherwise (a secondary limit without headers) one
 * minute. One wait is meant to be enough — never a short retry that is
 * bound to be refused again.
 */
export const rateLimitWait = (headers: Headers.Headers, nowMillis: number): Duration.Duration =>
  rateLimitDecision(headers, nowMillis).wait;

/** The wait and the rule it came from (logged, so throttling is diagnosable). */
export const rateLimitDecision = (
  headers: Headers.Headers,
  nowMillis: number,
): { readonly wait: Duration.Duration; readonly reason: string } => {
  const number = (name: string): number | undefined =>
    Headers.get(headers, name).pipe(
      Option.map(Number),
      Option.filter(Number.isFinite),
      Option.getOrUndefined,
    );
  const retryAfter = number("retry-after");
  if (retryAfter !== undefined && retryAfter > 0) {
    return { wait: Duration.seconds(Math.ceil(retryAfter) + 1), reason: "retry-after" };
  }
  const remaining = number("x-ratelimit-remaining");
  const reset = number("x-ratelimit-reset");
  if (remaining === 0 && reset !== undefined && reset * 1000 > nowMillis) {
    return {
      wait: Duration.seconds(Math.ceil(reset - nowMillis / 1000) + 1),
      reason: "quota used up, until reset",
    };
  }
  return { wait: Duration.minutes(1), reason: "secondary limit" };
};

/**
 * Spaces effects evenly: each run of the returned effect waits until at
 * least `interval` after the previous one started. The search API's
 * secondary limit punishes bursts, so the crawl sends one request every few
 * seconds instead of a burst at the start of every minute.
 */
export const makePacer = (interval: Duration.Input) => {
  const step = Duration.toMillis(Duration.fromInputUnsafe(interval));
  let next = 0;
  return Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const wait = next - now;
    next = Math.max(now, next) + step;
    if (wait > 0) yield* Effect.sleep(Duration.millis(wait));
  });
};

/**
 * 10 requests a minute. The documented authenticated quota is 30, but the
 * secondary limit on sorted repository searches refuses evenly spaced
 * requests at 15 a minute.
 */
const searchInterval = "6 seconds";

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

/** The tally of one `runCrawl` (`skipped`: the crawl was already complete for at least this budget). */
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

    const pace = makePacer(searchInterval);
    const client = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.bearerToken(options.apiKey)),
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({ schedule: Schedule.exponential(100), times: 3 }),
    );

    const fetchPage = (
      url: string,
      retriesLeft = 3,
    ): Effect.Effect<HttpClientResponse.HttpClientResponse, HttpClientError.HttpClientError> =>
      pace.pipe(
        Effect.andThen(client.get(url)),
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
            const { wait, reason } = rateLimitDecision(
              error.response.headers,
              yield* Clock.currentTimeMillis,
            );
            yield* Effect.log(
              `GitHub search rate limit (HTTP ${status}, ${reason}): waiting ${Math.round(Duration.toSeconds(wait))}s`,
            );
            yield* Effect.sleep(wait);
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
