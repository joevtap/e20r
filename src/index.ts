import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command, Flag } from "effect/unstable/cli";
import { Effect, Layer, Option, Schedule } from "effect";
import { AppConfig, AppConfigLayer, makeAppConfigOverlayLayer } from "./config.ts";
import { FetchHttpClient, HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http";
import { GithubRepoSearchResponseSchema } from "./domain/github.ts";

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

    // Yielding an HttpClient to call GitHub API passing our token
    const githubRepoSearchClient = (yield* HttpClient.HttpClient).pipe(
      HttpClient.mapRequest(HttpClientRequest.bearerToken(config.githubApiKey)),
      HttpClient.filterStatusOk,
      HttpClient.retryTransient({ schedule: Schedule.exponential(100), times: 3 }),
    );

    // TODO: how to make paginated queries on the most popular typescript repositories (by stars and forks and lexicographical order) that are not forks, archived and are public
    // Progress on that TODO: there is a hard-cap of 1000 results per search. So I have to define dynamic intervals of
    // star counts while paginating.
    //
    // It would work this way:
    // 1. One query unbounded by stars
    // 2. Paginate over it using link rel="next"
    // 3. Get the lower bound of star counts of that query from the last listed repo
    // 4. Iterate over the search by using the star count of the last repo
    //    as the upper bound of the next search (stars:<=n)
    const res = yield* githubRepoSearchClient
      .get(
        `https://api.github.com/search/repositories?${new URLSearchParams({
          q: "language:typescript fork:false archived:false",
          sort: "stars",
          per_page: "100",
          page: "1",
        })}`,
      )
      .pipe(
        // Following `rel="next"` in response headers is the robust way to iterate over the pages of a single request.
        // TODO: how to do that in effect?
        //
        // Plan (primitives verified against Effect v4, `@since 4.0.0` sources):
        //
        // 1. Extract the `link` response header with `Headers.get(name)`, which
        //    returns `Option<string>`: https://github.com/Effect-TS/effect/blob/main/packages/effect/src/unstable/http/Headers.ts
        //    Reading headers off the response is `response.headers: Headers.Headers`:
        //    https://github.com/Effect-TS/effect/blob/main/packages/effect/src/unstable/http/HttpClientResponse.ts
        //
        // 2. Drive the loop with `Stream.paginate(state, (state) => Effect<[values[], Option<nextState>], E, R>)`.
        //    It exists precisely for this: "Use to consume paginated APIs where each
        //    step returns a batch of values together with an optional next state."
        //    Returning `Option.none()` ends the stream. State can be the next-page URL,
        //    values are the parsed repos of that page.
        //    Docs: https://www.effect.website/docs/v4/api/effect/Stream
        //    Source: https://github.com/Effect-TS/effect/blob/main/packages/effect/src/Stream.ts
        //
        // 3. Parse `<url>; rel="next"` out of the header value with plain string/URL
        //    handling (RFC 8288 link format, no Effect involved). No `rel="next"`
        //    means the last page was reached. Note `rel="last"` also appears in the
        //    header, but its meaning interacts with GitHub's 1000-result search cap
        //    (see TODO above), so termination on missing `rel="next"` is safer.
        //
        // Alternative without streams: `Effect.whileLoop` returns an array instead
        //    (same repo, packages/effect/src/Effect.ts). `Effect.iterate` from v3 no
        //    longer exists in v4.
        //
        // Note: in v4 the response body is cached, so reading headers and
        // `schemaBodyJson` from the same response in one step is safe
        // (pattern: https://www.effective.software/courses/effect-atom/managing-url-state/adding-pagination).
        Effect.tap((value) => Effect.log(value.headers)),
        Effect.flatMap(HttpClientResponse.schemaBodyJson(GithubRepoSearchResponseSchema)),
      );

    yield* Effect.log(res.items[0]);
  }),
);

const e20r = Command.make("e20r").pipe(
  Command.withSharedFlags({
    repoSearchBudget: Flag.integer("repo-search-budget").pipe(
      Flag.withAlias("b"),
      Flag.withDescription("Maximum number of TypeScript repositories to search and inspect"),
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

const CliLayer = AppConfigLayer.pipe(Layer.provideMerge(FetchHttpClient.layer), Layer.provideMerge(NodeServices.layer));

const program = Effect.provide(command, CliLayer);

NodeRuntime.runMain(program);
