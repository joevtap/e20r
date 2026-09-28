import { Array, Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type { GithubRepo } from "../domain/github.ts";
import type { AnalysisSignal } from "../domain/analysis-state.ts";
import { tsFilesProbe } from "./probes/ts-files.ts";
import { effectImportsProbe } from "./probes/effect-imports.ts";
import { effectSymbolsProbe } from "./probes/effect-symbols.ts";

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
  repo: GithubRepo,
) => Effect.Effect<ReadonlyArray<S>, never, FileSystem.FileSystem | Path.Path>;

const probes: ReadonlyArray<AnalysisProbe> = [tsFilesProbe, effectImportsProbe, effectSymbolsProbe];

/**
 * Runs every deep-analysis probe against a clone and concatenates the
 * gathered signals.
 */
export const analyzeDeep = (
  cloneDir: string,
  repo: GithubRepo,
): Effect.Effect<ReadonlyArray<AnalysisSignal>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.forEach(probes, (probe) => probe(cloneDir, repo), {
    concurrency: "unbounded",
  }).pipe(Effect.map(Array.flatten));
