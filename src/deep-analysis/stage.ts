import { DateTime, Effect, FileSystem, Option, Path, Result } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { CacheDir } from "../cache.ts";
import type { EffectRepoState } from "../domain/effect-repo.ts";
import {
  hasEffectCodeUsage,
  type AnalysisSignal,
  type AnalysisState,
} from "../domain/analysis-state.ts";
import { ensureCloned, type CloneTarget } from "../github/clone.ts";
import { analyzeDeep } from "./probe.ts";

export interface DeepAnalysisOptions {
  /** Re-analyze even when a matching record already exists. */
  readonly fresh: boolean;
  /** Delete the clone once its analysis is durably recorded. */
  readonly ephemeral: boolean;
  /**
   * Repositories analyzed in parallel. Deliberately separate from the clone
   * concurrency: every analyzed repository spawns a language server that
   * loads whole TypeScript projects (hundreds of MB to a few GB each).
   */
  readonly concurrency: number;
  /** Whether the AST phase may run (symbol counts, exact imports). */
  readonly ast: boolean;
}

export interface DeepAnalysisOutcome {
  /** Adopters analyzed into a new `analyzed` record. */
  readonly analyzed: number;
  /** Adopters whose recorded analysis already covers the current snapshot. */
  readonly alreadyRecorded: number;
  /** Adopters whose clone could not be prepared for analysis. */
  readonly failures: number;
  /** Of the analyzed adopters, those whose source tree imports Effect. */
  readonly codeUsage: number;
}

/** The headline numbers of one analysis, for the progress log line. */
const describeUsage = (signals: ReadonlyArray<AnalysisSignal>): string => {
  let tsFiles = 0;
  let effectFiles = 0;
  let symbolUsages = 0;
  for (const signal of signals) {
    if (signal._tag === "ts-file-count") tsFiles = signal.total;
    else if (signal._tag === "files-using-effect-count") effectFiles = signal.count;
    else if (signal._tag === "effect-symbols-per-file") symbolUsages += signal.total;
  }
  return `${tsFiles} ts files, ${effectFiles} using effect, ${symbolUsages} symbol usages`;
};

const secondsSince = (started: number): string => `${((Date.now() - started) / 1000).toFixed(1)}s`;

/**
 * The deep-analysis stage: runs the effect-usage probes over every selected
 * Effect adopter and records the result in `analysis-state.jsonl`, keyed by
 * `repoId` like the other stages.
 *
 * The stage works from the adopter record alone (`fullName`, `defaultBranch`,
 * `commit`); the crawl cache is only consulted for convenience fields. A
 * repository crawled in this very run is analyzed in this very run — nothing
 * about the workflow can make an adopter unanalyzable.
 *
 * The analyzed snapshot is whatever the clone's HEAD is: the same run that
 * selected the adopter analyzes that exact commit, and a later run (which may
 * have re-cloned a moved default branch) records the commit it actually saw.
 *
 * Resume semantics per adopter, unless `fresh`:
 *
 * - a recorded `analyzed` and no clone on disk -> nothing new to see, skipped
 *   (re-cloning just to discover that would be pure cost under `--ephemeral`);
 * - a recorded `analyzed` and a clone at the same commit -> skipped;
 * - a recorded `analyzed` and a clone at a new commit -> re-analyzed;
 * - a recorded `analysis-failed` -> retried;
 * - nothing recorded -> cloned if needed and analyzed.
 *
 * A clone failure never supersedes a recorded `analyzed` state: a transient
 * network failure must not turn good analysis into a failure record.
 */
