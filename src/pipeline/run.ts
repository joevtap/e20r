import { Effect, FileSystem, Path, Stream } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import type { SqlError } from "effect/unstable/sql/SqlError";
import { ANALYZER_VERSION } from "../deep-analysis/analyze.ts";
import { Store, type PriorState } from "../store/store.ts";
import type { GitAuth } from "../github/git.ts";
import type { ExclusionOptions } from "./exclusion.ts";
import { processRepo } from "./process-repo.ts";

export interface ProcessRunOptions {
  readonly runId: number;
  readonly budget: number;
  readonly workDir: string;
  readonly concurrency: number;
  /** Re-process every repository, whatever its recorded state. */
  readonly fresh: boolean;
  /** Retry failed repositories even past `maxAttempts`. */
  readonly retryFailed: boolean;
  /** Re-process adopters analyzed by an older analyzer version. */
  readonly reanalyze: boolean;
  readonly maxAttempts: number;
  readonly skipAnalysis: boolean;
  readonly keepClones: boolean;
  readonly maxParseBytes: number;
  readonly exclusion: ExclusionOptions;
  /** Credentials for clones and checkouts; anonymous when undefined. */
  readonly gitAuth: GitAuth | undefined;
}

export interface ProcessRunCounts {
  readonly queued: number;
  readonly upToDate: number;
  readonly gaveUp: number;
  readonly committed: number;
  readonly failed: number;
  readonly byStatus: Readonly<Record<string, number>>;
  /** Set when the run stopped early: every clone kept failing (see the breaker). */
  readonly halted: string | null;
  /** Repositories of the queue never started (they stay pending for the next run). */
  readonly notStarted: number;
}

/** Stages that talk to GitHub: a streak of failures there means GitHub, not the repos. */
export const networkStages: ReadonlySet<string> = new Set([
  "clone",
  "checkout-manifests",
  "checkout-sources",
]);

/** What the breaker did when a network failure hit the streak threshold: cool down, or stop the run. */
export type BreakerEvent =
  | { readonly _tag: "pause"; readonly millis: number; readonly trip: number }
  | { readonly _tag: "halt" };

/**
 * The network circuit breaker. After `streak` consecutive network failures
 * (GitHub throttling, or the network gone), no new repository starts for a
 * cool-down that doubles each time (2, 4, 8… up to 30 minutes); any success
 * resets it. After `maxTrips` cool-downs in a row without a single success
 * the run stops, leaving the rest of the queue pending, instead of marking
 * thousands of healthy repositories as failed. Failures that land during a
 * cool-down (repositories already in flight when it started) do not count.
 */
export const makeBreaker = (
  options: { readonly streak: number; readonly maxTrips: number } = { streak: 12, maxTrips: 5 },
  now: () => number = Date.now,
) => {
  let streak = 0;
  let trips = 0;
  let pausedUntil = 0;
  let halted = false;
  return {
    get halted() {
      return halted;
    },
    /** How long a repository about to start has to wait (0 = go). */
    waitMillis: (): number => Math.max(0, pausedUntil - now()),
    onSuccess: (): void => {
      streak = 0;
      trips = 0;
    },
    onNetworkFailure: (): BreakerEvent | undefined => {
      if (halted || now() < pausedUntil) return undefined;
      if (++streak < options.streak) return undefined;
      streak = 0;
      trips++;
      if (trips > options.maxTrips) {
        halted = true;
        return { _tag: "halt" };
      }
      const millis = Math.min(2 * 60_000 * 2 ** (trips - 1), 30 * 60_000);
      pausedUntil = now() + millis;
      return { _tag: "pause", millis, trip: trips };
    },
  };
};

type Decision = "process" | "up-to-date" | "gave-up";

/**
 * Whether a repository needs work, from its recorded state alone:
 *
 * - nothing recorded -> processed;
 * - `not-adopter` / `excluded` -> done;
 * - `selected` (adopter never analyzed) -> processed unless `--skip-analysis`;
 * - `analyzed` -> done, unless `--reanalyze` and an older analyzer produced it;
 * - `failed` -> retried while under `maxAttempts` (or with `--retry-failed`).
 *
 * `--fresh` processes everything.
 */
const decide = (prior: PriorState | undefined, options: ProcessRunOptions): Decision => {
  if (options.fresh || prior === undefined) return "process";
  switch (prior.status) {
    case "not-adopter":
    case "excluded":
      return "up-to-date";
    case "selected":
      return options.skipAnalysis ? "up-to-date" : "process";
    case "analyzed":
      return options.reanalyze && prior.analyzerVersion !== ANALYZER_VERSION
        ? "process"
        : "up-to-date";
    case "failed":
      return options.retryFailed || prior.attempts < options.maxAttempts ? "process" : "gave-up";
  }
};

