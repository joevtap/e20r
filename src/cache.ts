import { Context, Effect, FileSystem, Layer, Option, Path, Schema, Schedule } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { AppConfig } from "./config.ts";
import { GithubRepoSchema, type GithubRepo } from "./domain/github.ts";
import { RepoCloneStateSchema, type RepoCloneState } from "./domain/clone-state.ts";
import { EffectRepoStateSchema, type EffectRepoState } from "./domain/effect-repo.ts";

// The cache files store the encoded (GitHub wire / state schema) form of each
// record so they can be decoded back losslessly.
const encodeRepo = Schema.encodeSync(GithubRepoSchema);
const decodeRepo = Schema.decodeUnknownOption(GithubRepoSchema);

const encodeCloneState = Schema.encodeSync(RepoCloneStateSchema);
const decodeCloneState = Schema.decodeUnknownOption(RepoCloneStateSchema);

const encodeEffectRepo = Schema.encodeSync(EffectRepoStateSchema);
const decodeEffectRepo = Schema.decodeUnknownOption(EffectRepoStateSchema);

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
 *   hand-off to the (not yet defined) deep analysis stage.
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
  readonly cloneStateById: Effect.Effect<ReadonlyMap<number, RepoCloneState>, PlatformError>;

  /**
   * Crawled repositories per repository id (last record winning), so resumed
   * runs can reconstruct records that only reference a repo id.
   */
  readonly reposById: Effect.Effect<ReadonlyMap<number, GithubRepo>, PlatformError>;

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

    // --clean starts the run from an empty cache: every state file and every
    // clone is removed before anything is loaded, so the run re-derives all
    // state from scratch instead of resuming.
    if (config.clean) {
      for (const file of [reposFile, cloneStateFile, effectReposFile]) {
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

    const appendCloneStates = (
      clones: ReadonlyArray<RepoCloneState>,
    ): Effect.Effect<number, PlatformError> =>
      Effect.gen(function* () {
        if (clones.length === 0) return 0;

        const payload = clones.map((clone) => JSON.stringify(encodeCloneState(clone))).join("\n");

        yield* writeWithRetry(
          fs.writeFileString(cloneStateFile, `${payload}\n`, {
            flag: "a+",
          }),
        );

        for (const clone of clones) {
          cloneStatesById.set(clone.repoId, clone);
        }

        return clones.length;
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
    } satisfies CacheDirValue;
  }),
);
