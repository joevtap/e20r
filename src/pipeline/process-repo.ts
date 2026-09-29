import { Effect, FileSystem, Path } from "effect";
import type { ChildProcessSpawner } from "effect/unstable/process";
import { effectRefs, readManifests } from "../analysis/package-json.ts";
import { selectionSignals } from "../analysis/select.ts";
import { ANALYZER_VERSION, analyzeSources, inventoryTotals } from "../deep-analysis/analyze.ts";
import {
  analysisPatterns,
  directoryOf,
  manifestPaths,
  parseLsTree,
  selectionPatterns,
  sourceFiles,
} from "../deep-analysis/tree.ts";
import { isEffectAdopter } from "../domain/selection.ts";
import { cloneBlobless, lsTree, revParseHead, sparseCheckout } from "../github/git.ts";
import { Store, strongestField, type RepoOutcome, type RepoRecord } from "../store/store.ts";
import { exclusionReason, type ExclusionOptions } from "./exclusion.ts";

export interface ProcessRepoOptions {
  readonly runId: number;
  /** Parent of the per-repository work directories. */
  readonly workDir: string;
  /** Keep the work directory after the repository is done (debugging only). */
  readonly keepClones: boolean;
  /** Stop adopters at `selected` instead of deep-analyzing them. */
  readonly skipAnalysis: boolean;
  readonly maxParseBytes: number;
  readonly exclusion: ExclusionOptions;
}

export type ProcessRepoResult =
  | {
      readonly _tag: "committed";
      readonly status: RepoOutcome["status"];
      readonly effectFiles: number;
      readonly tsFiles: number;
      readonly millis: number;
    }
  | {
      readonly _tag: "failed";
      readonly stage: string;
      readonly error: string;
      readonly millis: number;
    };

class StageError {
  readonly _tag = "StageError";
  constructor(
    readonly stage: string,
    readonly error: string,
  ) {}
}

/**
 * One repository, start to finish, in its own throwaway work directory:
 *
 * 1. blobless shallow clone (trees only) and the HEAD commit;
 * 2. the tree listing: file inventory, manifests and lockfiles, no blobs;
 * 3. selection checkout (manifests only) and the selection probes;
 * 4. adopters that are not excluded: analysis checkout (TypeScript sources
 *    only) and the deep analysis;
 * 5. one transaction commits everything the repository contributes.
 *
 * The work directory is removed however the effect ends — success, failure
 * or interruption — so disk usage is bounded by the number of repositories
 * in flight. Nothing is resumed from disk: a repository that did not commit
 * is simply processed again by the next run.
 */
export const processRepo = (
  repo: RepoRecord,
  options: ProcessRepoOptions,
): Effect.Effect<
  ProcessRepoResult,
  never,
  Store | FileSystem.FileSystem | Path.Path | ChildProcessSpawner.ChildProcessSpawner
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;
    const store = yield* Store;

    const started = Date.now();
    const timings: Record<string, number> = {};
    const dir = path.join(options.workDir, String(repo.id));

    const stage = <A, E, R>(name: string, effect: Effect.Effect<A, E, R>) =>
      Effect.gen(function* () {
        const at = Date.now();
        const result = yield* effect.pipe(
          Effect.mapError((error) => new StageError(name, String(error))),
        );
        timings[name] = (timings[name] ?? 0) + (Date.now() - at);
        return result;
      });

    const run = Effect.gen(function* () {
      yield* stage("clone", cloneBlobless(repo, dir));
      const commit = yield* stage("clone", revParseHead(dir));

      const tree = parseLsTree(yield* stage("tree", lsTree(dir)));
      const manifestFiles = manifestPaths(tree);
      const packageDirs = new Set(manifestFiles.map(directoryOf));
      const files = sourceFiles(tree, packageDirs);

      yield* stage("checkout-manifests", sparseCheckout(dir, selectionPatterns));
      const manifests = yield* readManifests(dir, manifestFiles);
      const signals = yield* selectionSignals({ cloneDir: dir, tree, manifests });

      const adopter = isEffectAdopter(signals);
      const excludedReason = adopter
        ? (exclusionReason(repo.fullName, manifests, options.exclusion) ?? null)
        : null;
      const analyze = adopter && excludedReason === null && !options.skipAnalysis;

      const analysis = analyze
        ? yield* Effect.gen(function* () {
            yield* stage("checkout-sources", sparseCheckout(dir, analysisPatterns));
            return yield* stage(
              "analyze",
              analyzeSources(dir, files, { maxParseBytes: options.maxParseBytes }),
            );
          })
        : undefined;

      const outcome: RepoOutcome = {
        repoId: repo.id,
        fullName: repo.fullName,
        runId: options.runId,
        status: !adopter
          ? "not-adopter"
          : excludedReason !== null
            ? "excluded"
            : analysis === undefined
              ? "selected"
              : "analyzed",
        commit,
        adopter,
        excludedReason,
        manifestCount: manifestFiles.length,
        signals,
        // Package-level rows only where adoption depth is measured: a large
        // non-adopter can carry hundreds of fixture manifests.
        workspacePackages: (adopter ? manifests : []).map(({ file, manifest }) => ({
          dir: directoryOf(file),
          name: manifest.name ?? null,
          effectDependency: strongestField(
            effectRefs(manifest)
              .filter((ref) => ref.package === "effect")
              .map((ref) => ref.field),
          ),
        })),
        totals: analysis?.totals ?? inventoryTotals(files, adopter),
        effectFiles: analysis?.effectFiles ?? [],
        analyzerVersion: analysis === undefined ? null : ANALYZER_VERSION,
        timings,
      };

      yield* stage("commit", store.commitRepo(outcome));

      return {
        _tag: "committed",
        status: outcome.status,
        effectFiles: outcome.effectFiles.length,
        tsFiles: files.filter((file) => !file.declaration).length,
        millis: Date.now() - started,
      } satisfies ProcessRepoResult;
    });

    return yield* Effect.acquireUseRelease(
      Effect.void,
      () => run,
      () =>
        options.keepClones
          ? Effect.void
          : Effect.ignore(fs.remove(dir, { recursive: true, force: true })),
    ).pipe(
      Effect.catch((failure: StageError) =>
        Effect.gen(function* () {
          yield* store
            .recordFailure({
              repoId: repo.id,
              fullName: repo.fullName,
              runId: options.runId,
              stage: failure.stage,
              error: failure.error,
              timings,
            })
            .pipe(
              Effect.catch((error) =>
                Effect.logWarning(`Failed to record the failure of ${repo.fullName}: ${error}`),
              ),
            );
          return {
            _tag: "failed",
            stage: failure.stage,
            error: failure.error,
            millis: Date.now() - started,
          } satisfies ProcessRepoResult;
        }),
      ),
    );
  });
