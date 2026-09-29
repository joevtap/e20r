import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import type { EffectFileRow } from "../src/deep-analysis/analyze.ts";
import { makeDatabaseLayer } from "../src/store/db.ts";
import { Store, type RepoOutcome } from "../src/store/store.ts";
import {
  defaultFilters,
  fileSymbolsCsv,
  fileTable,
  overview,
  parseFilters,
  repositories,
  repository,
  specMajor,
  symbolRepositories,
  symbolTable,
  tablePage,
} from "../src/viewer/queries.ts";

const file = (
  name: string,
  role: "source" | "test",
  symbols: EffectFileRow["symbols"],
): EffectFileRow => ({
  file: name,
  packageDir: "",
  role,
  extension: "ts",
  loc: 10,
  bytes: 100,
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
  symbols,
});

const outcome = (repoId: number, overrides: Partial<RepoOutcome>): RepoOutcome => ({
  repoId,
  fullName: `org/repo-${repoId}`,
  runId: 1,
  status: "not-adopter",
  commit: "0".repeat(40),
  adopter: false,
  excludedReason: null,
  manifestCount: 1,
  signals: [],
  workspacePackages: [],
  totals: [],
  effectFiles: [],
  analyzerVersion: null,
  timings: {},
  ...overrides,
});

const effectDep = (spec: string, field: "dependencies" | "devDependencies" = "dependencies") => ({
  _tag: "effect-in-package-json" as const,
  versions: [spec as never],
  occurrences: [{ file: "package.json", package: "effect", field, version: spec as never }],
});

