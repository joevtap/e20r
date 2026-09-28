import { Context, Effect, FileSystem, Layer, Option, Path, Schema, Schedule } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { AppConfig } from "./config.ts";
import { GithubRepoSchema, type GithubRepo } from "./domain/github.ts";
import { RepoCloneStateSchema, type RepoCloneState } from "./domain/clone-state.ts";
import { EffectRepoStateSchema, type EffectRepoState } from "./domain/effect-repo.ts";
import { AnalysisStateSchema, type AnalysisState } from "./domain/analysis-state.ts";
import { RunSummarySchema, type RunSummary } from "./domain/run-summary.ts";

// The cache files store the encoded (GitHub wire / state schema) form of each
// record so they can be decoded back losslessly.
const encodeRepo = Schema.encodeSync(GithubRepoSchema);
const decodeRepo = Schema.decodeUnknownOption(GithubRepoSchema);

const encodeCloneState = Schema.encodeSync(RepoCloneStateSchema);
const decodeCloneState = Schema.decodeUnknownOption(RepoCloneStateSchema);

const encodeEffectRepo = Schema.encodeSync(EffectRepoStateSchema);
const decodeEffectRepo = Schema.decodeUnknownOption(EffectRepoStateSchema);

const encodeAnalysisState = Schema.encodeSync(AnalysisStateSchema);
const decodeAnalysisState = Schema.decodeUnknownOption(AnalysisStateSchema);

const encodeRunSummary = Schema.encodeSync(RunSummarySchema);

const parseLine =
  <A>(decode: (value: unknown) => Option.Option<A>) =>
  (line: string): Option.Option<A> => {
    try {
      return decode(JSON.parse(line));
    } catch {
      return Option.none();
    }
  };

const parseRepoLine = parseLine(decodeRepo);
const parseCloneStateLine = parseLine(decodeCloneState);
const parseEffectRepoLine = parseLine(decodeEffectRepo);
const parseAnalysisStateLine = parseLine(decodeAnalysisState);

/**
 * Reads every record of a JSONL cache file. Unparseable lines are skipped.
 * Missing files are not an error and yield an empty list.
 */
const loadRecords = <A>(
  readFileString: (path: string) => Effect.Effect<string, PlatformError>,
  file: string,
  parse: (line: string) => Option.Option<A>,
): Effect.Effect<Array<A>, PlatformError> =>
  Effect.gen(function* () {
    const contents = Option.getOrElse(yield* readFileString(file).pipe(Effect.option), () => "");

    const records: Array<A> = [];
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      Option.match(parse(trimmed), {
        onNone: () => {},
        onSome: (record) => records.push(record),
      });
    }
    return records;
  });

const writeWithRetry = <A>(
  effect: Effect.Effect<A, PlatformError>,
): Effect.Effect<A, PlatformError> =>
  effect.pipe(Effect.retry({ times: 2, schedule: Schedule.exponential("100 millis") }));

/**
 * Local on-disk cache for the data gathered by the analysis pipeline.
 *
 * Each pipeline stage owns one JSONL state file inside the cache root, keyed
 * by `repoId`:
 *
 * - `repos.jsonl`: every repository seen by the GitHub crawl.
 * - `clone-state.jsonl`: clone outcome and Effect-adoption selection per repo.
 * - `effect-repos.jsonl`: repos positively selected as Effect adopters, the
 *   hand-off to the deep analysis stage.
 * - `analysis-state.jsonl`: Effect-usage analysis per adopter, the output of
 *   the deep analysis stage.
 * - `run-summary.jsonl`: one population summary per run (analyzed repos,
 *   adopters, ratios), appended so the ratio survives per run.
 *
 * Writes are appended incrementally as records are produced, so a crash keeps
 * completed progress on disk and the next run resumes where it stopped.
 * Transient write failures are retried before being reported.
 *
 * When caching is disabled (`--no-cache`), the service degrades to a no-op:
 * nothing is read from disk and nothing is written, the run stays in memory.
 */
export interface CacheDirValue {
  readonly root: string;
  readonly enabled: boolean;

  /**
   * Directory where the clone of the given repository lives (or should be
   * cloned into): `<root>/clones/<org>/<name>`.
   */
  readonly cloneDirFor: (repo: GithubRepo) => string;

  /**
   * Appends crawled repositories to the cache file, skipping the ones already
   * present (resume/dedupe). Returns the number of newly written entries.
   */
  readonly appendRepos: (repos: ReadonlyArray<GithubRepo>) => Effect.Effect<number, PlatformError>;

