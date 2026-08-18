import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Schema, pipe } from "effect";

const TodoTitle = pipe(
  Schema.String.check(
    // Schema.makeFilter((v) =>
    //   v.trim() === v ? undefined : "Value must be trimmed",
    // ),
    // Schema.makeFilter((v) =>
    //   v.length >= 4 ? undefined : "Value must be at least 4 characters long",
    // ),
    Schema.isTrimmed(),
    Schema.isMinLength(4),
  ),
  Schema.brand("TodoTitle"),
);

const Todo = Schema.Struct({
  id: Schema.Finite,
  // title: Schema.Union([Schema.String, Schema.Null]),
  // title: Schema.NullOr(Schema.String),
  title: Schema.optionalKey(TodoTitle),
  trimmedDescription: Schema.Trim,
  isActive: Schema.Boolean,
});

// const decodeTodo = Schema.decodeSync(Todo);
// const decodeTodo = Schema.decodeUnknownSync(Todo);
// const decodeTodo = Schema.decodeUnknownResult(Todo);
const decodeTodo = Schema.decodeUnknownEffect(Todo);

const program: Effect.Effect<void, Schema.SchemaError, never> = Effect.gen(function* () {
  const todo = yield* decodeTodo({
    id: 12,
    title: "1234",
    trimmedDescription: "     Description with leading whitespace will be trimmed.",
    isActive: false,
  });
  yield* Console.log(todo);
});

NodeRuntime.runMain(program);
