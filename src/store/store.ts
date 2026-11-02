import { Array as Arr, Context, DateTime, Effect, Layer, Option, Schema } from "effect";
import * as SqlClient from "effect/sql/SqlClient";
import type { SqlError } from "effect/sql/SqlError";
import type { EffectFileRow, FileTotalsRow } from "../deep-analysis/analyze.ts";
import { GithubRepoSchema, type GithubRepo } from "../domain/github.ts";
import type { DependencyField, Signal } from "../domain/selection.ts";

/**
 * The pipeline's durable state, in one SQLite database. The store is the
 * only resume source: clones are throwaway, and a repository is either
 * committed as a whole (one transaction) or not at all, so a crash or an
 * interruption only ever costs the repositories that were in flight.
 */

export type RepoStatus = "not-adopter" | "excluded" | "selected" | "analyzed" | "failed";

/** A crawled repository as the pipeline needs it (the clone target plus ranking). */
export interface RepoRecord {
  readonly id: number;
  readonly fullName: string;
  readonly owner: string;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
  readonly stars: number;
}

export interface PriorState {
  readonly status: RepoStatus;
  readonly attempts: number;
  readonly analyzerVersion: number | null;
}

/** Where a star-interval crawl stands (see `src/github/search.ts`). */
export interface CrawlCursor {
  readonly url: string;
  readonly lastSeenStars: number | null;
  readonly intervalBound: number | null;
}

export interface CrawlState {
  /** The next page to fetch; null once the crawl is complete. */
  readonly cursor: CrawlCursor | null;
  readonly complete: boolean;
  readonly budget: number;
  readonly pages: number;
}

export interface WorkspacePackageRow {
  readonly dir: string;
  readonly name: string | null;
  /** The strongest field declaring `effect` (runtime first), null when none does. */
  readonly effectDependency: DependencyField | null;
}

/** Everything one processed repository contributes, committed atomically. */
export interface RepoOutcome {
  readonly repoId: number;
  readonly fullName: string;
  readonly runId: number;
  readonly status: Exclude<RepoStatus, "failed">;
  readonly commit: string;
  readonly adopter: boolean;
  readonly excludedReason: string | null;
  /** `package.json` files outside `node_modules`: how "monorepo" the repository is. */
  readonly manifestCount: number;
  readonly signals: ReadonlyArray<Signal>;
  readonly workspacePackages: ReadonlyArray<WorkspacePackageRow>;
  readonly totals: ReadonlyArray<FileTotalsRow>;
  readonly effectFiles: ReadonlyArray<EffectFileRow>;
  readonly analyzerVersion: number | null;
  readonly timings: Readonly<Record<string, number>>;
}

export interface RepoFailure {
  readonly repoId: number;
  readonly fullName: string;
  readonly runId: number;
  readonly stage: string;
  readonly error: string;
  readonly timings: Readonly<Record<string, number>>;
}

/** The counts of the `v_population` view: `processed` counts every repository with a recorded state, `probed` the same minus `failed`. */
export interface Population {
  readonly processed: number;
  readonly probed: number;
  readonly failed: number;
  readonly adopters: number;
  readonly excluded: number;
  readonly awaitingAnalysis: number;
  readonly analyzed: number;
  readonly analyzedWithCodeUsage: number;
}

export interface StoreService {
  readonly crawlState: Effect.Effect<Option.Option<CrawlState>, SqlError>;
  /**
   * Upserts one crawled page and advances the cursor in the same
   * transaction, so a resumed crawl never skips or double-counts a page.
   * Returns the number of repositories not seen before.
   */
  readonly saveCrawlPage: (
    repos: ReadonlyArray<GithubRepo>,
    state: CrawlState,
  ) => Effect.Effect<number, SqlError>;
  readonly setCrawlState: (state: CrawlState) => Effect.Effect<void, SqlError>;
  readonly resetCrawl: Effect.Effect<void, SqlError>;
  /** Stars of the repository at the given 1-based rank, if that many are crawled. */
  readonly starsAtRank: (rank: number) => Effect.Effect<number | undefined, SqlError>;
  readonly repoCount: Effect.Effect<number, SqlError>;
  /** The top repositories by stars, then forks, then name. */
  readonly topRepos: (budget: number) => Effect.Effect<ReadonlyArray<RepoRecord>, SqlError>;
  readonly priorStates: Effect.Effect<ReadonlyMap<number, PriorState>, SqlError>;
  readonly commitRepo: (outcome: RepoOutcome) => Effect.Effect<void, SqlError>;
  readonly recordFailure: (failure: RepoFailure) => Effect.Effect<void, SqlError>;
  /** Forgets the attempt counts of failed repositories (`--retry-failed`). */
  readonly resetFailures: Effect.Effect<number, SqlError>;
  readonly startRun: (command: string, config: unknown) => Effect.Effect<number, SqlError>;
  readonly finishRun: (runId: number, counts: unknown) => Effect.Effect<void, SqlError>;
  readonly population: Effect.Effect<Population, SqlError>;
}