  /**
   * Cloning and selection state per repository id, last record winning so
   * clone-failed records are replaced by retried runs.
   */
  readonly cloneStateById: Effect.Effect<ReadonlyMap<number, RepoCloneState>>;

  /**
   * Crawled repositories per repository id (last record winning), so resumed
   * runs can reconstruct records that only reference a repo id.
   */
  readonly reposById: Effect.Effect<ReadonlyMap<number, GithubRepo>>;

  /**
   * Appends clone-state records to the cache file as soon as they are
   * produced, without dedupe: failed clones are retried on later runs and
   * their new record supersedes the previous one (last record wins when
   * loading). Returns the number of written entries.
   */
  readonly appendCloneStates: (
    clones: ReadonlyArray<RepoCloneState>,
  ) => Effect.Effect<number, PlatformError>;

  /**
   * Appends Effect adopter selections to the cache file, skipping the ones
   * already present (resume/dedupe). Returns the number of newly written
   * entries.
   */
  readonly appendEffectRepos: (
    effectRepos: ReadonlyArray<EffectRepoState>,
  ) => Effect.Effect<number, PlatformError>;

  /**
   * Deep-analysis state per repository id (last record winning), so resumed
   * runs know which adopters were already analyzed at which commit.
   */
  readonly analysisStateById: Effect.Effect<ReadonlyMap<number, AnalysisState>>;

  /**
   * Appends deep-analysis records to the cache file as soon as they are
   * produced, without dedupe: failed analyses are retried on later runs and
   * their new record supersedes the previous one (last record wins when
   * loading). Returns the number of written entries.
   */
  readonly appendAnalysisStates: (
    states: ReadonlyArray<AnalysisState>,
  ) => Effect.Effect<number, PlatformError>;

  /**
   * Appends one population summary per run, unconditionally: summaries are
   * facts about their moment in time and are never superseded. Returns the
   * number of written entries.
   */
  readonly appendRunSummaries: (
    summaries: ReadonlyArray<RunSummary>,
  ) => Effect.Effect<number, PlatformError>;
}

export class CacheDir extends Context.Service<CacheDir, CacheDirValue>()("e20r/CacheDir") {}

