import { NodeRuntime } from "@effect/platform-node";
import { Console, Effect, Layer } from "effect"; // <- One import statement to look for in static code
import * as Context from "effect/Context"; // <- Another one, for effect v4 dependency injection patterns

/**
 * `@path/to/ServiceName` is the pattern commonly used for services identifiers.
 *
 * Two class-style services.
 *
 * Services properties should be readonly and its methods should have no dependencies (R = never).
 *
 * Dependencies are handled by layer composition.
 */
class Database extends Context.Service<
  Database,
  {
    readonly query: (sql: string) => Effect.Effect<unknown[]>;
    readonly execute: (sql: string) => Effect.Effect<void>;
  }
>()("@src/service-and-layers/Database") {
  /**
   * A layer is an implementation of a service.
   *
   * They handle setup/initialization, dependency resolution and resource lifecycle (acquire and release).
   *
   * Layers are commonly named with layer suffix in a camelCase fashion.
   */
  static readonly layerTest = Layer.sync(Database, () => {
    let records: Record<string, unknown> = {
      "user-1": { id: "user-1", name: "Alice" },
      "user-2": { id: "user-2", name: "Bob" },
    };

    const query = (sql: string) => Effect.succeed(Object.values(records));
    const execute = (sql: string) => Console.log(`Would execute: ${sql}`);

    return { query, execute };
  });
}

class Logger extends Context.Service<
  Logger,
  {
    readonly log: (message: string) => Effect.Effect<void>;
  }
>()("@src/service-and-layers/Logger") {
  static readonly layerTest = Layer.sync(Logger, () => {
    const log = (message: string) => Console.log(message);

    return { log };
  });
}

const program: Effect.Effect<void, never, Database | Logger> = Effect.gen(
  function* () {
    const logger = yield* Logger;
    const db = yield* Database;

    yield* logger.log("Users:\n");
    const users = yield* db.query("select * from users");

    for (const user of users as Array<{ name: string }>) {
      yield* logger.log(user.name);
    }
  },
);

const testLayer = Logger.layerTest.pipe(Layer.provideMerge(Database.layerTest));

const main = program.pipe(Effect.provide(testLayer));

NodeRuntime.runMain(main);
