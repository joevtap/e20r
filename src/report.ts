import { Effect, FileSystem, Path } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import { Store } from "./store/store.ts";

const percent = (numerator: number, denominator: number): string =>
  denominator === 0 ? "0.0%" : `${((numerator / denominator) * 100).toFixed(1)}%`;

/**
 * Prints the population summary and the most used Effect packages and
 * symbols, straight from the aggregation views.
 */
export const printReport = Effect.gen(function* () {
  const store = yield* Store;
  const sql = yield* SqlClient.SqlClient;
  const p = yield* store.population;

  yield* Effect.log(
    `Population: ${p.probed} repos probed (${p.failed} failed), ` +
      `${p.adopters} adopters (${percent(p.adopters, p.probed)}), ${p.excluded} excluded, ` +
      `${p.awaitingAnalysis} awaiting analysis; ${p.analyzed} analyzed, ` +
      `${p.analyzedWithCodeUsage} with effect in code (${percent(p.analyzedWithCodeUsage, p.analyzed)}).`,
  );

  const excluded = yield* sql<{ excludedReason: string; count: number }>`
    SELECT excluded_reason, count(*) AS count FROM repo_state
    WHERE status = 'excluded' GROUP BY excluded_reason ORDER BY count DESC`;
  if (excluded.length > 0) {
    yield* Effect.log(
      `Excluded: ${excluded.map((row) => `${row.excludedReason} ${row.count}`).join(", ")}`,
    );
  }

  const packages = yield* sql<{ package: string; repos: number; files: number }>`
    SELECT package, repos, files FROM v_package_usage ORDER BY repos DESC, files DESC LIMIT 15`;
  if (packages.length > 0) {
    yield* Effect.log(
      `Top packages (repos/files): ${packages.map((row) => `${row.package} ${row.repos}/${row.files}`).join(", ")}`,
    );
  }

  const symbols = yield* sql<{ symbol: string; kind: string; repos: number; usages: number }>`
    SELECT symbol, kind, repos, usages FROM v_symbol_usage ORDER BY repos DESC, usages DESC LIMIT 25`;
  if (symbols.length > 0) {
    yield* Effect.log(
      `Top symbols (repos/usages): ${symbols.map((row) => `${row.symbol} [${row.kind}] ${row.repos}/${row.usages}`).join(", ")}`,
    );
  }

  const failures = yield* sql<{ errorStage: string; count: number }>`
    SELECT error_stage, count(*) AS count FROM repo_state
    WHERE status = 'failed' GROUP BY error_stage ORDER BY count DESC`;
  if (failures.length > 0) {
    yield* Effect.log(
      `Failures by stage: ${failures.map((row) => `${row.errorStage} ${row.count}`).join(", ")}`,
    );
  }
});

const tables = [
  "population_policy",
  "repos",
  "repo_state",
  "manifest_deps",
  "catalog_versions",
  "package_managers",
  "workspace_packages",
  "file_totals",
  "effect_files",
  "file_imports",
  "file_symbols",
  "runs",
] as const;

const views = ["v_population", "v_repo_adoption", "v_symbol_usage", "v_package_usage"] as const;

/** Columns that hold JSON text, decoded so the export is plain nested JSON. */
const jsonColumns = new Set(["topics", "raw", "timings", "names", "config", "counts"]);

const decodeRow = (row: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key,
      jsonColumns.has(key) && typeof value === "string" ? JSON.parse(value) : value,
    ]),
  );

/**
 * Exports every table and aggregation view as `<name>.jsonl` (camelCase
 * fields, JSON columns decoded), for tools that do not read SQLite. Tables
 * are paged by rowid, so memory stays flat.
 */
export const exportAll = (outDir: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    yield* fs.makeDirectory(outDir, { recursive: true });

    const writeLines = (file: string, rows: ReadonlyArray<unknown>, append: boolean) =>
      rows.length === 0 && append
        ? Effect.void
        : fs.writeFileString(
            file,
            rows.map((row) => `${JSON.stringify(row)}\n`).join(""),
            append ? { flag: "a" } : undefined,
          );

    for (const table of tables) {
      const file = path.join(outDir, `${table}.jsonl`);
      yield* writeLines(file, [], false);
      let last = 0;
      let count = 0;
      while (true) {
        const rows = yield* sql<Record<string, unknown>>`
          SELECT rowid AS export_rowid, * FROM ${sql(table)}
          WHERE rowid > ${last} ORDER BY rowid LIMIT 5000`;
        if (rows.length === 0) break;
        last = Number(rows[rows.length - 1]?.["exportRowid"] ?? last);
        count += rows.length;
        yield* writeLines(
          file,
          rows.map(({ exportRowid: _, ...row }) => decodeRow(row)),
          true,
        );
      }
      yield* Effect.log(`exported ${table}: ${count} rows`);
    }

    for (const view of views) {
      const rows = yield* sql<Record<string, unknown>>`SELECT * FROM ${sql(view)}`;
      yield* writeLines(path.join(outDir, `${view}.jsonl`), rows, false);
    }

    yield* Effect.log(`Export written to ${path.resolve(outDir)}`);
  });
