import { Effect } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import type { Fragment } from "effect/sql/Statement";
import type { SymbolKind } from "../domain/usage.ts";

/**
 * The read side of the state database, shaped for the viewer: every
 * function takes the viewer's global filters and returns JSON-ready rows.
 * Aggregation happens here, in SQL, so the browser never has to load the
 * per-file tables (which reach millions of rows on large crawls).
 */

export const repoStatuses = [
  "processed",
  "adopters",
  "analyzed",
  "excluded",
  "selected",
  "not-adopter",
  "failed",
] as const;

export type RepoStatusFilter = (typeof repoStatuses)[number];

/** `authored`: hand-written code, i.e. every role but `generated`. */
export const roles = ["all", "authored", "source", "test", "generated"] as const;
export type RoleFilter = (typeof roles)[number];

export const symbolKinds = [
  "all",
  "call",
  "property-access",
  "identifier",
  "type-reference",
] as const;
export type SymbolKindFilter = "all" | SymbolKind;

/** The viewer's global filters: they scope every chart, table and count. */
export interface Filters {
  /** Substring of the repository name or its topics. */
  readonly q: string;
  readonly status: RepoStatusFilter;
  readonly minStars: number;
  /** Which files the per-file metrics count: all, hand-written, production, test or generated. */
  readonly role: RoleFilter;
  /** Which symbol positions the symbol metrics count. */
  readonly kind: SymbolKindFilter;
}

export const defaultFilters: Filters = {
  q: "",
  status: "processed",
  minStars: 0,
  role: "all",
  kind: "all",
};

const oneOf = <A extends string>(
  values: ReadonlyArray<A>,
  value: string | undefined,
  fallback: A,
): A =>
  value !== undefined && (values as ReadonlyArray<string>).includes(value)
    ? (value as A)
    : fallback;

const nonNegativeInt = (
  value: string | undefined,
  fallback: number,
  max = Number.MAX_SAFE_INTEGER,
): number => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? Math.min(parsed, max) : fallback;
};

type Params = Readonly<Record<string, string | ReadonlyArray<string> | undefined>>;

const param = (params: Params, key: string): string | undefined => {
  const value = params[key];
  return typeof value === "string" ? value : value?.[0];
};

/** Filters from query parameters; anything invalid falls back to its default. */
export const parseFilters = (params: Params): Filters => ({
  q: (param(params, "q") ?? "").trim().slice(0, 200),
  status: oneOf(repoStatuses, param(params, "status"), defaultFilters.status),
  minStars: nonNegativeInt(param(params, "minStars"), 0),
  role: oneOf(roles, param(params, "role"), defaultFilters.role),
  kind: oneOf(symbolKinds, param(params, "kind"), defaultFilters.kind) as SymbolKindFilter,
});

/** Paging parameters; anything invalid falls back to its default, and `limit` is capped at 1000 (0 -> the default). */
export const parsePage = (params: Params, defaultLimit = 100) => ({
  limit: nonNegativeInt(param(params, "limit"), defaultLimit, 1000) || defaultLimit,
  offset: nonNegativeInt(param(params, "offset"), 0),
});

export { param };

const ratio = (part: number, whole: number): number => (whole === 0 ? 0 : part / whole);

/** An SQL aggregate as a number: null and non-numeric text become 0; numbers are returned unchanged, NaN included. */
const num = (value: unknown): number =>
  typeof value === "number" ? value : Number(value ?? 0) || 0;

// ---- SQL building blocks ----

