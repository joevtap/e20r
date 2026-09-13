import { Context, Effect, FileSystem, Layer, Option, Path, Schema } from "effect";
import type { PlatformError } from "effect/PlatformError";
import { AppConfig } from "./config.ts";
import { GithubRepoSchema, type GithubRepo } from "./domain/github.ts";
import { RepoAnalysisSchema, type RepoAnalysis } from "./domain/analysis.ts";

// The cache files store the encoded (GitHub wire / analysis schema) form of
// each record so they can be decoded back losslessly.
const encodeRepo = Schema.encodeSync(GithubRepoSchema);
const decodeRepo = Schema.decodeUnknownOption(GithubRepoSchema);

const encodeAnalysis = Schema.encodeSync(RepoAnalysisSchema);
const decodeAnalysis = Schema.decodeUnknownOption(RepoAnalysisSchema);

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
const parseAnalysisLine = parseLine(decodeAnalysis);

/**
 * Collects the ids already recorded in a JSONL file so re-runs do not append
 * duplicates. Unparseable lines are skipped. Missing files are not an error.
 */
const loadSeenIds = <A>(
  readFileString: (path: string) => Effect.Effect<string, PlatformError>,
  file: string,
  parse: (line: string) => Option.Option<A>,
  getId: (record: A) => number,
): Effect.Effect<Set<number>, PlatformError> =>
  Effect.gen(function* () {
    const contents = Option.getOrElse(yield* readFileString(file).pipe(Effect.option), () => "");

    const seen = new Set<number>();
    for (const line of contents.split("\n")) {
      const trimmed = line.trim();
      if (trimmed === "") continue;
      Option.match(parse(trimmed), {
        onNone: () => {},
        onSome: (record) => seen.add(getId(record)),
      });
    }
    return seen;
  });

/**
 * Local on-disk cache for the data gathered by the analysis pipeline.
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
   * Appends repositories to the cache file, skipping the ones already present
   * (resume/dedupe). Returns the number of newly written entries.
   */
  readonly appendRepos: (repos: ReadonlyArray<GithubRepo>) => Effect.Effect<number, PlatformError>;

  /**
   * Ids of repositories already analyzed (resume for the analysis stage).
   */
  readonly analyzedIds: Effect.Effect<ReadonlySet<number>, PlatformError>;

  /**
   * Appends analysis records to the cache file, skipping the ones already
   * present (resume/dedupe). Returns the number of newly written entries.
   */
  readonly appendAnalyses: (
    analyses: ReadonlyArray<RepoAnalysis>,
  ) => Effect.Effect<number, PlatformError>;
}

export class CacheDir extends Context.Service<CacheDir, CacheDirValue>()("e20r/CacheDir") {}

export const CacheDirLayer = Layer.effect(
  CacheDir,
  Effect.gen(function* () {
    const config = yield* AppConfig;

    if (config.noCache) {
      return {
        root: "",
        enabled: false,
        cloneDirFor: () => "",
        appendRepos: () => Effect.succeed(0),
        analyzedIds: Effect.succeed(new Set<number>()),
        appendAnalyses: () => Effect.succeed(0),
      } satisfies CacheDirValue;
    }

    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const root = config.cachePath;
    const clonesDir = path.join(root, "clones");
    const reposFile = path.join(root, "repos.jsonl");
    const analysesFile = path.join(root, "analyses.jsonl");

    yield* fs.makeDirectory(clonesDir, { recursive: true });

    const seenRepos = yield* loadSeenIds(
      (file) => fs.readFileString(file),
      reposFile,
      parseRepoLine,
      (repo) => repo.id,
    );

    // Loaded once and kept live: `appendAnalyses` mutates it, so both
    // within-run and cross-run resume see the same dedupe state.
    const seenAnalyses = yield* loadSeenIds(
      (file) => fs.readFileString(file),
      analysesFile,
      parseAnalysisLine,
      (analysis) => analysis.repoId,
    );

    const appendRecords = <A>(
      file: string,
      seen: Set<number>,
      records: ReadonlyArray<A>,
      encode: (record: A) => unknown,
      getId: (record: A) => number,
    ): Effect.Effect<number, PlatformError> =>
      Effect.gen(function* () {
        const fresh = records.filter((record) => !seen.has(getId(record)));
        if (fresh.length === 0) return 0;

        const payload = fresh.map((record) => JSON.stringify(encode(record))).join("\n");

        yield* fs.writeFileString(file, `${payload}\n`, {
          flag: "a+",
        });

        for (const record of fresh) {
          seen.add(getId(record));
        }

        return fresh.length;
      });

    return {
      root,
      enabled: true,
      cloneDirFor: (repo) => path.join(clonesDir, ...repo.fullName.split("/")),
      appendRepos: (repos) =>
        appendRecords(reposFile, seenRepos, repos, encodeRepo, (repo) => repo.id),
      analyzedIds: Effect.succeed(seenAnalyses),
      appendAnalyses: (analyses) =>
        appendRecords(
          analysesFile,
          seenAnalyses,
          analyses,
          encodeAnalysis,
          (analysis) => analysis.repoId,
        ),
    } satisfies CacheDirValue;
  }),
);