export class Store extends Context.Service<Store, StoreService>()("e20r/Store") {}

const encodeRepo = Schema.encodeSync(GithubRepoSchema);

/** Multi-row inserts are chunked well below SQLite's bound-parameter limit. */
const chunk = <A>(rows: ReadonlyArray<A>, size = 200): ReadonlyArray<ReadonlyArray<A>> => {
  const chunks: Array<ReadonlyArray<A>> = [];
  for (let i = 0; i < rows.length; i += size) chunks.push(rows.slice(i, i + size));
  return chunks;
};

const fieldStrength: Readonly<Record<DependencyField, number>> = {
  dependencies: 0,
  optionalDependencies: 1,
  peerDependencies: 2,
  devDependencies: 3,
};

/** The strongest dependency field among the given ones (runtime first). */
export const strongestField = (fields: ReadonlyArray<DependencyField>): DependencyField | null =>
  fields.reduce<DependencyField | null>(
    (best, field) => (best === null || fieldStrength[field] < fieldStrength[best] ? field : best),
    null,
  );

/** The child tables keyed by `repo_id`, wiped on every commit so a re-processed repository leaves no stale rows. */
const childTables = [
  "manifest_deps",
  "catalog_versions",
  "package_managers",
  "workspace_packages",
  "file_totals",
  "effect_files",
  "file_imports",
  "file_symbols",
] as const;

