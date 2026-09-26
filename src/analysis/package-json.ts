import { Effect, Path, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import { Array, Option, String } from "effect";
import type { EffectVersion } from "../domain/clone-state.ts";

/**
 * The subset of a `package.json` manifest this application cares about.
 * Everything else is ignored; unknown keys decode fine and get dropped.
 */
export const DependencyMapSchema = Schema.Record(Schema.String, Schema.String);

const WorkspacesObjectSchema = Schema.Struct({
  packages: Schema.optionalKey(Schema.Array(Schema.String)),
  catalog: Schema.optionalKey(DependencyMapSchema),
  catalogs: Schema.optionalKey(Schema.Record(Schema.String, DependencyMapSchema)),
});

export const PackageJsonManifestSchema = Schema.Struct({
  name: Schema.optionalKey(Schema.String),
  dependencies: Schema.optionalKey(DependencyMapSchema),
  devDependencies: Schema.optionalKey(DependencyMapSchema),
  peerDependencies: Schema.optionalKey(DependencyMapSchema),
  optionalDependencies: Schema.optionalKey(DependencyMapSchema),
  workspaces: Schema.optionalKey(
    Schema.Union([Schema.Array(Schema.String), WorkspacesObjectSchema]),
  ),
});

export type PackageJsonManifest = Schema.Schema.Type<typeof PackageJsonManifestSchema>;

export const DependencyFieldSchema = Schema.Literals([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]);

export type DependencyField = Schema.Schema.Type<typeof DependencyFieldSchema>;

const dependencyFields: ReadonlyArray<DependencyField> = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(PackageJsonManifestSchema));

export interface ManifestEntry {
  readonly file: string;
  readonly manifest: PackageJsonManifest;
}

/**
 * Finds all `package.json` files below `cloneDir` (excluding `node_modules`)
 * and decodes them. Malformed or unreadable manifests are skipped, not fatal:
 * a single broken file must not fail the analysis of the whole repository.
 */
export const findManifests = (
  cloneDir: string,
): Effect.Effect<ReadonlyArray<ManifestEntry>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    // Node's glob returns paths relative to the root directory.
    const globbed = yield* fs
      .glob("**/package.json", {
        root: cloneDir,
        exclude: ["**/node_modules/**"],
      })
      .pipe(Effect.option);

    const files = Option.match(globbed, {
      onNone: () => [],
      onSome: Array.sort(String.Order),
    });

    const decoded = yield* Effect.forEach(files, (file) =>
      Effect.gen(function* () {
        const content = yield* Effect.option(fs.readFileString(path.join(cloneDir, file)));
        if (Option.isNone(content)) return Option.none();
        const manifest = decodeManifest(content.value);
        if (Option.isNone(manifest)) return Option.none();
        return Option.some({
          file,
          manifest: manifest.value,
        } satisfies ManifestEntry);
      }),
    );

    return Array.getSomes(decoded);
  });

/**
 * All `effect` dependency references in a manifest, one per dependency field.
 * The key must be exactly `effect` (no scoping, no `@effect/*` packages).
 */
export const effectRefs = (
  manifest: PackageJsonManifest,
): ReadonlyArray<{ readonly field: DependencyField; readonly version: EffectVersion }> => {
  const refs: Array<{ readonly field: DependencyField; readonly version: EffectVersion }> = [];
  for (const field of dependencyFields) {
    const map = manifest[field];
    const version = map?.["effect"];
    if (version !== undefined) {
      refs.push({ field, version: version as EffectVersion });
    }
  }
  return refs;
};
