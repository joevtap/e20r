import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { makeDatabaseLayer } from "../src/store/db.ts";
import { Store, type RepoOutcome } from "../src/store/store.ts";

const TestDatabase = makeDatabaseLayer(":memory:");

const outcome = (overrides: Partial<RepoOutcome> = {}): RepoOutcome => ({
  repoId: 1,
  fullName: "a/b",
  runId: 1,
  status: "analyzed",
  commit: "0".repeat(40),
  adopter: true,
  excludedReason: null,
  manifestCount: 1,
  signals: [
    {
      _tag: "effect-in-package-json",
      versions: ["^3.0.0" as never],
      occurrences: [
        {
          file: "package.json",
          package: "effect",
          field: "dependencies",
          version: "^3.0.0" as never,
        },
      ],
    },
    { _tag: "uses-pnpm", evidence: "pnpm-lock.yaml" },
  ],
  workspacePackages: [{ dir: "", name: "b", effectDependency: "dependencies" }],
  totals: [
    {
      packageDir: "",
      role: "source",
      extension: "ts",
      files: 3,
      declarationFiles: 1,
      loc: 30,
      effectFiles: 1,
      effectLoc: 10,
      largeFiles: 0,
      unreadableFiles: 0,
    },
  ],
  effectFiles: [
    {
      file: "src/a.ts",
      packageDir: "",
      role: "source",
      extension: "ts",
      loc: 10,
      bytes: 200,
      parser: "oxc",
      imports: [
        {
          module: "effect",
          package: "effect",
          kind: "import",
          line: 1,
          names: [{ imported: "Effect", local: "Effect", typeOnly: false }],
        },
      ],
      symbols: [{ symbol: "Effect.gen", kind: "call", count: 2 }],
    },
  ],
  analyzerVersion: 1,
  timings: { clone: 10 },
  ...overrides,
});

describe("Store", () => {
  it.effect("commits a repository idempotently", () =>
    Effect.gen(function* () {
      const store = yield* Store;
      const sql = yield* SqlClient.SqlClient;
      yield* store.commitRepo(outcome());
      yield* store.commitRepo(outcome());
      const counts = yield* sql<{ table: string; count: number }>`
        SELECT 'imports' AS "table", count(*) AS count FROM file_imports
        UNION ALL SELECT 'symbols', count(*) FROM file_symbols
        UNION ALL SELECT 'deps', count(*) FROM manifest_deps
        UNION ALL SELECT 'totals', count(*) FROM file_totals`;
      expect(counts.map((row) => row.count)).toEqual([1, 1, 1, 1]);
      expect(yield* store.population).toMatchObject({
        probed: 1,
        adopters: 1,
        analyzed: 1,
        analyzedWithCodeUsage: 1,
      });
    }).pipe(Effect.provide(TestDatabase), Effect.provide(NodeServices.layer)),
  );

  it.effect("never lets a failure overwrite committed work, and counts attempts otherwise", () =>
    Effect.gen(function* () {
      const store = yield* Store;
      yield* store.commitRepo(outcome());
      const failure = { fullName: "x", runId: 2, stage: "clone", error: "boom", timings: {} };
      yield* store.recordFailure({ ...failure, repoId: 1 });
      yield* store.recordFailure({ ...failure, repoId: 2 });
      yield* store.recordFailure({ ...failure, repoId: 2 });
      const prior = yield* store.priorStates;
      expect(prior.get(1)).toEqual({ status: "analyzed", attempts: 0, analyzerVersion: 1 });
      expect(prior.get(2)).toEqual({ status: "failed", attempts: 2, analyzerVersion: null });
      expect(yield* store.resetFailures).toBe(1);
      expect((yield* store.priorStates).get(2)?.attempts).toBe(0);
    }).pipe(Effect.provide(TestDatabase), Effect.provide(NodeServices.layer)),
  );

  it.effect("replaces child rows when a repository is re-committed with less", () =>
    Effect.gen(function* () {
      const store = yield* Store;
      const sql = yield* SqlClient.SqlClient;
      yield* store.commitRepo(outcome());
      yield* store.commitRepo(
        outcome({
          status: "not-adopter",
          adopter: false,
          signals: [],
          effectFiles: [],
          analyzerVersion: null,
        }),
      );
      const rows = yield* sql<{ count: number }>`SELECT count(*) AS count FROM file_symbols`;
      expect(rows[0]?.count).toBe(0);
      expect(yield* store.population).toMatchObject({ probed: 1, adopters: 0, analyzed: 0 });
    }).pipe(Effect.provide(TestDatabase), Effect.provide(NodeServices.layer)),
  );
});
