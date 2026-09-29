import { Effect } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * Schema of the e20r state database. Every table below `repo_state` is a
 * child of one repository (`repo_id`) and is replaced as a whole whenever
 * that repository is committed, so a re-processed repository never leaves
 * stale or duplicate rows behind.
 */
const initial = [
  // The GitHub crawl: one row per repository ever seen, `raw` holding the
  // encoded search payload so it can be decoded back losslessly.
  `CREATE TABLE repos (
    id INTEGER PRIMARY KEY,
    full_name TEXT NOT NULL,
    owner TEXT NOT NULL,
    default_branch TEXT NOT NULL,
    html_url TEXT NOT NULL,
    stars INTEGER NOT NULL,
    forks INTEGER NOT NULL,
    size_kb INTEGER NOT NULL,
    language TEXT,
    license TEXT,
    topics TEXT NOT NULL,
    created_at TEXT NOT NULL,
    pushed_at TEXT NOT NULL,
    raw TEXT NOT NULL,
    crawled_at TEXT NOT NULL
  )`,
  `CREATE INDEX repos_rank ON repos (stars DESC, forks DESC, full_name)`,

  // Resumable crawl cursor (a single row).
  `CREATE TABLE crawl_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    cursor TEXT,
    complete INTEGER NOT NULL,
    budget INTEGER NOT NULL,
    pages INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  )`,

  // Pipeline state per repository: the resume source of truth.
  `CREATE TABLE repo_state (
    repo_id INTEGER PRIMARY KEY,
    full_name TEXT NOT NULL,
    status TEXT NOT NULL,
    adopter INTEGER,
    commit_sha TEXT,
    excluded_reason TEXT,
    error TEXT,
    error_stage TEXT,
    manifest_count INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    analyzer_version INTEGER,
    timings TEXT,
    run_id INTEGER,
    updated_at TEXT NOT NULL
  )`,
  `CREATE INDEX repo_state_status ON repo_state (status)`,

  // Selection evidence.
  `CREATE TABLE manifest_deps (
    repo_id INTEGER NOT NULL,
    manifest TEXT NOT NULL,
    package TEXT NOT NULL,
    field TEXT NOT NULL,
    spec TEXT NOT NULL
  )`,
  `CREATE INDEX manifest_deps_repo ON manifest_deps (repo_id)`,
  `CREATE TABLE catalog_versions (
    repo_id INTEGER NOT NULL,
    manager TEXT NOT NULL,
    catalog TEXT NOT NULL,
    spec TEXT NOT NULL
  )`,
  `CREATE INDEX catalog_versions_repo ON catalog_versions (repo_id)`,
  `CREATE TABLE package_managers (
    repo_id INTEGER NOT NULL,
    manager TEXT NOT NULL,
    evidence TEXT NOT NULL
  )`,
  `CREATE INDEX package_managers_repo ON package_managers (repo_id)`,
  `CREATE TABLE workspace_packages (
    repo_id INTEGER NOT NULL,
    dir TEXT NOT NULL,
    name TEXT,
    effect_dependency TEXT
  )`,
  `CREATE INDEX workspace_packages_repo ON workspace_packages (repo_id)`,

  // File inventory (every probed repository; split by workspace package for
  // adopters only, `package_dir` NULL otherwise) and deep analysis.
  `CREATE TABLE file_totals (
    repo_id INTEGER NOT NULL,
    package_dir TEXT,
    role TEXT NOT NULL,
    extension TEXT NOT NULL,
    files INTEGER NOT NULL,
    declaration_files INTEGER NOT NULL,
    loc INTEGER,
    effect_files INTEGER,
    effect_loc INTEGER,
    large_files INTEGER,
    unreadable_files INTEGER
  )`,
  `CREATE INDEX file_totals_repo ON file_totals (repo_id)`,
  `CREATE TABLE effect_files (
    repo_id INTEGER NOT NULL,
    file TEXT NOT NULL,
    package_dir TEXT NOT NULL,
    role TEXT NOT NULL,
    extension TEXT NOT NULL,
    loc INTEGER NOT NULL,
    bytes INTEGER NOT NULL,
    parser TEXT NOT NULL,
    import_count INTEGER NOT NULL,
    symbol_total INTEGER NOT NULL,
    PRIMARY KEY (repo_id, file)
  )`,
  `CREATE TABLE file_imports (
    repo_id INTEGER NOT NULL,
    file TEXT NOT NULL,
    module TEXT NOT NULL,
    package TEXT NOT NULL,
    kind TEXT NOT NULL,
    line INTEGER NOT NULL,
    names TEXT NOT NULL
  )`,
  `CREATE INDEX file_imports_repo ON file_imports (repo_id)`,
  `CREATE TABLE file_symbols (
    repo_id INTEGER NOT NULL,
    file TEXT NOT NULL,
    symbol TEXT NOT NULL,
    kind TEXT NOT NULL,
    count INTEGER NOT NULL
  )`,
  `CREATE INDEX file_symbols_repo ON file_symbols (repo_id)`,
  `CREATE INDEX file_symbols_symbol ON file_symbols (symbol)`,

  `CREATE TABLE runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    command TEXT NOT NULL,
    started_at TEXT NOT NULL,
    finished_at TEXT,
    config TEXT NOT NULL,
    counts TEXT
  )`,

  // ---- aggregation views ----

  // "Out of N repos probed, M adopt Effect": the population as a whole.
  `CREATE VIEW v_population AS
  SELECT
    count(*) AS processed,
    coalesce(sum(status != 'failed'), 0) AS probed,
    coalesce(sum(status = 'failed'), 0) AS failed,
    coalesce(sum(adopter = 1), 0) AS adopters,
    coalesce(sum(status = 'excluded'), 0) AS excluded,
    coalesce(sum(status = 'selected'), 0) AS awaiting_analysis,
    coalesce(sum(status = 'analyzed'), 0) AS analyzed,
    (SELECT count(DISTINCT e.repo_id) FROM effect_files e
       JOIN repo_state s ON s.repo_id = e.repo_id AND s.status = 'analyzed') AS analyzed_with_code_usage
  FROM repo_state`,

  // Adoption depth per analyzed adopter.
  `CREATE VIEW v_repo_adoption AS
  SELECT
    s.repo_id,
    s.full_name,
    r.stars,
    s.commit_sha,
    sum(t.files) AS ts_files,
    sum(t.effect_files) AS effect_files,
    sum(t.loc) AS loc,
    sum(t.effect_loc) AS effect_loc,
    sum(CASE WHEN t.role = 'source' THEN t.files ELSE 0 END) AS source_files,
    sum(CASE WHEN t.role = 'source' THEN t.effect_files ELSE 0 END) AS source_effect_files,
    count(DISTINCT t.package_dir) AS packages,
    count(DISTINCT CASE WHEN t.effect_files > 0 THEN t.package_dir END) AS effect_packages
  FROM repo_state s
  LEFT JOIN repos r ON r.id = s.repo_id
  LEFT JOIN file_totals t ON t.repo_id = s.repo_id
  WHERE s.status = 'analyzed'
  GROUP BY s.repo_id`,

  // Which Effect APIs adopters use, and how widely.
  `CREATE VIEW v_symbol_usage AS
  SELECT
    f.symbol,
    f.kind,
    sum(f.count) AS usages,
    count(DISTINCT f.file || char(0) || f.repo_id) AS files,
    count(DISTINCT f.repo_id) AS repos
  FROM file_symbols f
  JOIN repo_state s ON s.repo_id = f.repo_id AND s.status = 'analyzed'
  GROUP BY f.symbol, f.kind`,

  // Which Effect packages adopters import, and how widely.
  `CREATE VIEW v_package_usage AS
  SELECT
    i.package,
    count(*) AS imports,
    count(DISTINCT i.file || char(0) || i.repo_id) AS files,
    count(DISTINCT i.repo_id) AS repos
  FROM file_imports i
  JOIN repo_state s ON s.repo_id = i.repo_id AND s.status = 'analyzed'
  GROUP BY i.package`,
];

