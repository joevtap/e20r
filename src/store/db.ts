import { SqliteClient, SqliteMigrator } from "@effect/sql-sqlite-node";
import { Layer, String } from "effect";
import { migrations } from "./migrations.ts";
import { StoreLayer } from "./store.ts";

/**
 * The SQLite database of one run, migrated to the current schema before
 * anything touches it. Rows are camelCase in code and snake_case on disk.
 * `":memory:"` gives a throwaway database (`--no-cache`).
 */
export const makeDatabaseLayer = (filename: string) => {
  const client = SqliteClient.layer({
    filename,
    transformQueryNames: String.camelToSnake,
    transformResultNames: String.snakeToCamel,
  });
  const migrated = SqliteMigrator.layer({
    loader: SqliteMigrator.fromRecord(migrations),
  });
  return StoreLayer.pipe(Layer.provideMerge(migrated), Layer.provideMerge(client));
};
