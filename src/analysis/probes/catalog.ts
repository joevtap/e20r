import { Effect, Option } from "effect";
import type { EffectVersion, SignalOf } from "../../domain/clone-state.ts";
import { parsePnpmCatalogs } from "../catalog.ts";
import { findManifests, type ManifestEntry } from "../package-json.ts";
import type { Probe } from "../probe.ts";

type CatalogSignal = SignalOf<"effect-version-in-catalog">;

interface CatalogRef {
  readonly file: string;
  readonly catalog: Option.Option<string>;
}

/**
 * Catalog references used in manifests, with the catalog name if any:
 * `catalog:` -> default, `catalog:<name>` -> that named catalog.
 */
const catalogRefs = (manifests: ReadonlyArray<ManifestEntry>): ReadonlyArray<CatalogRef> =>
  manifests.flatMap(({ file, manifest }) => {
    const refs: Array<CatalogRef> = [];
    for (const map of [
      manifest.dependencies,
      manifest.devDependencies,
      manifest.peerDependencies,
      manifest.optionalDependencies,
    ]) {
      const version = map?.["effect"];
      if (version === undefined) continue;
      if (version === "catalog:") refs.push({ file, catalog: Option.none() });
      else if (version.startsWith("catalog:")) {
        refs.push({ file, catalog: Option.some(version.slice("catalog:".length)) });
      }
    }
    return refs;
  });

const versionSignal = (
  manager: "pnpm" | "bun",
  versions: ReadonlySet<EffectVersion>,
): ReadonlyArray<CatalogSignal> =>
  versions.size === 0
    ? []
    : [
        {
          _tag: "effect-version-in-catalog",
          manager,
          versions: Array.from(versions),
        } satisfies CatalogSignal,
      ];

/**
 * Resolves `effect` versions referenced through pnpm catalogs
 * (`pnpm-workspace.yaml`): the signal fires only when some manifest
 * references `effect: "catalog:"` / `"catalog:<name>"` and the catalog
 * defines an `effect` version.
 */
export const pnpmCatalogProbe: Probe<CatalogSignal> = (cloneDir) =>
  Effect.gen(function* () {
    const manifests = yield* findManifests(cloneDir);
    const refs = catalogRefs(manifests);
    if (refs.length === 0) return [];

    const catalogs = yield* parsePnpmCatalogs(`${cloneDir}/pnpm-workspace.yaml`);
    if (Option.isNone(catalogs)) return [];

    const versions = new Set<EffectVersion>();
    for (const ref of refs) {
      const resolved = Option.match(ref.catalog, {
        onNone: () => catalogs.value.default,
        onSome: (name) =>
          Option.map(Option.fromUndefinedOr(catalogs.value.named[name]), (v) => v as EffectVersion),
      });
      if (Option.isSome(resolved)) versions.add(resolved.value);
    }

    return versionSignal("pnpm", versions);
  });

/**
 * Same resolution for bun catalogs, which live in the root `package.json`
 * under `workspaces.catalog` / `workspaces.catalogs`.
 */
export const bunCatalogProbe: Probe<CatalogSignal> = (cloneDir) =>
  Effect.gen(function* () {
    const manifests = yield* findManifests(cloneDir);
    const refs = catalogRefs(manifests);
    if (refs.length === 0) return [];

    // In bun the catalogs live in the workspace root manifest.
    const root = manifests.find((entry) => entry.file === "package.json");
    if (root === undefined) return [];

    const workspaces = root.manifest.workspaces;
    if (
      workspaces === undefined ||
      Array.isArray(workspaces) ||
      !("catalog" in workspaces || "catalogs" in workspaces)
    ) {
      return [];
    }

    const versions = new Set<EffectVersion>();
    for (const ref of refs) {
      const resolved = Option.match(ref.catalog, {
        onNone: () =>
          Option.map(
            Option.fromUndefinedOr(workspaces.catalog?.["effect"]),
            (v) => v as EffectVersion,
          ),
        onSome: (name) =>
          Option.map(
            Option.fromUndefinedOr(workspaces.catalogs?.[name]?.["effect"]),
            (v) => v as EffectVersion,
          ),
      });
      if (Option.isSome(resolved)) versions.add(resolved.value);
    }

    return versionSignal("bun", versions);
  });
