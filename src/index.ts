import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { CliError, Command } from "effect/unstable/cli";
import { Effect, Layer } from "effect";
import { AppConfig, AppConfigLayer } from "./config.ts";

const showConfig = Command.make("show-config", {}, () =>
  Effect.gen(function* () {
    const config = yield* AppConfig.pipe(
      Effect.mapError(
        (error) =>
          new CliError.UserError({
            cause: error,
            userMessage: `Configuration error: ${error.cause.message}`,
          }),
      ),
    );

    yield* Effect.log("Config:", config);
  }),
);

const e20r = Command.make("e20r").pipe(Command.withSubcommands([showConfig]));

const command = Command.run(e20r, {
  version: "0.1.0",
});

const CliLayer = AppConfigLayer.pipe(Layer.provideMerge(NodeServices.layer));

const program = command.pipe(Effect.provide(CliLayer));

NodeRuntime.runMain(program);
