import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command } from "effect/unstable/cli";
import { Effect, pipe } from "effect";

const e20r = Command.make("e20r");

const command = Command.run(e20r, {
  version: "0.1.0",
});

const layerCli = NodeServices.layer;

pipe(command, Effect.provide(layerCli), NodeRuntime.runMain);
