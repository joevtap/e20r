import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command, Flag } from "effect/unstable/cli";
import { Effect, Layer, Option, Schedule } from "effect";
import { AppConfig, AppConfigLayer, makeAppConfigOverlayLayer } from "./config.ts";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http";

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

    // TODO: GithubRepoSearchResponseSchema

    // TODO: how to make paginated queries on the most popular typescript repositories (by stars and forks and lexicographical order) that are not forks, archived and are public
    const res = yield* githubRepoSearchClient.get(
      `https://api.github.com/search/repositories?${new URLSearchParams({
        q: "language:typescript fork:false archived:false",
        sort: "stars",
      })}`,
    );

    yield* res.json.pipe(Effect.andThen((res) => Effect.log((res as any).items[0])));
  }),
);

const e20r = Command.make("e20r").pipe(
  Command.withSharedFlags({
    n: Flag.integer("target-effect-repositories-n").pipe(
      Flag.withAlias("n"),
      Flag.withDescription("Number of Effect repositories to target"),
      Flag.optional,
    ),
    B: Flag.integer("maximum-inspected-typescript-repositories-b").pipe(
      Flag.withAlias("b"),
      Flag.withDescription("Maximum number of TypeScript repositories to inspect"),
      Flag.optional,
    ),
  }),
  Command.withSubcommands([fetchGithub]),
  Command.provide(({ n, B }) =>
    makeAppConfigOverlayLayer({
      ...Option.match(n, {
        onNone: () => {},
        onSome: (value) => ({ targetEffectRepositoriesN: value }),
      }),
      ...Option.match(B, {
        onNone: () => {},
        onSome: (value) => ({ maximumInspectedTypescriptRepositoriesB: value }),
      }),
    }),
  ),
);

const command = Command.run(e20r, { version: "0.1.0" });

const CliLayer = AppConfigLayer.pipe(Layer.provideMerge(FetchHttpClient.layer), Layer.provideMerge(NodeServices.layer));

const program = Effect.provide(command, CliLayer);

NodeRuntime.runMain(program);