export const runDeepAnalysis = (
  adopters: ReadonlyArray<EffectRepoState>,
  options: DeepAnalysisOptions,
): Effect.Effect<
  DeepAnalysisOutcome,
  never,
  CacheDir | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const cache = yield* CacheDir;
    const fs = yield* FileSystem.FileSystem;
    const reposById = yield* cache.reposById;
    const analysisStateById = yield* cache.analysisStateById;

    // Mutable accumulator; the returned shape is the readonly outcome.
    const counts = {
      analyzed: 0,
      alreadyRecorded: 0,
      failures: 0,
      codeUsage: 0,
    };

    const recordState = (state: AnalysisState): Effect.Effect<boolean> =>
      Effect.gen(function* () {
        // A hard failure to record is logged and carried on with: the run
        // keeps working, and the repo's missing record makes the next run
        // re-analyze it.
        const written = yield* cache.appendAnalysisStates([state]).pipe(Effect.option);
        if (Option.isNone(written)) {
          yield* Effect.logWarning(
            `Failed to record analysis state of ${state.fullName} after retries`,
          );
          return false;
        }
        return written.value > 0;
      });

    yield* Effect.forEach(
      adopters,
      Effect.fn("analyze-adopter")(function* (adopter) {
        const started = Date.now();

        // The adopter record is enough to clone; the crawl record only adds
        // convenience fields (an authoritative clone URL).
        const crawled = reposById.get(adopter.repoId);
        const target: CloneTarget = {
          fullName: adopter.fullName,
          defaultBranch: crawled?.defaultBranch ?? adopter.defaultBranch,
          htmlUrl: crawled?.htmlUrl ?? `https://github.com/${adopter.fullName}`,
        };

        const cloneDir = cache.cloneDirFor(target);
        const prior = analysisStateById.get(adopter.repoId);
        const cloneExists = Option.getOrElse(
          yield* Effect.option(fs.exists(cloneDir)),
          () => false,
        );

        if (!options.fresh && prior?.analysisStatus === "analyzed" && !cloneExists) {
          counts.alreadyRecorded++;
          yield* Effect.log(`already analyzed ${adopter.fullName} (skipped, no clone on disk)`);
          return;
        }

        const outcomeClone = yield* ensureCloned(target, cloneDir).pipe(Effect.result);

        if (Result.isFailure(outcomeClone)) {
          counts.failures++;
          const error = Option.getOrUndefined(Result.getFailure(outcomeClone));
          if (prior?.analysisStatus === "analyzed") {
            yield* Effect.logWarning(
              `Kept the recorded analysis of ${adopter.fullName}: its clone could not be prepared (${error ?? "unknown error"})`,
            );
            return;
          }
          yield* Effect.log(`analysis failed for ${adopter.fullName}: ${error ?? "unknown error"}`);
          yield* recordState({
            repoId: adopter.repoId,
            fullName: adopter.fullName,
            analysisStatus: "analysis-failed",
            ...(error === undefined ? {} : { analysisError: error }),
            signals: [],
            recordedAt: yield* DateTime.now,
          });
          return;
        }

        const commit = outcomeClone.success.commit;

        if (!options.fresh && prior?.analysisStatus === "analyzed" && prior.commit === commit) {
          counts.alreadyRecorded++;
          yield* Effect.log(
            `already analyzed ${adopter.fullName} at ${commit.slice(0, 10)} (skipped)`,
          );
          if (options.ephemeral) {
            yield* Effect.ignore(fs.remove(cloneDir, { recursive: true, force: true }));
          }
          return;
        }

        const signals = yield* analyzeDeep(cloneDir, target, { ast: options.ast });
        const recorded = yield* recordState({
          repoId: adopter.repoId,
          fullName: adopter.fullName,
          commit,
          analysisStatus: "analyzed",
          signals: [...signals],
          recordedAt: yield* DateTime.now,
        });

        counts.analyzed++;
        const usage = hasEffectCodeUsage(signals);
        if (usage) counts.codeUsage++;

        yield* Effect.log(
          `analyzed ${adopter.fullName} (${usage ? "effect in code" : "manifest only"}): ` +
            `${describeUsage(signals)} in ${secondsSince(started)}`,
        );

        // Clones are deleted only once their state is durably recorded;
        // otherwise the next run would have to re-clone anyway.
        if (recorded && options.ephemeral) {
          yield* Effect.ignore(fs.remove(cloneDir, { recursive: true, force: true }));
        }
      }),
      { concurrency: options.concurrency },
    );

    return counts;
  });