export const StoreLayer = Layer.effect(
  Store,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    const now = Effect.map(DateTime.now, DateTime.formatIso);

    const insertAll = (
      table: string,
      rows: ReadonlyArray<Record<string, unknown>>,
    ): Effect.Effect<void, SqlError> =>
      Effect.forEach(
        Arr.filter(chunk(rows), Arr.isReadonlyArrayNonEmpty),
        (batch) => sql`INSERT INTO ${sql(table)} ${sql.insert(batch)}`,
        {
          discard: true,
        },
      );

    const crawlState = Effect.map(
      sql<{
        cursor: string | null;
        complete: number;
        budget: number;
        pages: number;
      }>`SELECT cursor, complete, budget, pages FROM crawl_state WHERE id = 1`,
      (rows) =>
        Option.map(Option.fromUndefinedOr(rows[0]), (row): CrawlState => ({
          cursor: row.cursor === null ? null : (JSON.parse(row.cursor) as CrawlCursor),
          complete: row.complete === 1,
          budget: row.budget,
          pages: row.pages,
        })),
    );

    const setCrawlState = (state: CrawlState) =>
      Effect.gen(function* () {
        yield* sql`INSERT INTO crawl_state ${sql.insert({
          id: 1,
          cursor: state.cursor === null ? null : JSON.stringify(state.cursor),
          complete: state.complete ? 1 : 0,
          budget: state.budget,
          pages: state.pages,
          updatedAt: yield* now,
        })}
        ON CONFLICT (id) DO UPDATE SET cursor = excluded.cursor, complete = excluded.complete,
          budget = excluded.budget, pages = excluded.pages, updated_at = excluded.updated_at`;
      });

    const saveCrawlPage = (repos: ReadonlyArray<GithubRepo>, state: CrawlState) =>
      Effect.gen(function* () {
        const crawledAt = yield* now;
        const ids = repos.map((repo) => repo.id);
        const known =
          ids.length === 0
            ? []
            : yield* sql<{ id: number }>`SELECT id FROM repos WHERE ${sql.in("id", ids)}`;
        const knownIds = new Set(known.map((row) => row.id));

        for (const batch of chunk(repos)) {
          if (!Arr.isReadonlyArrayNonEmpty(batch)) continue;
          yield* sql`INSERT INTO repos ${sql.insert(
            Arr.map(batch, (repo) => ({
              id: repo.id,
              fullName: repo.fullName,
              owner: repo.owner.login,
              defaultBranch: repo.defaultBranch,
              htmlUrl: repo.htmlUrl,
              stars: repo.stargazersCount,
              forks: repo.forksCount,
              sizeKb: repo.size,
              language: repo.language,
              license: repo.license?.spdxId ?? null,
              topics: JSON.stringify(repo.topics),
              createdAt: DateTime.formatIso(repo.createdAt),
              pushedAt: DateTime.formatIso(repo.pushedAt),
              raw: JSON.stringify(encodeRepo(repo)),
              crawledAt,
            })),
          )}
          ON CONFLICT (id) DO UPDATE SET
            full_name = excluded.full_name, owner = excluded.owner,
            default_branch = excluded.default_branch, html_url = excluded.html_url,
            stars = excluded.stars, forks = excluded.forks, size_kb = excluded.size_kb,
            language = excluded.language, license = excluded.license, topics = excluded.topics,
            created_at = excluded.created_at, pushed_at = excluded.pushed_at,
            raw = excluded.raw, crawled_at = excluded.crawled_at`;
        }

        yield* setCrawlState(state);

        return ids.filter((id) => !knownIds.has(id)).length;
      }).pipe(sql.withTransaction);

    const commitRepo = (outcome: RepoOutcome) =>
      Effect.gen(function* () {
        const repoId = outcome.repoId;
        for (const table of childTables) {
          yield* sql`DELETE FROM ${sql(table)} WHERE repo_id = ${repoId}`;
        }

        for (const signal of outcome.signals) {
          switch (signal._tag) {
            case "effect-in-package-json":
              yield* insertAll(
                "manifest_deps",
                signal.occurrences.map((occ) => ({
                  repoId,
                  manifest: occ.file,
                  package: occ.package,
                  field: occ.field,
                  spec: occ.version,
                })),
              );
              break;
            case "effect-version-in-catalog":
              yield* insertAll(
                "catalog_versions",
                signal.entries.map((entry) => ({
                  repoId,
                  manager: signal.manager,
                  catalog: entry.catalog,
                  spec: entry.version,
                })),
              );
              break;
            case "uses-pnpm":
            case "uses-bun":
            case "uses-npm":
              yield* insertAll("package_managers", [
                { repoId, manager: signal._tag.slice("uses-".length), evidence: signal.evidence },
              ]);
              break;
          }
        }

        yield* insertAll(
          "workspace_packages",
          outcome.workspacePackages.map((row) => ({ repoId, ...row })),
        );
        yield* insertAll(
          "file_totals",
          outcome.totals.map((row) => ({ repoId, ...row })),
        );
        yield* insertAll(
          "effect_files",
          outcome.effectFiles.map((row) => ({
            repoId,
            file: row.file,
            packageDir: row.packageDir,
            role: row.role,
            extension: row.extension,
            loc: row.loc,
            bytes: row.bytes,
            parser: row.parser,
            importCount: row.imports.length,
            symbolTotal: row.symbols.reduce((sum, symbol) => sum + symbol.count, 0),
          })),
        );
        yield* insertAll(
          "file_imports",
          outcome.effectFiles.flatMap((row) =>
            row.imports.map((entry) => ({
              repoId,
              file: row.file,
              module: entry.module,
              package: entry.package,
              kind: entry.kind,
              line: entry.line,
              names: JSON.stringify(entry.names),
            })),
          ),
        );
        yield* insertAll(
          "file_symbols",
          outcome.effectFiles.flatMap((row) =>
            row.symbols.map((symbol) => ({
              repoId,
              file: row.file,
              symbol: symbol.symbol,
              kind: symbol.kind,
              count: symbol.count,
            })),
          ),
        );

        yield* sql`INSERT INTO repo_state ${sql.insert({
          repoId,
          fullName: outcome.fullName,
          status: outcome.status,
          adopter: outcome.adopter ? 1 : 0,
          commitSha: outcome.commit,
          excludedReason: outcome.excludedReason,
          manifestCount: outcome.manifestCount,
          error: null,
          errorStage: null,
          attempts: 0,
          analyzerVersion: outcome.analyzerVersion,
          timings: JSON.stringify(outcome.timings),
          runId: outcome.runId,
          updatedAt: yield* now,
        })}
        ON CONFLICT (repo_id) DO UPDATE SET full_name = excluded.full_name,
          status = excluded.status, adopter = excluded.adopter, commit_sha = excluded.commit_sha,
          excluded_reason = excluded.excluded_reason, manifest_count = excluded.manifest_count,
          error = NULL, error_stage = NULL,
          attempts = 0, analyzer_version = excluded.analyzer_version,
          timings = excluded.timings, run_id = excluded.run_id, updated_at = excluded.updated_at`;
      }).pipe(sql.withTransaction);

    // A failure never erases recorded work: a repository committed earlier
    // keeps its status and rows (a transient network failure must not turn
    // good analysis into a failure record); only never-committed or
    // previously failed repositories become `failed`, counting attempts.
    const recordFailure = (failure: RepoFailure) =>
      Effect.gen(function* () {
        yield* sql`INSERT INTO repo_state ${sql.insert({
          repoId: failure.repoId,
          fullName: failure.fullName,
          status: "failed",
          error: failure.error,
          errorStage: failure.stage,
          attempts: 1,
          timings: JSON.stringify(failure.timings),
          runId: failure.runId,
          updatedAt: yield* now,
        })}
        ON CONFLICT (repo_id) DO UPDATE SET
          error = excluded.error, error_stage = excluded.error_stage,
          attempts = repo_state.attempts + 1, timings = excluded.timings,
          run_id = excluded.run_id, updated_at = excluded.updated_at
        WHERE repo_state.status = 'failed'`;
      });

    return {
      crawlState,
      saveCrawlPage,
      setCrawlState,
      resetCrawl: Effect.asVoid(sql`DELETE FROM crawl_state`),
      starsAtRank: (rank) =>
        Effect.map(
          sql<{ stars: number }>`SELECT stars FROM repos
            ORDER BY stars DESC, forks DESC, full_name ASC LIMIT 1 OFFSET ${rank - 1}`,
          (rows) => rows[0]?.stars,
        ),
      repoCount: Effect.map(
        sql<{ count: number }>`SELECT count(*) AS count FROM repos`,
        (rows) => rows[0]?.count ?? 0,
      ),
      topRepos: (budget) =>
        sql<RepoRecord>`SELECT id, full_name, owner, default_branch, html_url, stars FROM repos
          ORDER BY stars DESC, forks DESC, full_name ASC LIMIT ${budget}`,
      priorStates: Effect.map(
        sql<
          PriorState & { repoId: number }
        >`SELECT repo_id, status, attempts, analyzer_version FROM repo_state`,
        (rows) =>
          new Map(
            rows.map((row) => [
              row.repoId,
              { status: row.status, attempts: row.attempts, analyzerVersion: row.analyzerVersion },
            ]),
          ),
      ),
      commitRepo,
      recordFailure,
      resetFailures: Effect.map(
        sql`UPDATE repo_state SET attempts = 0 WHERE status = 'failed'`.raw,
        (result) => (result as { changes?: number }).changes ?? 0,
      ),
      startRun: (command, config) =>
        Effect.gen(function* () {
          const rows = yield* sql<{ id: number }>`INSERT INTO runs ${sql.insert({
            command,
            startedAt: yield* now,
            config: JSON.stringify(config),
          })} RETURNING id`;
          return rows[0]?.id ?? 0;
        }),
      finishRun: (runId, counts) =>
        Effect.gen(function* () {
          yield* sql`UPDATE runs SET finished_at = ${yield* now}, counts = ${JSON.stringify(counts)}
            WHERE id = ${runId}`;
        }),
      population: Effect.map(
        sql<Population>`SELECT * FROM v_population`,
        (rows) =>
          rows[0] ?? {
            processed: 0,
            probed: 0,
            failed: 0,
            adopters: 0,
            excluded: 0,
            awaitingAnalysis: 0,
            analyzed: 0,
            analyzedWithCodeUsage: 0,
          },
      ),
    } satisfies StoreService;
  }),
);