export const CacheDirLayer = Layer.effect(
  CacheDir,
  Effect.gen(function* () {
    const config = yield* AppConfig;

    if (config.noCache) {
      // Without a cache there is no clone directory to reuse, so clones live
      // in a throwaway temporary directory for the duration of the run: the
      // scoped temp directory is removed when the layer's scope closes
      // (analyses never outlive the run in this mode).
      return yield* Effect.gen(function* () {
        const fs = yield* FileSystem.FileSystem;
        const path = yield* Path.Path;
        const tempRoot = yield* fs.makeTempDirectoryScoped({ prefix: "e20r-nocache-" });
        yield* fs.makeDirectory(path.join(tempRoot, "clones"), { recursive: true });

        return {
          root: tempRoot,
          enabled: false,
          cloneDirFor: (repo) => path.join(tempRoot, "clones", ...repo.fullName.split("/")),
          appendRepos: () => Effect.succeed(0),
          cloneStateById: Effect.succeed(new Map<number, RepoCloneState>()),
          reposById: Effect.succeed(new Map<number, GithubRepo>()),
          appendCloneStates: () => Effect.succeed(0),
          appendEffectRepos: () => Effect.succeed(0),
          analysisStateById: Effect.succeed(new Map<number, AnalysisState>()),
          appendAnalysisStates: () => Effect.succeed(0),
          appendRunSummaries: () => Effect.succeed(0),
        } satisfies CacheDirValue;
      });
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const root = config.cachePath;
    const clonesDir = path.join(root, "clones");
    const reposFile = path.join(root, "repos.jsonl");
    const cloneStateFile = path.join(root, "clone-state.jsonl");
    const effectReposFile = path.join(root, "effect-repos.jsonl");
    const analysisStateFile = path.join(root, "analysis-state.jsonl");
    const runSummaryFile = path.join(root, "run-summary.jsonl");

    // --clean starts the run from an empty cache: every state file and every
    // clone is removed before anything is loaded, so the run re-derives all
    // state from scratch instead of resuming.
    if (config.clean) {
      for (const file of [
        reposFile,
        cloneStateFile,
        effectReposFile,
        analysisStateFile,
        runSummaryFile,
      ]) {
        yield* Effect.ignore(fs.remove(file, { force: true }));
      }
      yield* Effect.ignore(fs.remove(clonesDir, { recursive: true, force: true }));
    }

    yield* fs.makeDirectory(clonesDir, { recursive: true });

    // Loaded once and kept live: the append operations mutate them, so both
    // within-run and cross-run resume see the same dedupe/state state.
    const reposById = new Map<number, GithubRepo>();
    const repoIds = new Set<number>();
    for (const repo of yield* loadRecords(
      (file) => fs.readFileString(file),
      reposFile,
      parseRepoLine,
    )) {
      reposById.set(repo.id, repo);
      repoIds.add(repo.id);
    }

    const cloneStatesById = new Map<number, RepoCloneState>();
    for (const clone of yield* loadRecords(
      (file) => fs.readFileString(file),
      cloneStateFile,
      parseCloneStateLine,
    )) {
      cloneStatesById.set(clone.repoId, clone);
    }

    const effectRepoIds = new Set<number>();
    for (const effectRepo of yield* loadRecords(
      (file) => fs.readFileString(file),
      effectReposFile,
      parseEffectRepoLine,
    )) {
      effectRepoIds.add(effectRepo.repoId);
    }

    const analysisStateById = new Map<number, AnalysisState>();
    for (const state of yield* loadRecords(
      (file) => fs.readFileString(file),
      analysisStateFile,
      parseAnalysisStateLine,
    )) {
      analysisStateById.set(state.repoId, state);
    }

    /**
     * Appends records to a JSONL file, skipping the ids already seen and
     * updating the live id bookkeeping. A single `a+` write per batch keeps
     * concurrent appends line-atomic.
     */
    const appendNewRecords = <A>(
      file: string,
      seenIds: Set<number>,
      records: ReadonlyArray<A>,
      encode: (record: A) => unknown,
      getId: (record: A) => number,
    ): Effect.Effect<number, PlatformError> =>
      Effect.gen(function* () {
        const fresh = records.filter((record) => !seenIds.has(getId(record)));
        if (fresh.length === 0) return 0;

        const payload = fresh.map((record) => JSON.stringify(encode(record))).join("\n");

        yield* writeWithRetry(
          fs.writeFileString(file, `${payload}\n`, {
            flag: "a+",
          }),
        );

        for (const record of fresh) {
          seenIds.add(getId(record));
        }

        return fresh.length;
      });

    /**
     * Appends records to a JSONL file without dedupe, in a single `a+` write
     * per batch so concurrent appends stay line-atomic.
     */
    const appendAllRecords = <A>(
      file: string,
      records: ReadonlyArray<A>,
      encode: (record: A) => unknown,
    ): Effect.Effect<number, PlatformError> =>
      Effect.gen(function* () {
        if (records.length === 0) return 0;

        const payload = records.map((record) => JSON.stringify(encode(record))).join("\n");

        yield* writeWithRetry(
          fs.writeFileString(file, `${payload}\n`, {
            flag: "a+",
          }),
        );

        return records.length;
      });

    const appendCloneStates = (
      clones: ReadonlyArray<RepoCloneState>,
    ): Effect.Effect<number, PlatformError> =>
      Effect.gen(function* () {
        const written = yield* appendAllRecords(cloneStateFile, clones, encodeCloneState);
        for (const clone of clones) {
          cloneStatesById.set(clone.repoId, clone);
        }
        return written;
      });

    const appendAnalysisStates = (
      states: ReadonlyArray<AnalysisState>,
    ): Effect.Effect<number, PlatformError> =>
      Effect.gen(function* () {
        const written = yield* appendAllRecords(analysisStateFile, states, encodeAnalysisState);
        for (const state of states) {
          analysisStateById.set(state.repoId, state);
        }
        return written;
      });

    return {
      root,
      enabled: true,
      cloneDirFor: (repo) => path.join(clonesDir, ...repo.fullName.split("/")),

      appendRepos: (repos) =>
        appendNewRecords(reposFile, repoIds, repos, encodeRepo, (repo) => repo.id),
      appendEffectRepos: (effectRepos) =>
        appendNewRecords(
          effectReposFile,
          effectRepoIds,
          effectRepos,
          encodeEffectRepo,
          (effectRepo) => effectRepo.repoId,
        ),
      cloneStateById: Effect.succeed(cloneStatesById),
      reposById: Effect.succeed(reposById),
      appendCloneStates,
      appendAnalysisStates,
      analysisStateById: Effect.succeed(analysisStateById),
      appendRunSummaries: (summaries) =>
        appendAllRecords(runSummaryFile, summaries, encodeRunSummary),
    } satisfies CacheDirValue;
  }),
);
