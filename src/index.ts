import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command, Flag } from "effect/unstable/cli";
import { Effect, Layer, Option } from "effect";
import {
  AppConfig,
  AppConfigLayer,
  makeAppConfigOverlayLayer,
} from "./config.ts";

const showConfig = Command.make("show-config", {}, () =>
  Effect.tap(AppConfig, (config) => Effect.log("Config:", config)),
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
      Flag.withDescription(
        "Maximum number of TypeScript repositories to inspect",
      ),
      Flag.optional,
    ),
  }),
  Command.withSubcommands([showConfig]),
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

const CliLayer = Layer.provideMerge(AppConfigLayer, NodeServices.layer);

const program = Effect.provide(command, CliLayer);

NodeRuntime.runMain(program);