const seconds = (millis: number): string => `${(millis / 1000).toFixed(1)}s`;

/**
 * The processing stage: every top-`budget` repository that needs work goes
 * through `processRepo`, `concurrency` at a time, in rank order. The work
 * directory is wiped first — whatever a crashed run left there is garbage,
 * because the store is the only resume source.
 */
export const runProcess = (
  options: ProcessRunOptions,
): Effect.Effect<
  ProcessRunCounts,
  SqlError,
  Store | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const store = yield* Store;

    yield* Effect.ignore(fs.remove(options.workDir, { recursive: true, force: true }));
    yield* fs.makeDirectory(options.workDir, { recursive: true }).pipe(Effect.orDie);

    const top = yield* store.topRepos(options.budget);
    const prior = yield* store.priorStates;

    let upToDate = 0;
    let gaveUp = 0;
    const queue = top.filter((repo) => {
      const decision = decide(prior.get(repo.id), options);
      if (decision === "up-to-date") upToDate++;
      else if (decision === "gave-up") gaveUp++;
      return decision === "process";
    });

    yield* Effect.log(
      `Processing ${queue.length} of the top ${top.length} repositories ` +
        `(${upToDate} up to date, ${gaveUp} failed ${options.maxAttempts}+ times; ` +
        `concurrency ${options.concurrency}${options.skipAnalysis ? ", analysis skipped" : ""})`,
    );

    const progress = { done: 0, failed: 0, started: Date.now(), lastRollup: Date.now() };
    const byStatus: Record<string, number> = {};
    const breaker = makeBreaker();
    let halted: string | null = null;
    let notStarted = 0;

    if (options.gitAuth === undefined) {
      yield* Effect.logWarning(
        "Cloning anonymously: GitHub throttles anonymous git per IP after a few thousand clones. Set GITHUB_API_KEY to authenticate git.",
      );
    }

    yield* Stream.fromIterable(queue).pipe(
      Stream.mapEffect(
        (repo) =>
          Effect.gen(function* () {
            // Wait out a cool-down; once halted, the rest of the queue is left pending.
            while (!breaker.halted && breaker.waitMillis() > 0) {
              yield* Effect.sleep(Math.min(breaker.waitMillis(), 5_000));
            }
            if (breaker.halted) {
              notStarted++;
              return;
            }

            const result = yield* processRepo(repo, {
              runId: options.runId,
              workDir: options.workDir,
              keepClones: options.keepClones,
              skipAnalysis: options.skipAnalysis,
              maxParseBytes: options.maxParseBytes,
              exclusion: options.exclusion,
              gitAuth: options.gitAuth,
            });

            if (result._tag === "failed" && networkStages.has(result.stage)) {
              const event = breaker.onNetworkFailure();
              if (event?._tag === "halt") {
                halted = result.error;
                yield* Effect.logError(
                  `Stopping: GitHub still refuses clones after repeated cool-downs (last error: ${result.error}). ` +
                    "The remaining repositories stay pending; run the same command again later.",
                );
              } else if (event?._tag === "pause") {
                yield* Effect.logWarning(
                  `Clones keep failing (${result.error}); pausing new clones for ` +
                    `${Math.round(event.millis / 60_000)} min (cool-down ${event.trip}).`,
                );
              }
            } else if (result._tag === "committed") {
              breaker.onSuccess();
            }
            const where = `[${++progress.done}/${queue.length}]`;
            if (result._tag === "failed") {
              progress.failed++;
              yield* Effect.log(
                `${where} ${repo.fullName}: failed at ${result.stage} in ${seconds(result.millis)} — ${result.error}`,
              );
            } else {
              byStatus[result.status] = (byStatus[result.status] ?? 0) + 1;
              const detail =
                result.status === "analyzed"
                  ? `, ${result.effectFiles}/${result.tsFiles} ts files use effect`
                  : "";
              yield* Effect.log(
                `${where} ${repo.fullName} (★${repo.stars}): ${result.status}${detail} in ${seconds(result.millis)}`,
              );
            }

            const now = Date.now();
            if (now - progress.lastRollup >= 30_000) {
              progress.lastRollup = now;
              const elapsed = (now - progress.started) / 1000;
              const rate = progress.done / elapsed;
              const left = rate > 0 ? (queue.length - progress.done) / rate : 0;
              yield* Effect.log(
                `progress ${progress.done}/${queue.length} · ${progress.failed} failures · ` +
                  `${Math.round(elapsed / 60)}m elapsed · ~${Math.round(left / 60)}m left`,
              );
            }
          }),
        { concurrency: options.concurrency, unordered: true },
      ),
      Stream.runDrain,
    );

    return {
      queued: queue.length,
      upToDate,
      gaveUp,
      committed: progress.done - progress.failed,
      failed: progress.failed,
      byStatus,
      halted,
      notStarted,
    };
  });
