import { Array, Effect } from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type { GithubRepo } from "../domain/github.ts";
import type { Signal } from "../domain/clone-state.ts";
import { effectPackageJsonProbe } from "./probes/effect-package-json.ts";
import { bunCatalogProbe, pnpmCatalogProbe } from "./probes/catalog.ts";
import { packageManagerProbe } from "./probes/package-manager.ts";

/**
 * Probes gather signals from a cloned repository on disk.
 *
 * Every probe is recursive: it inspects all matching files below the clone
 * root, never just the top level. Probes never fail; absence of evidence is
 * simply an empty signal list.
 */
export type Probe = (
  cloneDir: string,
  repo: GithubRepo,
) => Effect.Effect<ReadonlyArray<Signal>, never, FileSystem.FileSystem | Path.Path>;

const probes: ReadonlyArray<Probe> = [
  effectPackageJsonProbe,
  pnpmCatalogProbe,
  bunCatalogProbe,
  packageManagerProbe,
];

/**
 * Runs every probe against a clone and concatenates the gathered signals.
 */
export const analyzeRepo = (
  cloneDir: string,
  repo: GithubRepo,
): Effect.Effect<ReadonlyArray<Signal>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.forEach(probes, (probe) => probe(cloneDir, repo), {
    concurrency: "unbounded",
  }).pipe(Effect.map(Array.flatten));
