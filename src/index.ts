import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command } from "effect/unstable/cli";
import { Effect, pipe } from "effect";

const e12r = Command.make("e12r");

const command = Command.run(e12r, {
  version: "0.1.0",
});

const layerCli = NodeServices.layer;

pipe(command, Effect.provide(layerCli), NodeRuntime.runMain);