const makeFragments = (sql: SqlClient.SqlClient, filters: Filters) => {
  const statusClause = (() => {
    switch (filters.status) {
      case "processed":
        return sql`1 = 1`;
      case "adopters":
        return sql`s.adopter = 1`;
      default:
        return sql`s.status = ${filters.status}`;
    }
  })();
  const pattern = `%${filters.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
  const clauses: Array<Fragment> = [statusClause];
  if (filters.q !== "") {
    clauses.push(
      sql`(s.full_name LIKE ${pattern} ESCAPE '\\' OR coalesce(r.topics, '') LIKE ${pattern} ESCAPE '\\')`,
    );
  }
  if (filters.minStars > 0) clauses.push(sql`coalesce(r.stars, 0) >= ${filters.minStars}`);

  /** `f(repo_id)`: the repositories the filters select. */
  const scope = sql`f AS (
    SELECT s.repo_id FROM repo_state s LEFT JOIN repos r ON r.id = s.repo_id
    WHERE ${sql.and(clauses)}
  )`;

  /** Restricts an `effect_files`-shaped alias to the role filter. */
  const role = (alias: string) =>
    filters.role === "all"
      ? sql`1 = 1`
      : filters.role === "authored"
        ? sql`${sql.literal(alias)}.role != 'generated'`
        : sql`${sql.literal(alias)}.role = ${filters.role}`;

  /** Restricts a `file_symbols` alias to the kind filter. */
  const kind = (alias: string) =>
    filters.kind === "all" ? sql`1 = 1` : sql`${sql.literal(alias)}.kind = ${filters.kind}`;

  /**
   * Joins a per-file table alias (`file_imports`, `file_symbols`) to its
   * `effect_files` row when the role filter needs the file's role.
   */
  const roleJoin = (alias: string) =>
    filters.role === "all"
      ? sql``
      : sql`JOIN effect_files e ON e.repo_id = ${sql.literal(alias)}.repo_id AND e.file = ${sql.literal(alias)}.file`;

  return { scope, role, kind, roleJoin };
};

// ---- meta ----

export const browsableTables = [
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
  "crawl_state",
  "v_population",
  "v_repo_adoption",
  "v_symbol_usage",
  "v_package_usage",
] as const;

export type BrowsableTable = (typeof browsableTables)[number];

/** JSON-in-TEXT columns, decoded for display. */
const jsonColumns = new Set(["topics", "raw", "timings", "names", "config", "counts", "cursor"]);

const decodeJsonColumns = (row: Record<string, unknown>): Record<string, unknown> => {
  const decoded: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (
      jsonColumns.has(key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)) &&
      typeof value === "string"
    ) {
      try {
        decoded[key] = JSON.parse(value);
        continue;
      } catch {
        // keep the raw text
      }
    }
    decoded[key] = value;
  }
  return decoded;
};

export interface Meta {
  readonly tables: ReadonlyArray<{ readonly name: string; readonly rows: number }>;
  readonly lastUpdate: string | null;
  readonly runs: ReadonlyArray<{
    readonly id: number;
    readonly command: string;
    readonly startedAt: string;
    readonly finishedAt: string | null;
    readonly adopterRatio: number | null;
    readonly codeUsageRatio: number | null;
    readonly probed: number | null;
  }>;
}

export const meta: Effect.Effect<Meta, SqlError, SqlClient.SqlClient> = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const tables = yield* Effect.forEach(browsableTables, (name) =>
    Effect.map(sql<{ rows: number }>`SELECT count(*) AS rows FROM ${sql(name)}`, (rows) => ({
      name,
      rows: rows[0]?.rows ?? 0,
    })),
  );
  const last = yield* sql<{ at: string | null }>`SELECT max(updated_at) AS at FROM repo_state`;
  const runs = yield* sql<{
    id: number;
    command: string;
    startedAt: string;
    finishedAt: string | null;
    counts: string | null;
  }>`SELECT id, command, started_at, finished_at, counts FROM runs ORDER BY id`;
  return {
    tables,
    lastUpdate: last[0]?.at ?? null,
    runs: runs.map((run) => {
      const counts =
        run.counts === null
          ? undefined
          : (JSON.parse(run.counts) as {
              population?: { adopterRatio?: number; analyzedRepos?: number };
              deepAnalysis?: { codeUsageRatio?: number };
            });
      return {
        id: run.id,
        command: run.command,
        startedAt: run.startedAt,
        finishedAt: run.finishedAt,
        adopterRatio: counts?.population?.adopterRatio ?? null,
        codeUsageRatio: counts?.deepAnalysis?.codeUsageRatio ?? null,
        probed: counts?.population?.analyzedRepos ?? null,
      };
    }),
  };
});

/**
 * One page of a raw table or view, JSON columns decoded, optionally sorted
 * by one of its columns. The column list comes from the schema, so the
 * header exists even for an empty table, and a sort column is only used
 * when the schema has it (it is interpolated as an identifier).
 */
export const tablePage = (
  name: BrowsableTable,
  page: { limit: number; offset: number },
  sort?: { readonly column: string; readonly dir: "asc" | "desc" },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const info = yield* sql<{ name: string }>`SELECT name FROM pragma_table_info(${name})`;
    // Results are camelCased (the client's result transform); sort keys come
    // back in that form, so both spellings are accepted.
    const columns = info.map((column) => column.name);
    const sortColumn =
      sort === undefined
        ? undefined
        : columns.find((column) => column === sort.column || snakeToCamel(column) === sort.column);
    const order =
      sortColumn === undefined
        ? sql``
        : sql`ORDER BY ${sql(sortColumn)} ${sql.literal(sort?.dir === "desc" ? "DESC" : "ASC")} NULLS LAST`;
    const total = yield* sql<{ rows: number }>`SELECT count(*) AS rows FROM ${sql(name)}`;
    const rows = yield* sql<Record<string, unknown>>`
      SELECT * FROM ${sql(name)} ${order} LIMIT ${page.limit} OFFSET ${page.offset}`;
    return {
      name,
      total: total[0]?.rows ?? 0,
      columns: columns.map(snakeToCamel),
      sort:
        sortColumn === undefined
          ? null
          : { column: snakeToCamel(sortColumn), dir: sort?.dir ?? "asc" },
      rows: rows.map(decodeJsonColumns),
    };
  });

const snakeToCamel = (name: string): string =>
  name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());

// ---- overview ----

/** The major version a manifest specifier pins, or a label for what it is instead. */
export const specMajor = (spec: string): string => {
  const text = spec.trim();
  if (text.startsWith("workspace:")) return "workspace";
  if (text.startsWith("catalog:")) return "unresolved catalog";
  if (/^(latest|next|beta|canary|\*|x)$/i.test(text) || text === "") return "dist-tag / any";
  if (/^(file:|link:|git|github:|https?:)/.test(text)) return "local / git";
  const alias = /^npm:[^@]+@(.*)$/.exec(text);
  const version = alias?.[1] ?? text;
  const major = /(\d+)/.exec(version.replace(/^[\^~<>=v\s]+/, ""))?.[1];
  return major === undefined ? "other" : `v${major}`;
};

/** Splits ranked rows into `count` equal-size bands (the last band takes the rest). */
const bands = <A>(rows: ReadonlyArray<A>, count: number): ReadonlyArray<ReadonlyArray<A>> => {
  if (rows.length === 0) return [];
  const size = Math.ceil(rows.length / count);
  const result: Array<ReadonlyArray<A>> = [];
  for (let i = 0; i < rows.length; i += size) result.push(rows.slice(i, i + size));
  return result;
};

const compactStars = (stars: number): string =>
  stars >= 1000 ? `${(stars / 1000).toFixed(stars >= 10_000 ? 0 : 1)}k` : String(stars);

const importBins = [
  { label: "1", min: 1, max: 1 },
  { label: "2", min: 2, max: 2 },
  { label: "3", min: 3, max: 3 },
  { label: "4", min: 4, max: 4 },
  { label: "5–9", min: 5, max: 9 },
  { label: "10–19", min: 10, max: 19 },
  { label: "20+", min: 20, max: Number.POSITIVE_INFINITY },
];

export const overview = (filters: Filters) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { scope, role, kind, roleJoin } = makeFragments(sql, filters);

    const [counts] = yield* sql<Record<string, number>>`
      WITH ${scope}
      SELECT
        count(*) AS processed,
        coalesce(sum(s.status != 'failed'), 0) AS probed,
        coalesce(sum(s.status = 'failed'), 0) AS failed,
        coalesce(sum(s.adopter = 1), 0) AS adopters,
        coalesce(sum(s.status = 'excluded'), 0) AS excluded,
        coalesce(sum(s.status = 'selected'), 0) AS selected,
        coalesce(sum(s.status = 'analyzed'), 0) AS analyzed
      FROM repo_state s JOIN f USING (repo_id)`;

    const [usage] = yield* sql<Record<string, number | null>>`
      WITH ${scope}
      SELECT count(DISTINCT e.repo_id) AS with_code_usage
      FROM effect_files e JOIN f USING (repo_id) JOIN repo_state s USING (repo_id)
      WHERE s.status = 'analyzed' AND ${role("e")}`;

    const [files] = yield* sql<Record<string, number | null>>`
      WITH ${scope}
      SELECT sum(t.files) AS ts_files, sum(t.effect_files) AS effect_files,
             sum(t.loc) AS loc, sum(t.effect_loc) AS effect_loc
      FROM file_totals t JOIN f USING (repo_id) JOIN repo_state s USING (repo_id)
      WHERE s.status = 'analyzed' AND ${role("t")}`;

    const c = {
      processed: num(counts?.["processed"]),
      probed: num(counts?.["probed"]),
      failed: num(counts?.["failed"]),
      adopters: num(counts?.["adopters"]),
      excluded: num(counts?.["excluded"]),
      selected: num(counts?.["selected"]),
      analyzed: num(counts?.["analyzed"]),
      withCodeUsage: num(usage?.["withCodeUsage"]),
      tsFiles: num(files?.["tsFiles"]),
      effectFiles: num(files?.["effectFiles"]),
      loc: num(files?.["loc"]),
      effectLoc: num(files?.["effectLoc"]),
    };

    // How `effect` is declared, per repository with any `effect` reference:
    // the strongest field wins (the adoption rule counts runtime only).
    const declared = yield* sql<{ fields: string }>`
      WITH ${scope}
      SELECT group_concat(DISTINCT m.field) AS fields
      FROM manifest_deps m JOIN f USING (repo_id)
      WHERE m.package = 'effect' GROUP BY m.repo_id`;
    const declaration = { runtime: 0, peer: 0, dev: 0 };
    for (const row of declared) {
      const fields = row.fields.split(",");
      if (fields.includes("dependencies") || fields.includes("optionalDependencies"))
        declaration.runtime++;
      else if (fields.includes("peerDependencies")) declaration.peer++;
      else declaration.dev++;
    }

    // Effect major versions among adopters, catalog references resolved.
    const specs = yield* sql<{ repoId: number; spec: string }>`
      WITH ${scope}
      SELECT m.repo_id, m.spec FROM manifest_deps m JOIN f USING (repo_id)
      JOIN repo_state s USING (repo_id)
      WHERE s.adopter = 1 AND m.package = 'effect'
        AND m.field IN ('dependencies', 'optionalDependencies')`;
    const catalogs = yield* sql<{ repoId: number; catalog: string; spec: string }>`
      WITH ${scope}
      SELECT c.repo_id, c.catalog, c.spec FROM catalog_versions c JOIN f USING (repo_id)`;
    const catalogSpec = new Map(catalogs.map((row) => [`${row.repoId}\0${row.catalog}`, row.spec]));
    const majorsByRepo = new Map<number, Set<string>>();
    for (const row of specs) {
      let spec = row.spec;
      if (spec.startsWith("catalog:")) {
        const name = spec.slice("catalog:".length) || "default";
        spec = catalogSpec.get(`${row.repoId}\0${name}`) ?? spec;
      }
      const majors = majorsByRepo.get(row.repoId) ?? new Set<string>();
      majors.add(specMajor(spec));
      majorsByRepo.set(row.repoId, majors);
    }
    const versionCounts = new Map<string, number>();
    for (const majors of majorsByRepo.values()) {
      // One version per repository: the highest pinned major, else the label.
      const numeric = [...majors]
        .filter((m) => /^v\d+$/.test(m))
        .sort((a, b) => Number(b.slice(1)) - Number(a.slice(1)));
      const label = numeric[0] ?? [...majors][0] ?? "other";
      versionCounts.set(label, (versionCounts.get(label) ?? 0) + 1);
    }
    const versions = [...versionCounts]
      .map(([label, repos]) => ({ label, repos }))
      .sort((a, b) => {
        const an = /^v(\d+)$/.exec(a.label)?.[1];
        const bn = /^v(\d+)$/.exec(b.label)?.[1];
        if (an !== undefined && bn !== undefined) return Number(bn) - Number(an);
        if (an !== undefined) return -1;
        if (bn !== undefined) return 1;
        return b.repos - a.repos;
      });

    // Adoption rate by popularity: five equal-size bands of the probed
    // repositories, ranked by stars.
    const ranked = yield* sql<{ stars: number | null; adopter: number | null }>`
      WITH ${scope}
      SELECT r.stars, s.adopter FROM repo_state s JOIN f USING (repo_id)
      LEFT JOIN repos r ON r.id = s.repo_id
      WHERE s.status != 'failed'
      ORDER BY coalesce(r.stars, 0) DESC`;
    const popularity = bands(ranked, 5).map((band) => {
      const adopters = band.filter((row) => row.adopter === 1).length;
      const high = num(band[0]?.stars);
      const low = num(band[band.length - 1]?.stars);
      return {
        label: `★ ${compactStars(low)}–${compactStars(high)}`,
        repos: band.length,
        adopters,
        rate: ratio(adopters, band.length),
      };
    });

    const packages = yield* sql<{ package: string; repos: number; files: number }>`
      WITH ${scope}
      SELECT i.package, count(DISTINCT i.repo_id) AS repos,
             count(DISTINCT i.repo_id || char(0) || i.file) AS files
      FROM file_imports i JOIN f USING (repo_id) JOIN repo_state s USING (repo_id)
      ${roleJoin("i")}
      WHERE s.status = 'analyzed' AND ${role("e")}
      GROUP BY i.package ORDER BY repos DESC, files DESC LIMIT 12`;

    const symbols = yield* sql<{ symbol: string; repos: number; files: number; usages: number }>`
      WITH ${scope}
      SELECT y.symbol, count(DISTINCT y.repo_id) AS repos,
             count(DISTINCT y.repo_id || char(0) || y.file) AS files, sum(y.count) AS usages
      FROM file_symbols y JOIN f USING (repo_id) JOIN repo_state s USING (repo_id)
      ${roleJoin("y")}
      WHERE s.status = 'analyzed' AND ${kind("y")} AND ${role("e")}
      GROUP BY y.symbol ORDER BY repos DESC, usages DESC LIMIT 15`;

    const depth = yield* sql<{
      repoId: number;
      fullName: string;
      tsFiles: number;
      effectFiles: number;
      loc: number | null;
      effectLoc: number | null;
    }>`
      WITH ${scope}
      SELECT s.repo_id, s.full_name, sum(t.files) AS ts_files, sum(t.effect_files) AS effect_files,
             sum(t.loc) AS loc, sum(t.effect_loc) AS effect_loc
      FROM file_totals t JOIN f USING (repo_id) JOIN repo_state s USING (repo_id)
      WHERE s.status = 'analyzed' AND ${role("t")}
      GROUP BY s.repo_id HAVING sum(t.effect_files) > 0
      ORDER BY sum(t.effect_files) * 1.0 / max(sum(t.files), 1) DESC, s.full_name LIMIT 15`;

    const importCounts = yield* sql<{ importCount: number; files: number }>`
      WITH ${scope}
      SELECT e.import_count, count(*) AS files
      FROM effect_files e JOIN f USING (repo_id) JOIN repo_state s USING (repo_id)
      WHERE s.status = 'analyzed' AND ${role("e")}
      GROUP BY e.import_count`;
    const histogram = importBins.map((bin) => ({
      label: bin.label,
      files: importCounts
        .filter((row) => row.importCount >= bin.min && row.importCount <= bin.max)
        .reduce((sum, row) => sum + row.files, 0),
    }));

    // Where Effect lives, by file role (the role filter does not apply: this
    // is the breakdown it filters on).
    const byRole = yield* sql<{
      role: string;
      files: number;
      effectFiles: number;
      loc: number | null;
      usages: number;
    }>`
      WITH ${scope},
      t AS (
        SELECT t.role, sum(t.files) AS files, sum(t.effect_files) AS effect_files, sum(t.loc) AS loc
        FROM file_totals t JOIN f USING (repo_id) JOIN repo_state s USING (repo_id)
        WHERE s.status = 'analyzed' GROUP BY t.role
      ),
      u AS (
        SELECT e.role, sum(y.count) AS usages
        FROM file_symbols y JOIN f USING (repo_id) JOIN repo_state s USING (repo_id)
        JOIN effect_files e ON e.repo_id = y.repo_id AND e.file = y.file
        WHERE s.status = 'analyzed' AND ${kind("y")} GROUP BY e.role
      )
      SELECT t.role, t.files, t.effect_files, t.loc, coalesce(u.usages, 0) AS usages
      FROM t LEFT JOIN u USING (role)
      ORDER BY CASE t.role WHEN 'source' THEN 0 WHEN 'test' THEN 1 ELSE 2 END`;

    return {
      counts: c,
      byRole,
      ratios: {
        adopters: ratio(c.adopters, c.probed),
        codeUsage: ratio(c.withCodeUsage, c.analyzed),
        effectFiles: ratio(c.effectFiles, c.tsFiles),
        effectLoc: ratio(c.effectLoc, c.loc),
      },
      declaration,
      versions,
      popularity,
      packages,
      symbols,
      depth: depth.map((row) => ({
        ...row,
        fileShare: ratio(row.effectFiles, row.tsFiles),
        locShare: row.loc === null ? null : ratio(num(row.effectLoc), row.loc),
      })),
      histogram,
    };
  });

// ---- repositories ----

const repoSorts = {
  stars: "coalesce(r.stars, 0)",
  name: "s.full_name",
  status: "s.status",
  tsFiles: "t.ts_files",
  effectFiles: "t.effect_files",
  depth: "depth",
  locShare: "loc_share",
  packages: "t.effect_packages",
  updated: "s.updated_at",
} as const;

export type RepoSort = keyof typeof repoSorts;

export const parseSort = <S extends string>(
  sorts: Readonly<Record<S, string>>,
  params: Params,
  fallback: S,
): { readonly key: S; readonly dir: "asc" | "desc" } => ({
  key: oneOf(Object.keys(sorts) as unknown as ReadonlyArray<S>, param(params, "sort"), fallback),
  dir: param(params, "dir") === "asc" ? "asc" : "desc",
});

export { repoSorts };

export const repositories = (
  filters: Filters,
  sort: { readonly key: RepoSort; readonly dir: "asc" | "desc" },
  page: { readonly limit: number; readonly offset: number },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { scope, role } = makeFragments(sql, filters);
    const order = sql.literal(
      `${repoSorts[sort.key]} ${sort.dir === "asc" ? "ASC" : "DESC"} NULLS LAST`,
    );

    const [total] = yield* sql<{ rows: number }>`WITH ${scope} SELECT count(*) AS rows FROM f`;
    const rows = yield* sql<Record<string, unknown>>`
      WITH ${scope},
      t AS (
        SELECT t.repo_id, sum(t.files) AS ts_files, sum(t.effect_files) AS effect_files,
               sum(t.loc) AS loc, sum(t.effect_loc) AS effect_loc,
               count(DISTINCT CASE WHEN t.effect_files > 0 THEN t.package_dir END) AS effect_packages
        FROM file_totals t JOIN f USING (repo_id) WHERE ${role("t")} GROUP BY t.repo_id
      ),
      d AS (
        -- runtime effect specifiers, catalog references resolved
        SELECT m.repo_id, group_concat(DISTINCT coalesce(c.spec, m.spec)) AS effect_specs
        FROM manifest_deps m JOIN f USING (repo_id)
        LEFT JOIN catalog_versions c ON c.repo_id = m.repo_id AND m.spec LIKE 'catalog:%'
          AND c.catalog = CASE WHEN m.spec = 'catalog:' THEN 'default' ELSE substr(m.spec, 9) END
        WHERE m.package = 'effect' AND m.field IN ('dependencies', 'optionalDependencies')
        GROUP BY m.repo_id
      )
      SELECT s.repo_id, s.full_name, r.stars, r.language, s.status, s.adopter, s.excluded_reason,
             s.error, s.error_stage, s.commit_sha, s.updated_at, s.manifest_count,
             t.ts_files, t.effect_files, t.loc, t.effect_loc, t.effect_packages, d.effect_specs,
             CASE WHEN t.ts_files > 0 AND s.status = 'analyzed'
                  THEN t.effect_files * 1.0 / t.ts_files END AS depth,
             CASE WHEN t.loc > 0 THEN t.effect_loc * 1.0 / t.loc END AS loc_share
      FROM repo_state s JOIN f USING (repo_id)
      LEFT JOIN repos r ON r.id = s.repo_id
      LEFT JOIN t USING (repo_id)
      LEFT JOIN d USING (repo_id)
      ORDER BY ${order}, s.full_name ASC
      LIMIT ${page.limit} OFFSET ${page.offset}`;
    return { total: total?.rows ?? 0, rows };
  });

/** Everything the repository drawer shows: the `repo_state` row joined with `repos`, the selection evidence, per-role totals, workspace packages, files and usage summaries. `undefined` when the repository has no recorded state. */
export const repository = (repoId: number, filters: Filters) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { role, kind, roleJoin } = makeFragments(sql, filters);

    const [state] = yield* sql<Record<string, unknown>>`
      SELECT s.repo_id, s.full_name, s.status, s.adopter, s.commit_sha, s.excluded_reason, s.error,
             s.error_stage, s.attempts, s.analyzer_version, s.manifest_count, s.timings, s.run_id,
             s.updated_at, r.stars, r.forks, r.language, r.license, r.topics, r.default_branch,
             r.html_url, r.created_at, r.pushed_at, r.size_kb
      FROM repo_state s LEFT JOIN repos r ON r.id = s.repo_id WHERE s.repo_id = ${repoId}`;
    if (state === undefined) return undefined;

    const deps = yield* sql`SELECT manifest, package, field, spec FROM manifest_deps
      WHERE repo_id = ${repoId} ORDER BY package = 'effect' DESC, package, manifest`;
    const catalogs =
      yield* sql`SELECT manager, catalog, spec FROM catalog_versions WHERE repo_id = ${repoId}`;
    const managers =
      yield* sql`SELECT manager, evidence FROM package_managers WHERE repo_id = ${repoId}`;
    const totals = yield* sql`SELECT role, extension, sum(files) AS files,
        sum(declaration_files) AS declaration_files, sum(loc) AS loc, sum(effect_files) AS effect_files,
        sum(effect_loc) AS effect_loc, sum(large_files) AS large_files, sum(unreadable_files) AS unreadable_files
      FROM file_totals WHERE repo_id = ${repoId} GROUP BY role, extension ORDER BY role, extension`;
    const packages = yield* sql`
      SELECT w.dir, w.name, w.effect_dependency, t.ts_files, t.effect_files, t.loc, t.effect_loc
      FROM workspace_packages w
      LEFT JOIN (
        SELECT t.package_dir, sum(t.files) AS ts_files, sum(t.effect_files) AS effect_files,
               sum(t.loc) AS loc, sum(t.effect_loc) AS effect_loc
        FROM file_totals t WHERE t.repo_id = ${repoId} AND ${role("t")} GROUP BY t.package_dir
      ) t ON t.package_dir = w.dir
      WHERE w.repo_id = ${repoId}
      ORDER BY coalesce(t.effect_files, 0) DESC, coalesce(t.ts_files, 0) DESC, w.dir LIMIT 500`;
    const [fileCount] = yield* sql<{ rows: number }>`
      SELECT count(*) AS rows FROM effect_files e WHERE e.repo_id = ${repoId} AND ${role("e")}`;
    const files = yield* sql`
      SELECT e.file, e.package_dir, e.role, e.extension, e.loc, e.bytes, e.parser, e.import_count, e.symbol_total
      FROM effect_files e WHERE e.repo_id = ${repoId} AND ${role("e")}
      ORDER BY e.symbol_total DESC, e.file LIMIT 1000`;
    const symbols = yield* sql`
      SELECT y.symbol, y.kind, sum(y.count) AS usages, count(*) AS files
      FROM file_symbols y ${roleJoin("y")}
      WHERE y.repo_id = ${repoId} AND ${kind("y")} AND ${role("e")}
      GROUP BY y.symbol, y.kind ORDER BY usages DESC, y.symbol LIMIT 30`;
    const imported = yield* sql`
      SELECT i.package, count(DISTINCT i.file) AS files, count(*) AS imports
      FROM file_imports i ${roleJoin("i")}
      WHERE i.repo_id = ${repoId} AND ${role("e")}
      GROUP BY i.package ORDER BY files DESC, i.package`;

    return {
      state: decodeJsonColumns(state),
      deps,
      catalogs,
      managers,
      totals,
      packages,
      files: { total: fileCount?.rows ?? 0, rows: files },
      symbols,
      imported,
    };
  });

export const repositoryFile = (repoId: number, file: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const imports = yield* sql<Record<string, unknown>>`
      SELECT module, package, kind, line, names FROM file_imports
      WHERE repo_id = ${repoId} AND file = ${file} ORDER BY line`;
    const symbols = yield* sql`
      SELECT symbol, kind, count FROM file_symbols
      WHERE repo_id = ${repoId} AND file = ${file} ORDER BY count DESC, symbol`;
    return { imports: imports.map(decodeJsonColumns), symbols };
  });

// ---- files ----

const fileSorts = {
  usages: "usages",
  symbols: "distinct_symbols",
  loc: "sel.loc",
  imports: "sel.import_count",
  file: "s.full_name, sel.file",
} as const;

export { fileSorts };
export type FileSort = keyof typeof fileSorts;

/** File-level searches of the Files view, on top of the global filters. */
export interface FileSearch {
  /** Substring of the file path. */
  readonly path: string;
  /** Only files using a symbol containing this text (e.g. `Layer.effect`). */
  readonly uses: string;
  /** Only the files of this repository (the repository drawer's "all files" link). */
  readonly repo?: number | undefined;
}

const likePattern = (text: string): string => `%${text.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;

/** How many of a file's symbols the Files table lists inline. */
const inlineSymbols = 12;

/**
 * The Effect files of the filtered repositories, one row per file, each with
 * its most used symbols inline (the complete list is `repositoryFile`).
 * Symbol counts honor the position filter; files that import Effect without
 * using any symbol through it are listed with zero.
 */
export const fileTable = (
  filters: Filters,
  search: FileSearch,
  sort: { readonly key: FileSort; readonly dir: "asc" | "desc" },
  page: { readonly limit: number; readonly offset: number },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { scope, role, kind } = makeFragments(sql, filters);
    const selection = fileSelection(sql, { scope, role, kind }, search);
    const direction = sort.dir === "asc" ? "ASC" : "DESC";
    const order = sql.literal(
      fileSorts[sort.key]
        .split(", ")
        .map((column) => `${column} ${direction}`)
        .join(", "),
    );

    const [totals] = yield* sql<{ files: number; repos: number }>`${selection}
      SELECT count(*) AS files, count(DISTINCT repo_id) AS repos FROM sel`;

    // Every step is one pass over a table (grouped, then joined), never a
    // per-file lookup: file_symbols reaches millions of rows.
    const rows = yield* sql<Record<string, unknown>>`${selection},
      sym AS (
        SELECT y.repo_id, y.file, count(*) AS distinct_symbols, sum(y.count) AS usages
        FROM file_symbols y JOIN f USING (repo_id)
        WHERE ${kind("y")} GROUP BY y.repo_id, y.file
      ),
      page AS (
        SELECT sel.repo_id, sel.file, s.full_name, s.commit_sha, r.html_url, r.stars,
               sel.role, sel.package_dir, sel.loc, sel.import_count, sel.parser,
               coalesce(sym.distinct_symbols, 0) AS distinct_symbols, coalesce(sym.usages, 0) AS usages
        FROM sel JOIN repo_state s USING (repo_id) LEFT JOIN repos r ON r.id = sel.repo_id
        LEFT JOIN sym ON sym.repo_id = sel.repo_id AND sym.file = sel.file
        ORDER BY ${order}, s.full_name ASC, sel.file ASC
        LIMIT ${page.limit} OFFSET ${page.offset}
      ),
      top AS (
        SELECT y.repo_id, y.file, y.symbol, y.kind, y.count,
               row_number() OVER (PARTITION BY y.repo_id, y.file ORDER BY y.count DESC, y.symbol) AS rank
        FROM file_symbols y
        WHERE y.repo_id IN (SELECT repo_id FROM page) AND ${kind("y")}
      )
      SELECT page.*, (
        SELECT json_group_array(json_array(t.symbol, t.kind, t.count)) FROM (
          SELECT top.symbol, top.kind, top.count FROM top
          WHERE top.repo_id = page.repo_id AND top.file = page.file AND top.rank <= ${inlineSymbols}
          ORDER BY top.rank
        ) t
      ) AS top_symbols
      FROM page`;

    return {
      total: totals?.files ?? 0,
      repos: totals?.repos ?? 0,
      rows: rows.map((row) => ({
        ...row,
        topSymbols: JSON.parse(String(row["topSymbols"] ?? "[]")) as ReadonlyArray<
          readonly [symbol: string, kind: string, count: number]
        >,
      })),
    };
  });

/**
 * `WITH f (scope), matched (files using the searched symbol), sel (the
 * selected Effect files)`, shared by the table and the CSV. The symbol
 * search is one scan of file_symbols, joined afterwards.
 */
const fileSelection = (
  sql: SqlClient.SqlClient,
  { scope, role, kind }: Pick<ReturnType<typeof makeFragments>, "scope" | "role" | "kind">,
  search: FileSearch,
) => {
  const pathClause =
    search.path === "" ? sql`1 = 1` : sql`sel_e.file LIKE ${likePattern(search.path)} ESCAPE '\\'`;
  const matched =
    search.uses === ""
      ? sql``
      : sql`, matched AS (
          SELECT DISTINCT u.repo_id, u.file FROM file_symbols u JOIN f USING (repo_id)
          WHERE u.symbol LIKE ${likePattern(search.uses)} ESCAPE '\\' AND ${kind("u")}
        )`;
  const matchedJoin =
    search.uses === ""
      ? sql``
      : sql`JOIN matched m ON m.repo_id = sel_e.repo_id AND m.file = sel_e.file`;
  const repoClause = search.repo === undefined ? sql`1 = 1` : sql`sel_e.repo_id = ${search.repo}`;
  return sql`
    WITH ${scope}${matched},
    sel AS (
      SELECT sel_e.* FROM effect_files sel_e JOIN f USING (repo_id) JOIN repo_state s USING (repo_id)
      ${matchedJoin}
      WHERE s.status = 'analyzed' AND ${role("sel_e")} AND ${pathClause} AND ${repoClause}
    )`;
};

const csvCell = (value: unknown): string => {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** Hard cap of the CSV export, far above any realistic selection. */
const csvRowLimit = 2_000_000;

/**
 * The same selection as `fileTable`, in long format — one line per file ×
 * symbol × position, files without symbols included once with empty symbol
 * columns — as CSV text, ready for pandas / DuckDB / a spreadsheet.
 */
export const fileSymbolsCsv = (filters: Filters, search: FileSearch) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { scope, role, kind } = makeFragments(sql, filters);
    const selection = fileSelection(sql, { scope, role, kind }, search);
    // `CROSS JOIN` makes SQLite scan file_symbols once and probe the
    // (auto-indexed) selection, instead of looking every file up in
    // file_symbols; files without any symbol are added from a grouped pass.
    const rows = yield* sql`${selection},
      lines AS (
        SELECT y.repo_id, y.file, y.symbol, y.kind, y.count
        FROM file_symbols y CROSS JOIN sel ON sel.repo_id = y.repo_id AND sel.file = y.file
        WHERE ${kind("y")}
      ),
      bare AS (
        SELECT sel.repo_id, sel.file, NULL AS symbol, NULL AS kind, NULL AS count
        FROM sel LEFT JOIN (SELECT DISTINCT repo_id, file FROM lines) l
          ON l.repo_id = sel.repo_id AND l.file = sel.file
        WHERE l.repo_id IS NULL
      )
      SELECT s.full_name AS repo, r.stars, s.commit_sha, x.file, sel.role, sel.package_dir, sel.loc,
             x.symbol, x.kind, x.count
      FROM (SELECT * FROM lines UNION ALL SELECT * FROM bare) x
      JOIN sel ON sel.repo_id = x.repo_id AND sel.file = x.file
      JOIN repo_state s ON s.repo_id = x.repo_id
      LEFT JOIN repos r ON r.id = x.repo_id
      ORDER BY s.full_name, x.file, x.count DESC, x.symbol
      LIMIT ${csvRowLimit}`.values;
    const header = "repo,stars,commit,file,role,package_dir,loc,symbol,kind,count";
    return `${[header, ...rows.map((row) => row.map(csvCell).join(","))].join("\n")}\n`;
  });

