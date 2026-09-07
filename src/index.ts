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

    const fetchPage = (
      url: string,
      retriesLeft = 3,
    ): Effect.Effect<
      HttpClientResponse.HttpClientResponse,
      HttpClientError.HttpClientError | RateLimiter.RateLimiterError
    > =>
      githubRepoSearchClient.get(url).pipe(
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

    interface SearchState {
      readonly url: string;
      readonly lastSeenStars: Option.Option<number>;
      readonly intervalBound: Option.Option<number>;
    }

    // Search progress for logging
    const stats = { pages: 0, items: 0 };

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
                      // Chain the next interval bounded by the lowest star count seen. If the whole interval was a single star, the bound cannot stay equal or the same query would be re-issued forever
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

    // Deduplicates by repository id
    const seen = new Set<number>();
    const uniqueRepos = repos.pipe(
      Stream.filterMap((repo) => {
        if (seen.has(repo.id)) return Result.failVoid;
        seen.add(repo.id);
        return Result.succeed(repo);
      }),
    );

    // Total order for the top repositories: stars first, then fork count, then full name, all descending except the name
    const repoOrder = Order.combineAll([
      Order.mapInput(Order.flip(Order.Number), (repo: GithubRepo) => repo.stargazersCount),
      Order.mapInput(Order.flip(Order.Number), (repo: GithubRepo) => repo.forksCount),
      Order.mapInput(Order.String, (repo: GithubRepo) => repo.fullName),
    ]);

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
