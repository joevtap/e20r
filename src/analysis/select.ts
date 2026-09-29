import { Effect, Option } from "effect";
import type * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type { EffectVersion, Signal, SignalOf } from "../domain/selection.ts";
import { hasFile, type TreeEntry } from "../deep-analysis/tree.ts";
import { parsePnpmCatalogs } from "./catalog.ts";
import { effectRefs, type ManifestEntry } from "./package-json.ts";

/**
 * Selection probes: the evidence that decides whether a repository adopts
 * Effect. They run against the selection checkout (manifests and the pnpm
 * workspace file only) plus the git tree listing, and never fail — absence
 * of evidence is simply no signal.
 */
export interface SelectionContext {
  readonly cloneDir: string;
  readonly tree: ReadonlyArray<TreeEntry>;
  /** Every decoded manifest of the clone, read once and shared by the probes. */
  readonly manifests: ReadonlyArray<ManifestEntry>;
}

/**
 * Every `effect` / `@effect/*` dependency of every manifest, with the
 * deduped `effect` version specifiers.
 */
export const effectPackageJsonSignals = (
  manifests: ReadonlyArray<ManifestEntry>,
): ReadonlyArray<SignalOf<"effect-in-package-json">> => {
  const occurrences = manifests.flatMap(({ file, manifest }) =>
    effectRefs(manifest).map((ref) => ({ file, ...ref })),
  );
  if (occurrences.length === 0) return [];
  const versions = [
    ...new Set(occurrences.filter((occ) => occ.package === "effect").map((occ) => occ.version)),
  ];
  return [{ _tag: "effect-in-package-json", versions, occurrences }];
};

/**
 * Catalog references to `effect` used in manifests: `catalog:` -> "default",
 * `catalog:<name>` -> that named catalog.
 */
const catalogRefs = (manifests: ReadonlyArray<ManifestEntry>): ReadonlySet<string> => {
  const refs = new Set<string>();
  for (const { manifest } of manifests) {
    for (const ref of effectRefs(manifest)) {
      if (ref.package !== "effect" || !ref.version.startsWith("catalog:")) continue;
      const name = ref.version.slice("catalog:".length);
      refs.add(name === "" ? "default" : name);
    }
  }
  return refs;
};

const catalogSignal = (
  manager: "pnpm" | "bun",
  refs: ReadonlySet<string>,
  resolve: (catalog: string) => string | undefined,
): ReadonlyArray<SignalOf<"effect-version-in-catalog">> => {
  const entries: Array<{ catalog: string; version: EffectVersion }> = [];
  for (const catalog of [...refs].sort()) {
    const version = resolve(catalog);
    if (version !== undefined && version !== "") {
      entries.push({ catalog, version: version as EffectVersion });
    }
  }
  return entries.length === 0 ? [] : [{ _tag: "effect-version-in-catalog", manager, entries }];
};

/**
 * Resolves `effect` versions referenced through pnpm catalogs
 * (`pnpm-workspace.yaml`): fires only when some manifest references
 * `effect: "catalog:"` / `"catalog:<name>"` and the catalog defines it.
 */
const pnpmCatalogSignals = (
  context: SelectionContext,
  refs: ReadonlySet<string>,
): Effect.Effect<ReadonlyArray<Signal>, never, FileSystem.FileSystem> =>
  Effect.gen(function* () {
    if (refs.size === 0 || !hasFile(context.tree, "pnpm-workspace.yaml")) return [];
    const catalogs = yield* parsePnpmCatalogs(`${context.cloneDir}/pnpm-workspace.yaml`);
    if (Option.isNone(catalogs)) return [];
    return catalogSignal("pnpm", refs, (catalog) =>
      catalog === "default"
        ? Option.getOrUndefined(catalogs.value.default)
        : catalogs.value.named[catalog],
    );
  });

/**
 * Same resolution for bun catalogs, which live in the root `package.json`
 * under `workspaces.catalog` / `workspaces.catalogs`.
 */
const bunCatalogSignals = (
  manifests: ReadonlyArray<ManifestEntry>,
  refs: ReadonlySet<string>,
): ReadonlyArray<Signal> => {
  if (refs.size === 0) return [];
  const workspaces = manifests.find((entry) => entry.file === "package.json")?.manifest.workspaces;
  if (workspaces === undefined || Array.isArray(workspaces)) return [];
  const object = workspaces as Exclude<typeof workspaces, ReadonlyArray<string>>;
  return catalogSignal("bun", refs, (catalog) =>
    catalog === "default" ? object.catalog?.["effect"] : object.catalogs?.[catalog]?.["effect"],
  );
};

/**
 * The package managers backing the repository, from lockfiles/workspace
 * files at the root of the tree listing (so a huge lockfile is never
 * downloaded). A repository can carry evidence for more than one manager.
 */
export const packageManagerSignals = (tree: ReadonlyArray<TreeEntry>): ReadonlyArray<Signal> => {
  const evidence = (files: ReadonlyArray<string>): string =>
    files.filter((file) => hasFile(tree, file)).join(", ");
  const pnpm = evidence(["pnpm-workspace.yaml", "pnpm-lock.yaml"]);
  const bun = evidence(["bun.lockb", "bun.lock"]);
  const npm = evidence(["package-lock.json"]);
  return [
    ...(pnpm === "" ? [] : [{ _tag: "uses-pnpm", evidence: pnpm } as const]),
    ...(bun === "" ? [] : [{ _tag: "uses-bun", evidence: bun } as const]),
    ...(npm === "" ? [] : [{ _tag: "uses-npm", evidence: npm } as const]),
  ];
};

/** Runs every selection probe and concatenates the gathered signals. */
export const selectionSignals = (
  context: SelectionContext,
): Effect.Effect<ReadonlyArray<Signal>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const refs = catalogRefs(context.manifests);
    return [
      ...effectPackageJsonSignals(context.manifests),
      ...(yield* pnpmCatalogSignals(context, refs)),
      ...bunCatalogSignals(context.manifests, refs),
      ...packageManagerSignals(context.tree),
    ];
  });
