import { Array, Effect, Option, Path, Schema } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { DependencyField, EffectVersion } from "../domain/selection.ts";

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

export const dependencyFields: ReadonlyArray<DependencyField> = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
];

const decodeManifest = Schema.decodeUnknownOption(Schema.fromJsonString(PackageJsonManifestSchema));

export interface ManifestEntry {
  /** Path relative to the clone root. */
  readonly file: string;
  readonly manifest: PackageJsonManifest;
}

/**
 * Reads and decodes the given manifests (paths relative to `cloneDir`, as
 * listed by the git tree). Malformed or unreadable manifests are skipped, not
 * fatal: a single broken file must not fail the analysis of the whole
 * repository.
 */
export const readManifests = (
  cloneDir: string,
  files: ReadonlyArray<string>,
): Effect.Effect<ReadonlyArray<ManifestEntry>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const decoded = yield* Effect.forEach(
      files,
      (file) =>
        Effect.map(Effect.option(fs.readFileString(path.join(cloneDir, file))), (content) =>
          Option.flatMap(content, (text) =>
            Option.map(decodeManifest(text), (manifest): ManifestEntry => ({ file, manifest })),
          ),
        ),
      { concurrency: 16 },
    );

    return Array.getSomes(decoded);
  });

/** Packages of the Effect ecosystem: `effect` itself and the official `@effect/*` scope. */
export const isEffectPackage = (name: string): boolean =>
  name === "effect" || name.startsWith("@effect/");

export interface DependencyRef {
  readonly package: string;
  readonly field: DependencyField;
  readonly version: EffectVersion;
}

/**
 * All `effect` and `@effect/*` dependency references in a manifest, one per
 * package and dependency field.
 */
export const effectRefs = (manifest: PackageJsonManifest): ReadonlyArray<DependencyRef> => {
  const refs: Array<DependencyRef> = [];
  for (const field of dependencyFields) {
    for (const [name, version] of Object.entries(manifest[field] ?? {})) {
      if (isEffectPackage(name) && version !== "") {
        refs.push({ package: name, field, version: version as EffectVersion });
      }
    }
  }
  return refs;
};
