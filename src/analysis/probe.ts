import { Effect } from "effect";
import { FileSystem } from "effect";
import type { GithubRepo } from "../domain/github.ts";
import type { Signal } from "../domain/analysis.ts";

/**
 * Probes gather signals from a cloned repository on disk.
 *
 * Every probe is recursive: it inspects all matching files below the clone
 * root, never just the top level.
 */
export type Probe = (
  cloneDir: string,
  repo: GithubRepo,
) => Effect.Effect<ReadonlyArray<Signal>, never, FileSystem.FileSystem>;

/**
 * Placeholder probe: no signals yet. The effect-in-package-json probe (plus
 * the catalog and package-manager probes) plug in here next.
 */
export const analyzeRepo = (
  cloneDir: string,
  repo: GithubRepo,
): Effect.Effect<ReadonlyArray<Signal>, never, FileSystem.FileSystem> =>
  Effect.sync(() => {
    void cloneDir;
    void repo;
    return [];
  });
