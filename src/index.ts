import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command, Flag } from "effect/unstable/cli";
import { Array, Duration, Effect, Layer, Option, Order, Result, Schedule, Stream } from "effect";
import { AppConfig, AppConfigLayer, makeAppConfigOverlayLayer } from "./config.ts";
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { RateLimiter } from "effect/unstable/persistence";
import { type GithubRepo, GithubRepoSearchResponseSchema } from "./domain/github.ts";

/**
 * Parses the URL of the `rel="next"` entry out of an RFC 8288 `Link` header
 * value. Returns `Option.none()` when there is no such entry, which is how
 * GitHub signals the last page.
 */
const parseNextLink = (header: string): Option.Option<string> =>
  Array.findFirst(header.split(","), (link) => link.includes('rel="next"')).pipe(
    Option.flatMap((link) => Option.fromUndefinedOr(/<([^>]+)>/.exec(link)?.[1])),
  );

/**
 * Entrypoint for manual testing purposes.
 *
 * Its name will keep changing as I progress step by step through the implementation
 */
const fetchGithub = Command.make("fetch-github", {}, () =>
  Effect.gen(function* () {
    // Loading configuration service so we know it is working
    const config = yield* AppConfig;
    yield* Effect.log("Config is working: ", config);

    // Yielding an HttpClient to call GitHub API passing our token, respecting
    // the Search endpoint request quota for authenticated requests: 30/min.
    //
    // The limiter delays requests that would exceed the window, learns the
    // actual quota from GitHub's `x-ratelimit-*` response headers, and retries
    // HTTP 429 responses honoring `Retry-After` (secondary rate limits).
    const limiter = yield* RateLimiter.RateLimiter;
    const githubRepoSearchClient = (yield* HttpClient.HttpClient).pipe(
      HttpClient.withRateLimiter({
        limiter,
        key: "github-search",
        window: "1 minute",
        limit: 15,
      }),
      HttpClient.mapRequest(HttpClientRequest.bearerToken(config.githubApiKey)),
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({ schedule: Schedule.exponential(100), times: 3 }),
    );

    // GitHub's Search endpoint signals quota exhaustion with 403 responses
    // (not 429) carrying `retry-after` and/or `x-ratelimit-reset` headers,
    // which `withRateLimiter` does not see (it only retries 429s). The delay
    // is the largest of the two server-indicated values (`retry-after` can be
    // a worthless 0 while the primary window is still exhausted); one minute
    // is the fallback when neither is present.
    const rateLimitDelay = (response: HttpClientResponse.HttpClientResponse): Duration.Duration => {
      const fromHeader = (name: string, toSeconds: (value: number) => number): Option.Option<number> =>
        Headers.get(response.headers, name).pipe(
          Option.map(Number),
          Option.filter(Number.isFinite),
          Option.map(toSeconds),
        );

      const seconds = Math.max(
        Option.getOrElse(
          fromHeader("retry-after", (s) => s + 1),
          () => 0,
        ),
        Option.getOrElse(
          fromHeader("x-ratelimit-reset", (epoch) => Math.max(epoch - Date.now() / 1000, 1)),
          () => 0,
        ),
      );

      return seconds > 0 ? Duration.seconds(seconds) : Duration.minutes(1);
    };

    // Fetches a page of search results, retrying rate-limit rejections (403 or
    // 429) after the server-indicated delay, a bounded number of times.
    const fetchPage = (
      url: string,
      retriesLeft = 3,
    ): Effect.Effect<
      HttpClientResponse.HttpClientResponse,
      HttpClientError.HttpClientError | RateLimiter.RateLimiterError
    > =>
      githubRepoSearchClient.get(url).pipe(
        Effect.flatMap(HttpClientResponse.filterStatusOk),
        Effect.catchIf(
          HttpClientError.isHttpClientError,
          Effect.fn(function* (error: HttpClientError.HttpClientError | RateLimiter.RateLimiterError) {
            if (!HttpClientError.isHttpClientError(error)) return yield* error;
            const status = error.response?.status;
            if (retriesLeft <= 0 || error.response === undefined || (status !== 403 && status !== 429)) {
              return yield* error;
            }
            const delay = rateLimitDelay(error.response);
            yield* Effect.log(
              `Rate limited (HTTP ${error.response.status}); retrying in ${Duration.toMillis(delay) / 1000}s`,
            );
            yield* Effect.sleep(delay);
            return yield* fetchPage(url, retriesLeft - 1);
          }),
        ),
      );

    // Builds the search URL for one star-count interval. GitHub caps each
    // search at 1000 results (10 pages of 100), so intervals are chained: when
    // an interval is exhausted, its lowest star count becomes the upper bound
    // of the next one (`stars:<=n`). The boundary star count is re-listed on
    // purpose; duplicates are removed downstream (see the dedup stage), so no
    // repositories are lost when an interval boundary falls inside a dense
    // star count.
    const buildSearchUrl = (maxStars?: number) =>
      `https://api.github.com/search/repositories?${new URLSearchParams({
        q:
          maxStars === undefined
            ? "language:typescript fork:false archived:false"
            : `language:typescript fork:false archived:false stars:<=${maxStars}`,
        sort: "stars",
        order: "desc",
        per_page: "100",
        page: "1",
      })}`;

    // The stream state is the URL of the page to fetch, the star count of the
    // most recently listed repository (carried across pages so that even an
    // empty final page can start the next interval), and the star bound of the
    // interval being crawled (used to force progress, see the chaining logic).
    interface SearchState {
      readonly url: string;
      readonly lastSeenStars: Option.Option<number>;
      readonly intervalBound: Option.Option<number>;
    }

    // Crawl progress, mutated by the producer step for logging. Single
    // consumer, so plain mutable fields are safe. `items` counts raw listed
    // entries; the difference to the deduplicated count shows how much the
    // interval-boundary re-listing produced.
    const stats = { pages: 0, items: 0 };

    // A stream of repositories: within an interval it follows `rel="next"`
    // link-header pagination; across intervals it chains the next star-count
    // search, until the floor is reached or the consumer stops pulling.
    const repos = Stream.paginate(
      { url: buildSearchUrl(), lastSeenStars: Option.none(), intervalBound: Option.none() } satisfies SearchState,
      (state) =>
        fetchPage(state.url).pipe(
          Effect.flatMap((response) =>
            Effect.gen(function* () {
              const body = yield* HttpClientResponse.schemaBodyJson(GithubRepoSearchResponseSchema)(response);

              stats.pages++;
              stats.items += body.items.length;

              const lastSeenStars = Option.orElse(
                Option.map(Array.last(body.items), (repo) => repo.stargazersCount),
                () => state.lastSeenStars,
              );
              const nextPageUrl = Headers.get(response.headers, "link").pipe(Option.flatMap(parseNextLink));

              const intervalLabel = Option.match(state.intervalBound, {
                onNone: () => "any stars",
                onSome: (bound) => `stars<=${bound}`,
              });
              if (Option.isNone(state.lastSeenStars)) {
                yield* Effect.log(`Starting interval ${intervalLabel}`);
              }
              yield* Effect.log(
                `Page ${stats.pages} (${intervalLabel}): +${body.items.length} repos, down to ★${Option.getOrElse(
                  lastSeenStars,
                  () => 0,
                )}`,
              );

              const nextState = Option.match(nextPageUrl, {
                onSome: (url) => Option.some<SearchState>({ url, lastSeenStars, intervalBound: state.intervalBound }),
                onNone: () =>
                  Option.match(lastSeenStars, {
                    onSome: (stars) => {
                      // Chain the next interval bounded by the lowest star
                      // count seen. If the whole interval was a single star
                      // count (its 1000-result cap hit exactly there), the
                      // bound cannot stay equal or the same query would be
                      // re-issued forever — force one step down instead.
                      const nextBound = Option.match(state.intervalBound, {
                        onNone: () => stars,
                        onSome: (bound) => (stars < bound ? stars : stars - 1),
                      });
                      return nextBound >= 1
                        ? Option.some<SearchState>({
                            url: buildSearchUrl(nextBound),
                            lastSeenStars: Option.none(),
                            intervalBound: Option.some(nextBound),
                          })
                        : Option.none();
                    },
                    onNone: () => Option.none(),
                  }),
              });

              return [body.items, nextState] as const;
            }),
          ),
        ),
    );

    // Deduplicates by repository id. Interval chaining re-lists boundary star
    // counts on purpose, so the dedup stage belongs in the pipeline — placed
    // before `take` so the budget counts unique repositories only. The `Set`
    // is captured by the closure for the lifetime of this run, which is safe
    // because this stream has a single consumer.
    const seen = new Set<number>();
    const uniqueRepos = repos.pipe(
      Stream.filterMap((repo) => {
        if (seen.has(repo.id)) return Result.failVoid;
        seen.add(repo.id);
        return Result.succeed(repo);
      }),
    );

    // Deterministic total order for the top repositories: stars first, then
    // fork count, then full name, all descending except the name, which
    // breaks remaining ties lexicographically. GitHub only sorts by stars and
    // its order within equal star counts is arbitrary, so this order is
    // applied client-side after collection. `Array.sort` is used instead of
    // `Array.sortBy` because the latter loses the element type for variadic
    // orders and degrades to `any[]`.
    const repoOrder = Order.combineAll([
      Order.mapInput(Order.flip(Order.Number), (repo: GithubRepo) => repo.stargazersCount),
      Order.mapInput(Order.flip(Order.Number), (repo: GithubRepo) => repo.forksCount),
      Order.mapInput(Order.String, (repo: GithubRepo) => repo.fullName),
    ]);

    // Boundary-exact collection: crawl until `repoSearchBudget` repositories
    // have been listed AND every repository sharing the cut-off star count has
    // been listed too. Elements arrive in stars-descending order, so the
    // boundary group ends at the first repository strictly below the cut-off —
    // `takeWhile` stops exactly there. Collecting the whole group is what lets
    // `repoOrder` later decide, deterministically, which repositories make the
    // top N; GitHub's arbitrary tie order must not influence selection.
    //
    // The throttle paces one page request every 3 seconds (~20/min), well
    // below the 30/min quota: sustained crawling at ~95% of the quota keeps
    // tripping GitHub's rejection on jitter, and each 403 costs at least a
    // window reset. Each paginate step emits one page as a single chunk, so
    // `cost: () => 1` is per request.
    //
    // The mutable counters are captured by the closure for the lifetime of
    // this run, which is safe because this stream has a single consumer.
    let collected = 0;
    let cutOffStars = 0;
    const collectedRepos = yield* uniqueRepos.pipe(
      Stream.throttle({ cost: () => 1, units: 1, duration: "3 seconds" }),
      Stream.takeWhile((repo) => {
        collected++;
        if (collected === config.repoSearchBudget) cutOffStars = repo.stargazersCount;
        return collected <= config.repoSearchBudget || repo.stargazersCount >= cutOffStars;
      }),
      Stream.runCollect,
    );

    // Sort the whole collected set by the total order, then keep the top N.
    const topRepos = Array.take(Array.sort(repoOrder)(collectedRepos), config.repoSearchBudget);

    yield* Effect.log(
      `Crawled ${stats.pages} pages: ${collectedRepos.length} unique repositories ` +
        `(${stats.items - collectedRepos.length} boundary re-listings skipped), cut-off at ★${cutOffStars}; ` +
        `keeping top ${config.repoSearchBudget}.`,
    );

    // Placeholder consumer: iteration runs lazily over the final selection,
    // one repository at a time. The clone-and-analyze stage plugs in here.
    yield* Effect.forEach(
      topRepos,
      (repo) => Effect.log(`${repo.fullName} (${repo.htmlUrl}) ★ ${repo.stargazersCount}`),
      {
        discard: true,
      },
    );
  }),
);

const e20r = Command.make("e20r").pipe(
  Command.withSharedFlags({
    repoSearchBudget: Flag.integer("repo-search-budget").pipe(
      Flag.withAlias("b"),
      Flag.withDescription("Number of top TypeScript repositories to inspect"),
      Flag.optional,
    ),
  }),
  Command.withSubcommands([fetchGithub]),
  Command.provide(({ repoSearchBudget }) =>
    makeAppConfigOverlayLayer({
      ...Option.match(repoSearchBudget, {
        onNone: () => {},
        onSome: (value) => ({ repoSearchBudget: value }),
      }),
    }),
  ),
);

const command = Command.run(e20r, { version: "0.1.0" });

const RateLimiterLayer = RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory));

const CliLayer = AppConfigLayer.pipe(
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(RateLimiterLayer),
  Layer.provideMerge(NodeServices.layer),
);

const program = Effect.provide(command, CliLayer);

NodeRuntime.runMain(program);
