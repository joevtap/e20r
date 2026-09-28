import { DateTime, Effect, FileSystem, Option, Path, Result } from "effect";
import { ChildProcessSpawner } from "effect/unstable/process";
import { CacheDir } from "../cache.ts";
import type { EffectRepoState } from "../domain/effect-repo.ts";
import { hasEffectCodeUsage, type AnalysisState } from "../domain/analysis-state.ts";
import { ensureCloned } from "../github/clone.ts";
import { analyzeDeep } from "./probe.ts";

export interface DeepAnalysisOptions {
  /** Re-analyze even when a matching record already exists. */
  readonly fresh: boolean;
  /** Delete the clone once its analysis is durably recorded. */
  readonly ephemeral: boolean;
  readonly concurrency: number;
}

export interface DeepAnalysisOutcome {
  /** Adopters analyzed into a new `analyzed` record. */
  readonly analyzed: number;
  /** Adopters whose recorded analysis already covers the current snapshot. */
  readonly alreadyRecorded: number;
  /** Adopters whose clone could not be prepared for analysis. */
  readonly failures: number;
  /** Adopters skipped because the crawl cache does not know the repository. */
  readonly missingRepos: number;
  /** Of the analyzed adopters, those whose source tree imports Effect. */
  readonly codeUsage: number;
}

/**
 * The deep-analysis stage: runs the effect-usage probes over every selected
 * Effect adopter and records the result in `analysis-state.jsonl`, keyed by
 * `repoId` like the other stages.
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
      missingRepos: 0,
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
        const repo = reposById.get(adopter.repoId);
        if (repo === undefined) {
          counts.missingRepos++;
          yield* Effect.logWarning(
            `Cannot analyze ${adopter.fullName}: not in the crawl cache (partial cache?)`,
          );
          return;
        }

        const cloneDir = cache.cloneDirFor(repo);
        const prior = analysisStateById.get(adopter.repoId);
        const cloneExists = Option.getOrElse(
          yield* Effect.option(fs.exists(cloneDir)),
          () => false,
        );

        if (!options.fresh && prior?.analysisStatus === "analyzed" && !cloneExists) {
          counts.alreadyRecorded++;
          return;
        }

        const outcomeClone = yield* ensureCloned(repo, cloneDir).pipe(Effect.result);

        if (Result.isFailure(outcomeClone)) {
          counts.failures++;
          const error = Option.getOrUndefined(Result.getFailure(outcomeClone));
          if (prior?.analysisStatus === "analyzed") {
            yield* Effect.logWarning(
              `Kept the recorded analysis of ${adopter.fullName}: its clone could not be prepared (${error ?? "unknown error"})`,
            );
            return;
          }
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
          if (options.ephemeral) {
            yield* Effect.ignore(fs.remove(cloneDir, { recursive: true, force: true }));
          }
          return;
        }

        const signals = yield* analyzeDeep(cloneDir, repo);
        const recorded = yield* recordState({
          repoId: adopter.repoId,
          fullName: adopter.fullName,
          commit,
          analysisStatus: "analyzed",
          signals: [...signals],
          recordedAt: yield* DateTime.now,
        });

        counts.analyzed++;
        if (hasEffectCodeUsage(signals)) counts.codeUsage++;

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
