import { Array, Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type { CloneTarget } from "../github/clone.ts";
import type { AnalysisSignal } from "../domain/analysis-state.ts";
import { tsFilesProbe } from "./probes/ts-files.ts";
import { effectUsageProbe } from "./probes/effect-usage.ts";

/**
 * Options shared by the probes of one analysis run.
 */
export interface AnalysisRunOptions {
  /**
   * Whether the TypeScript AST phase may run. Without it, usage signals come
   * from the text scanner alone (exact imports and no symbol counts) — the
   * escape hatch for machines where the language server is too expensive.
   */
  readonly ast: boolean;
}

/**
 * Deep-analysis probes gather effect-usage signals from a cloned repository
 * on disk. Same contract as the selection probes: every probe is recursive,
 * inspects all matching files below the clone root, and never fails — absence
 * of evidence is simply an empty signal list.
 *
 * `S` is the signal schema the probe returns, so each probe's signature
 * documents exactly which signals it can emit.
 */
export type AnalysisProbe<S extends AnalysisSignal = AnalysisSignal> = (
  cloneDir: string,
  repo: CloneTarget,
  options: AnalysisRunOptions,
) => Effect.Effect<ReadonlyArray<S>, never, FileSystem.FileSystem | Path.Path>;

const probes: ReadonlyArray<AnalysisProbe> = [tsFilesProbe, effectUsageProbe];

/**
 * Runs every deep-analysis probe against a clone and concatenates the
 * gathered signals.
 */
export const analyzeDeep = (
  cloneDir: string,
  repo: CloneTarget,
  options: AnalysisRunOptions = { ast: true },
): Effect.Effect<ReadonlyArray<AnalysisSignal>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.forEach(probes, (probe) => probe(cloneDir, repo, options), {
    concurrency: "unbounded",
  }).pipe(Effect.map(Array.flatten));
