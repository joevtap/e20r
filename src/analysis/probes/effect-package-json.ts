import { Effect, HashSet } from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type { EffectVersion, Signal } from "../../domain/clone-state.ts";
import { effectRefs, findManifests } from "../package-json.ts";

/**
 * Recursively inspects every `package.json` in the clone for an `effect`
 * dependency. Emits one signal carrying the deduped version specifiers and
 * the exact occurrences (file + dependency field).
 */
export const effectPackageJsonProbe = (
  cloneDir: string,
): Effect.Effect<ReadonlyArray<Signal>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const manifests = yield* findManifests(cloneDir);

    const occurrences = manifests.flatMap(({ file, manifest }) =>
      effectRefs(manifest).map((ref) => ({ file, field: ref.field, version: ref.version })),
    );

    if (occurrences.length === 0) return [];

    const versions = occurrences.reduce(
      (set, occ) => HashSet.add(set, occ.version),
      HashSet.empty<EffectVersion>(),
    );

    return [
      {
        _tag: "effect-in-package-json",
        versions: [...versions],
        occurrences,
      } satisfies Signal,
    ];
  });