/**
 * The `generated` file role (next to `source` and `test`): the per-repo
 * adoption view splits generated files out, so adoption depth can be read
 * over hand-written code only. Role columns are plain TEXT, so the tables
 * themselves need no change.
 */
const generatedRole = [
  `DROP VIEW v_repo_adoption`,
  `CREATE VIEW v_repo_adoption AS
  SELECT
    s.repo_id,
    s.full_name,
    r.stars,
    s.commit_sha,
    sum(t.files) AS ts_files,
    sum(t.effect_files) AS effect_files,
    sum(t.loc) AS loc,
    sum(t.effect_loc) AS effect_loc,
    sum(CASE WHEN t.role = 'source' THEN t.files ELSE 0 END) AS source_files,
    sum(CASE WHEN t.role = 'source' THEN t.effect_files ELSE 0 END) AS source_effect_files,
    sum(CASE WHEN t.role = 'generated' THEN t.files ELSE 0 END) AS generated_files,
    sum(CASE WHEN t.role = 'generated' THEN t.effect_files ELSE 0 END) AS generated_effect_files,
    sum(CASE WHEN t.role != 'generated' THEN t.files ELSE 0 END) AS authored_files,
    sum(CASE WHEN t.role != 'generated' THEN t.effect_files ELSE 0 END) AS authored_effect_files,
    count(DISTINCT t.package_dir) AS packages,
    count(DISTINCT CASE WHEN t.effect_files > 0 THEN t.package_dir END) AS effect_packages
  FROM repo_state s
  LEFT JOIN repos r ON r.id = s.repo_id
  LEFT JOIN file_totals t ON t.repo_id = s.repo_id
  WHERE s.status = 'analyzed'
  GROUP BY s.repo_id`,
];

const run = (statements: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    for (const statement of statements) yield* sql.unsafe(statement);
  });

/**
 * Per-file lookups (a file's symbols and imports, the viewer's Files view)
 * go by `(repo_id, file)`; the `repo_id` indexes alone make each lookup a
 * scan of the whole repository's rows.
 */
const fileIndexes = [
  `CREATE INDEX file_symbols_file ON file_symbols (repo_id, file)`,
  `CREATE INDEX file_imports_file ON file_imports (repo_id, file)`,
];

export const migrations = {
  "0001_initial": run(initial),
  "0002_generated_role": run(generatedRole),
  "0003_file_indexes": run(fileIndexes),
};