/** Four repositories: two analyzed adopters, one dev-only user, one non-adopter. */
const seed = Effect.gen(function* () {
  const store = yield* Store;
  const sql = yield* SqlClient.SqlClient;
  const stars = [100, 5000, 300, 50];
  for (const [index, count] of stars.entries()) {
    yield* sql`INSERT INTO repos ${sql.insert({
      id: index + 1,
      fullName: `org/repo-${index + 1}`,
      owner: "org",
      defaultBranch: "main",
      htmlUrl: `https://github.com/org/repo-${index + 1}`,
      stars: count,
      forks: 0,
      sizeKb: 1,
      language: "TypeScript",
      license: null,
      topics: index === 0 ? '["effect-ts"]' : "[]",
      createdAt: "2024-01-01T00:00:00Z",
      pushedAt: "2024-01-01T00:00:00Z",
      raw: "{}",
      crawledAt: "2024-01-01T00:00:00Z",
    })}`;
  }
  const totals = (files: number, effectFiles: number) => [
    {
      packageDir: "",
      role: "source" as const,
      extension: "ts" as const,
      files,
      declarationFiles: 0,
      loc: files * 10,
      effectFiles,
      effectLoc: effectFiles * 10,
      largeFiles: 0,
      unreadableFiles: 0,
    },
    {
      packageDir: "",
      role: "test" as const,
      extension: "ts" as const,
      files: 2,
      declarationFiles: 0,
      loc: 20,
      effectFiles: 1,
      effectLoc: 10,
      largeFiles: 0,
      unreadableFiles: 0,
    },
  ];
  yield* store.commitRepo(
    outcome(1, {
      status: "analyzed",
      adopter: true,
      analyzerVersion: 2,
      signals: [
        effectDep("catalog:"),
        {
          _tag: "effect-version-in-catalog",
          manager: "pnpm",
          entries: [{ catalog: "default", version: "^4.0.0" as never }],
        },
      ],
      totals: totals(8, 2),
      effectFiles: [
        file("src/a.ts", "source", [{ symbol: "Effect.gen", kind: "call", count: 3 }]),
        file("src/b.ts", "source", [
          { symbol: "Effect.gen", kind: "call", count: 1 },
          { symbol: "Effect.Effect", kind: "type-reference", count: 2 },
        ]),
        file("test/a.test.ts", "test", [{ symbol: "Effect.runPromise", kind: "call", count: 5 }]),
      ],
    }),
  );
  yield* store.commitRepo(
    outcome(2, {
      status: "analyzed",
      adopter: true,
      analyzerVersion: 2,
      signals: [effectDep("^3.10.0")],
      totals: totals(18, 1),
      effectFiles: [
        file("src/x.ts", "source", [{ symbol: "Effect.gen", kind: "call", count: 7 }]),
        file("test/x.test.ts", "test", []),
      ],
    }),
  );
  yield* store.commitRepo(outcome(3, { signals: [effectDep("^3.0.0", "devDependencies")] }));
  yield* store.commitRepo(outcome(4, {}));
});

const run = <A, E>(effect: Effect.Effect<A, E, Store | SqlClient.SqlClient>) =>
  Effect.gen(function* () {
    yield* seed;
    return yield* effect;
  }).pipe(Effect.provide(makeDatabaseLayer(":memory:")), Effect.provide(NodeServices.layer));

describe("viewer queries", () => {
  it("parses filters defensively", () => {
    expect(
      parseFilters({ status: "analyzed", minStars: "10", role: "test", kind: "call", q: " x " }),
    ).toEqual({
      q: "x",
      status: "analyzed",
      minStars: 10,
      role: "test",
      kind: "call",
    });
    expect(
      parseFilters({ status: "bogus", minStars: "-3", role: ["source", "test"], kind: "nope" }),
    ).toEqual({
      ...defaultFilters,
      role: "source",
    });
  });

  it("reads major versions out of specifiers", () => {
    expect(
      [
        "^3.10.0",
        "~4.0.0-rc.1",
        ">=2",
        "npm:effect@3.1.0",
        "workspace:*",
        "latest",
        "catalog:",
      ].map(specMajor),
    ).toEqual(["v3", "v4", "v2", "v3", "workspace", "dist-tag / any", "unresolved catalog"]);
  });

  it.effect("summarizes the population, resolving catalogs", () =>
    run(overview(defaultFilters)).pipe(
      Effect.map((o) => {
        expect(o.counts).toMatchObject({
          probed: 4,
          adopters: 2,
          analyzed: 2,
          withCodeUsage: 2,
          tsFiles: 30,
          effectFiles: 5,
        });
        expect(o.declaration).toEqual({ runtime: 2, peer: 0, dev: 1 });
        expect(o.versions).toEqual([
          { label: "v4", repos: 1 },
          { label: "v3", repos: 1 },
        ]);
        expect(o.symbols[0]).toMatchObject({ symbol: "Effect.gen", repos: 2, usages: 11 });
        expect(o.depth.map((row) => row.repoId)).toEqual([1, 2]);
      }),
    ),
  );

  it.effect("scopes per-file metrics by role and symbols by position", () =>
    run(
      Effect.all([
        overview({ ...defaultFilters, role: "test" }),
        symbolTable(
          { ...defaultFilters, role: "source", kind: "call" },
          "",
          { key: "usages", dir: "desc" },
          { limit: 10, offset: 0 },
        ),
        symbolRepositories({ ...defaultFilters, role: "test" }, "Effect.runPromise", "call"),
      ]),
    ).pipe(
      Effect.map(([tests, calls, runPromise]) => {
        expect(tests.counts).toMatchObject({ tsFiles: 4, effectFiles: 2 });
        expect(calls.rows).toEqual([
          { symbol: "Effect.gen", kind: "call", repos: 2, files: 3, usages: 11 },
        ]);
        expect(runPromise).toEqual([
          { repoId: 1, fullName: "org/repo-1", stars: 100, files: 1, usages: 5 },
        ]);
      }),
    ),
  );

  it.effect("splits and filters generated code", () =>
    Effect.gen(function* () {
      const store = yield* Store;
      yield* store.commitRepo(
        outcome(5, {
          status: "analyzed",
          adopter: true,
          analyzerVersion: 3,
          signals: [effectDep("^4.0.0")],
          totals: [
            {
              packageDir: "",
              role: "generated",
              extension: "ts",
              files: 4,
              declarationFiles: 0,
              loc: 400,
              effectFiles: 2,
              effectLoc: 300,
              largeFiles: 0,
              unreadableFiles: 0,
            },
          ],
          effectFiles: [
            file("src/api.gen.ts", "generated", [
              { symbol: "Schema.Struct", kind: "call", count: 90 },
            ]),
            file("src/other.gen.ts", "generated", [
              { symbol: "Effect.gen", kind: "call", count: 10 },
            ]),
          ],
        }),
      );
      const [all, authored, generated] = yield* Effect.all([
        overview(defaultFilters),
        overview({ ...defaultFilters, role: "authored" }),
        symbolTable(
          { ...defaultFilters, role: "generated" },
          "",
          { key: "usages", dir: "desc" },
          { limit: 10, offset: 0 },
        ),
      ]);
      expect(all.byRole.map((row) => [row.role, row.files, row.effectFiles, row.usages])).toEqual([
        ["source", 26, 3, 13],
        ["test", 4, 2, 5],
        ["generated", 4, 2, 100],
      ]);
      expect(authored.counts).toMatchObject({ tsFiles: 30, effectFiles: 5 });
      expect(authored.symbols.map((row) => row.symbol)).not.toContain("Schema.Struct");
      expect(generated.rows.map((row) => row["symbol"])).toEqual(["Schema.Struct", "Effect.gen"]);
    }).pipe((effect) => run(effect)),
  );

  it.effect("lists Effect files with their symbols, searchable by path and symbol", () =>
    run(
      Effect.all([
        fileTable(
          defaultFilters,
          { path: "", uses: "" },
          { key: "usages", dir: "desc" },
          { limit: 10, offset: 0 },
        ),
        fileTable(
          { ...defaultFilters, kind: "call" },
          { path: "", uses: "Effect.gen" },
          { key: "file", dir: "asc" },
          { limit: 10, offset: 0 },
        ),
        fileTable(
          defaultFilters,
          { path: "test", uses: "" },
          { key: "file", dir: "asc" },
          { limit: 10, offset: 0 },
        ),
        fileTable(
          defaultFilters,
          { path: "", uses: "" },
          { key: "usages", dir: "desc" },
          { limit: 2, offset: 2 },
        ),
        fileTable(
          defaultFilters,
          { path: "", uses: "", repo: 2 },
          { key: "file", dir: "asc" },
          { limit: 10, offset: 0 },
        ),
      ]),
    ).pipe(
      Effect.map(([all, gen, tests, page, oneRepo]) => {
        expect(oneRepo.rows.map((row) => row["file"])).toEqual(["src/x.ts", "test/x.test.ts"]);
        expect([all.total, all.repos]).toEqual([5, 2]);
        expect(all.rows.map((row) => [row["file"], row["usages"], row["distinctSymbols"]])).toEqual(
          [
            ["src/x.ts", 7, 1],
            ["test/a.test.ts", 5, 1],
            ["src/a.ts", 3, 1],
            ["src/b.ts", 3, 2],
            ["test/x.test.ts", 0, 0],
          ],
        );
        expect(all.rows[3]?.topSymbols).toEqual([
          ["Effect.Effect", "type-reference", 2],
          ["Effect.gen", "call", 1],
        ]);
        expect(all.rows[4]?.topSymbols).toEqual([]);
        // The position filter scopes the counts, not just the search.
        expect(gen.rows.map((row) => [row["fullName"], row["file"], row["usages"]])).toEqual([
          ["org/repo-1", "src/a.ts", 3],
          ["org/repo-1", "src/b.ts", 1],
          ["org/repo-2", "src/x.ts", 7],
        ]);
        expect(tests.rows.map((row) => row["file"])).toEqual(["test/a.test.ts", "test/x.test.ts"]);
        expect([page.total, page.rows.map((row) => row["file"])]).toEqual([
          5,
          ["src/a.ts", "src/b.ts"],
        ]);
      }),
    ),
  );

  it.effect("exports the file selection as long-format CSV", () =>
    run(
      Effect.all([
        fileSymbolsCsv(defaultFilters, { path: "", uses: "" }),
        fileSymbolsCsv({ ...defaultFilters, role: "test" }, { path: "", uses: "" }),
      ]),
    ).pipe(
      Effect.map(([all, tests]) => {
        const lines = all.trim().split("\n");
        expect(lines[0]).toBe("repo,stars,commit,file,role,package_dir,loc,symbol,kind,count");
        expect(
          lines.slice(1).map((line) => line.split(",").filter((_, i) => [0, 3, 7, 9].includes(i))),
        ).toEqual([
          ["org/repo-1", "src/a.ts", "Effect.gen", "3"],
          ["org/repo-1", "src/b.ts", "Effect.Effect", "2"],
          ["org/repo-1", "src/b.ts", "Effect.gen", "1"],
          ["org/repo-1", "test/a.test.ts", "Effect.runPromise", "5"],
          ["org/repo-2", "src/x.ts", "Effect.gen", "7"],
          ["org/repo-2", "test/x.test.ts", "", ""],
        ]);
        expect(tests.trim().split("\n")).toHaveLength(3);
      }),
    ),
  );

  it.effect("pages raw tables, sorting only by real columns", () =>
    run(
      Effect.all([
        tablePage("repos", { limit: 2, offset: 0 }, { column: "stars", dir: "desc" }),
        tablePage("repos", { limit: 2, offset: 2 }, { column: "stars", dir: "desc" }),
        tablePage(
          "repos",
          { limit: 10, offset: 0 },
          { column: "stars; DROP TABLE repos", dir: "asc" },
        ),
        tablePage("file_symbols", { limit: 1, offset: 0 }, { column: "count", dir: "desc" }),
      ]),
    ).pipe(
      Effect.map(([first, second, injected, symbols]) => {
        expect(first.rows.map((row) => row["stars"])).toEqual([5000, 300]);
        expect(second.rows.map((row) => row["stars"])).toEqual([100, 50]);
        expect(first.columns).toContain("fullName");
        expect(first.sort).toEqual({ column: "stars", dir: "desc" });
        expect([injected.sort, injected.total]).toEqual([null, 4]);
        expect(symbols.rows[0]?.["count"]).toBe(7);
      }),
    ),
  );

  it.effect("filters and sorts repositories", () =>
    run(
      Effect.all([
        repositories(
          { ...defaultFilters, status: "adopters" },
          { key: "stars", dir: "desc" },
          { limit: 10, offset: 0 },
        ),
        repositories(
          { ...defaultFilters, q: "effect-ts" },
          { key: "stars", dir: "desc" },
          { limit: 10, offset: 0 },
        ),
        repositories(
          { ...defaultFilters, minStars: 200 },
          { key: "name", dir: "asc" },
          { limit: 1, offset: 1 },
        ),
      ]),
    ).pipe(
      Effect.map(([adopters, byTopic, paged]) => {
        expect(adopters.rows.map((row) => [row["fullName"], row["effectSpecs"]])).toEqual([
          ["org/repo-2", "^3.10.0"],
          ["org/repo-1", "^4.0.0"],
        ]);
        expect(byTopic.rows.map((row) => row["fullName"])).toEqual(["org/repo-1"]);
        expect([paged.total, paged.rows.map((row) => row["fullName"])]).toEqual([
          2,
          ["org/repo-3"],
        ]);
      }),
    ),
  );

  it.effect("details one repository", () =>
    run(repository(1, defaultFilters)).pipe(
      Effect.map((detail) => {
        expect(detail?.state).toMatchObject({
          fullName: "org/repo-1",
          status: "analyzed",
          topics: ["effect-ts"],
        });
        expect(detail?.files.total).toBe(3);
        expect(detail?.symbols[0]).toMatchObject({ symbol: "Effect.runPromise", usages: 5 });
        expect(detail?.catalogs).toEqual([{ manager: "pnpm", catalog: "default", spec: "^4.0.0" }]);
      }),
    ),
  );
});
