import { Schema } from "effect";

/**
 * A version specifier as declared in a manifest (e.g. `^4.0.0`, `4.0.0-rc.110`,
 * `catalog:`), kept raw: no registry resolution is performed.
 */
export const EffectVersionSchema = Schema.String.check(Schema.isNonEmpty()).pipe(
  Schema.brand("e20r/EffectVersion"),
);

export type EffectVersion = Schema.Schema.Type<typeof EffectVersionSchema>;

export const DependencyFieldSchema = Schema.Literals([
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
]);

export type DependencyField = Schema.Schema.Type<typeof DependencyFieldSchema>;

/** Runtime dependency fields: the only ones that make a repository an adopter. */
export const isRuntimeField = (field: DependencyField): boolean =>
  field === "dependencies" || field === "optionalDependencies";

/**
 * A detected evidence of a fact about the cloned repository. Signals are
 * gathered by selection probes; a probe returns zero or more signals. They are
 * an in-memory intermediate: the store flattens them into the
 * `manifest_deps`, `catalog_versions` and `package_managers` tables.
 */
export const SignalSchema = Schema.Union([
  /**
   * Every `effect` and `@effect/*` dependency of every manifest. `versions`
   * are the distinct specifiers of `effect` itself.
   */
  Schema.TaggedStruct("effect-in-package-json", {
    versions: Schema.Array(EffectVersionSchema),
    occurrences: Schema.Array(
      Schema.Struct({
        file: Schema.String,
        package: Schema.String,
        field: DependencyFieldSchema,
        version: EffectVersionSchema,
      }),
    ),
  }),
  /** `effect` versions resolved through `catalog:` references. */
  Schema.TaggedStruct("effect-version-in-catalog", {
    manager: Schema.Literals(["pnpm", "bun"]),
    entries: Schema.Array(
      Schema.Struct({
        /** "default" for `catalog:`, the name for `catalog:<name>`. */
        catalog: Schema.String,
        version: EffectVersionSchema,
      }),
    ),
  }),
  Schema.TaggedStruct("uses-pnpm", {
    evidence: Schema.String,
  }),
  Schema.TaggedStruct("uses-bun", {
    evidence: Schema.String,
  }),
  Schema.TaggedStruct("uses-npm", {
    evidence: Schema.String,
  }),
]);

export type Signal = Schema.Schema.Type<typeof SignalSchema>;

/** The signal variant(s) with the given `_tag`(s). */
export type SignalOf<Tag extends Signal["_tag"]> = Extract<Signal, { _tag: Tag }>;

/**
 * Only a direct runtime dependency on `effect` counts as adoption
 * (`dependencies`/`optionalDependencies`, whatever the specifier — a
 * `catalog:` reference included), not dev-only or peer-only usage.
 */
export const isEffectAdopter = (signals: ReadonlyArray<Signal>): boolean =>
  signals.some(
    (s) =>
      s._tag === "effect-in-package-json" &&
      s.occurrences.some((occ) => occ.package === "effect" && isRuntimeField(occ.field)),
  );
