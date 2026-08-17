import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { FileSystem, Effect, pipe, Console, Schema } from "effect";

const AircraftModel = Schema.Struct({
  id: Schema.Trim,
  aircraftType: Schema.Trim,
  designatorIcao: Schema.Trim,
  model: Schema.Trim,
  engineModel: Schema.NullishOr(Schema.Trim),
  engineType: Schema.Trim,
  fuelConsumptionAc: Schema.optionalKey(Schema.NullOr(Schema.Finite)),
  fuelConsumptionCruise: Schema.NullishOr(Schema.Finite),
  fuelConsumptionDc: Schema.NullishOr(Schema.Finite),
  fuelConsumptionUnit: Schema.NullishOr(Schema.String),
  fuelType: Schema.NullishOr(Schema.String),
  operationalCeiling: Schema.NullishOr(Schema.Finite),
  rateAc: Schema.NullishOr(Schema.Finite),
  rateDc: Schema.NullishOr(Schema.Finite),
  rateUnit: Schema.NullishOr(Schema.String),
  speedAc: Schema.NullishOr(Schema.Finite),
  speedCruise: Schema.NullishOr(Schema.Finite),
  speedDc: Schema.NullishOr(Schema.Finite),
  speedUnit: Schema.NullishOr(Schema.String),
  updatedAt: Schema.DateTimeUtcFromString,
}).pipe(Schema.Array);
type AircraftModel = typeof AircraftModel.Type;

const AircraftModelsFromJsonString = Schema.fromJsonString(AircraftModel);
const AircraftModelsXmlEncoder = Schema.toEncoderXml(AircraftModel, {
  arrayItemName: "aircraft-model",
  rootName: "aircraft-models",
});

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const file = yield* fs
    .readFileString("./src/experiments/aircraft-models.json", "utf-8")
    .pipe(Effect.orElseSucceed(() => "{}"));

  const aircraftModels = yield* Schema.decodeEffect(AircraftModelsFromJsonString)(file);

  const aircraftModelsXml = yield* AircraftModelsXmlEncoder(aircraftModels);
  return yield* Console.log(aircraftModelsXml);
}).pipe(Effect.withSpan("main"));

pipe(program, Effect.provide(NodeServices.layer), NodeRuntime.runMain);