// ---- symbols ----

const symbolSorts = {
  repos: "repos",
  files: "files",
  usages: "usages",
  symbol: "y.symbol",
} as const;

export { symbolSorts };
export type SymbolSort = keyof typeof symbolSorts;

export const symbolTable = (
  filters: Filters,
  search: string,
  sort: { readonly key: SymbolSort; readonly dir: "asc" | "desc" },
  page: { readonly limit: number; readonly offset: number },
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { scope, role, kind, roleJoin } = makeFragments(sql, filters);
    const pattern = `%${search.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const searchClause = search === "" ? sql`1 = 1` : sql`y.symbol LIKE ${pattern} ESCAPE '\\'`;
    const order = sql.literal(`${symbolSorts[sort.key]} ${sort.dir === "asc" ? "ASC" : "DESC"}`);

    const [analyzed] = yield* sql<{ rows: number }>`
      WITH ${scope}
      SELECT count(*) AS rows FROM repo_state s JOIN f USING (repo_id) WHERE s.status = 'analyzed'`;
    const grouped = sql`
      SELECT y.symbol, y.kind, count(DISTINCT y.repo_id) AS repos,
             count(DISTINCT y.repo_id || char(0) || y.file) AS files, sum(y.count) AS usages
      FROM file_symbols y JOIN f USING (repo_id) JOIN repo_state s USING (repo_id)
      ${roleJoin("y")}
      WHERE s.status = 'analyzed' AND ${kind("y")} AND ${role("e")} AND ${searchClause}
      GROUP BY y.symbol, y.kind`;
    const [total] = yield* sql<{
      rows: number;
    }>`WITH ${scope} SELECT count(*) AS rows FROM (${grouped})`;
    const rows = yield* sql`WITH ${scope} ${grouped}
      ORDER BY ${order}, y.symbol ASC LIMIT ${page.limit} OFFSET ${page.offset}`;
    return { analyzedRepos: analyzed?.rows ?? 0, total: total?.rows ?? 0, rows };
  });

/** The repositories that use one symbol, most usages first. */
export const symbolRepositories = (
  filters: Filters,
  symbol: string,
  symbolKind: SymbolKindFilter,
) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const { scope, role, roleJoin } = makeFragments(sql, filters);
    const kindClause = symbolKind === "all" ? sql`1 = 1` : sql`y.kind = ${symbolKind}`;
    return yield* sql`
      WITH ${scope}
      SELECT s.repo_id, s.full_name, r.stars, count(DISTINCT y.file) AS files, sum(y.count) AS usages
      FROM file_symbols y JOIN f USING (repo_id) JOIN repo_state s USING (repo_id)
      LEFT JOIN repos r ON r.id = s.repo_id
      ${roleJoin("y")}
      WHERE s.status = 'analyzed' AND y.symbol = ${symbol} AND ${kindClause} AND ${role("e")}
      GROUP BY s.repo_id ORDER BY usages DESC, s.full_name LIMIT 200`;
  });
