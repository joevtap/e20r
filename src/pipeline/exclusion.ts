import type { ManifestEntry } from "../analysis/package-json.ts";
import { isEffectPackage } from "../analysis/package-json.ts";

/**
 * Why an adopter is kept out of the deep analysis: Effect itself is not an
 * "adopter" of Effect. Excluded repositories keep their selection evidence,
 * so population ratios can still count them (or not) at query time.
 */
export type ExclusionReason = "effect-ts-org" | "configured" | "defines-effect-package";

export interface ExclusionOptions {
  /** Full names (`owner/name`, any case) excluded by configuration. */
  readonly excludeRepos: ReadonlyArray<string>;
  /**
   * Also exclude repositories that define a package named `effect` or
   * `@effect/*`: vendored copies or mirrors of Effect that GitHub does not
   * flag as forks (the `@effect` npm scope belongs to the Effect-TS org).
   */
  readonly excludeEffectPackageDefiners: boolean;
}

/** The exclusion reason of a selected adopter, `undefined` when it is analyzed. */
export const exclusionReason = (
  fullName: string,
  manifests: ReadonlyArray<ManifestEntry>,
  options: ExclusionOptions,
): ExclusionReason | undefined => {
  const name = fullName.toLowerCase();
  if (name.startsWith("effect-ts/")) return "effect-ts-org";
  if (options.excludeRepos.some((repo) => repo.toLowerCase() === name)) return "configured";
  if (
    options.excludeEffectPackageDefiners &&
    manifests.some(({ manifest }) => manifest.name !== undefined && isEffectPackage(manifest.name))
  ) {
    return "defines-effect-package";
  }
  return undefined;
};
