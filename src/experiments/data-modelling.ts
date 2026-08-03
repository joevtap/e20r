// Based on the tutorial in https://github.com/kitlangton/effect-solutions/blob/main/packages/website/docs/05-data-modeling.md

import { Console, Effect, Schema } from "effect";

// Pattern for branded types
const UserId = Schema.String.pipe(Schema.brand("UserId"));
type UserId = typeof UserId.Type;

// Schema.Class is used for composite data models with multiple fields
export class User extends Schema.Class<User>("User")({
  id: UserId,
  name: Schema.String,
  email: Schema.String,
  createdAt: Schema.Date,
}) {
  get displayName() {
    return `${this.name} <${this.email}>`;
  }
}

// Usage
const user = new User({
  id: UserId.make("user-1"),
  name: "Joel",
  email: "joel@example.com",
  createdAt: new Date(),
});

console.log(user.displayName);

export const Status = Schema.Literals(["pending", "active", "completed"]);
export type Status = typeof Status.Type;

import { Match } from "effect";

export class Success extends Schema.TaggedClass<Success>()("Success", {
  value: Schema.Finite,
}) {}

export class Failure extends Schema.TaggedClass<Failure>()("Failure", {
  error: Schema.String,
}) {}

// Create the union

export const Result = Schema.Union([Success, Failure]);
export type Result = typeof Result.Type;

const success = new Success({ value: 42 });
const failure = new Failure({ error: "oopsie" });

const renderResult = (result: Result) =>
  Match.value(result).pipe(
    Match.tag("Success", ({ value }) => `Got: ${value}`),
    Match.tag("Failure", ({ error }) => `Error: ${error}`),
    Match.exhaustive,
  );

console.log(renderResult(success));
console.log(renderResult(failure));

// JSON encoding/decoding
const UserFromJson = Schema.fromJsonString(User);

const program = Effect.gen(function* () {
  const json = yield* Schema.encodeEffect(UserFromJson)(user);
  yield* Console.log(json);
});

Effect.runSync(program);
