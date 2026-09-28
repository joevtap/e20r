import { Schema } from "effect";

export const CloneStatusSchema = Schema.Literals(["cloned", "clone-failed"]);

export type CloneStatus = Schema.Schema.Type<typeof CloneStatusSchema>;

/**
 * A version specifier as declared in a manifest (e.g. `^4.0.0`, `4.0.0-rc.110`,
 * `catalog:`), kept raw: no registry resolution is performed.
 */
export const EffectVersionSchema = Schema.String.check(Schema.isNonEmpty()).pipe(
  Schema.brand("e20r/EffectVersion"),
);

export type EffectVersion = Schema.Schema.Type<typeof EffectVersionSchema>;

/**
 * A detected evidence of a fact about the cloned repository. Signals are
 * gathered by selection probes; a probe returns zero or more signals.
 */
export const SignalSchema = Schema.Union([
  Schema.TaggedStruct("effect-in-package-json", {
    versions: Schema.Array(EffectVersionSchema),
    occurrences: Schema.Array(
      Schema.Struct({
        file: Schema.String,
        field: Schema.Literals([
          "dependencies",
          "devDependencies",
          "peerDependencies",
          "optionalDependencies",
        ]),
        version: EffectVersionSchema,
      }),
    ),
  }),
  Schema.TaggedStruct("effect-version-in-catalog", {
    manager: Schema.Literals(["pnpm", "bun"]),
    versions: Schema.Array(EffectVersionSchema),
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
 * The state of cloning one repository and selecting it as an Effect adopter:
 * the clone outcome, the commit hash actually cloned, the selection signals
 * gathered by the probes, and the resulting adoption decision. Records are
 * appended to `clone-state.jsonl` and keyed by `repoId` for resume; failed
 * clones are retried on later runs.
 */
export const RepoCloneStateSchema = Schema.Struct({
  repoId: Schema.Finite,
  fullName: Schema.String,
  cloneStatus: CloneStatusSchema,
  cloneError: Schema.optionalKey(Schema.String),

  /**
   * Commit hash of the cloned HEAD (`git rev-parse HEAD` on the clone), so a
   * recorded state always pins the exact snapshot it describes. Absent while
   * the clone failed.
   */
  commit: Schema.optionalKey(Schema.String),

  signals: Schema.Array(SignalSchema),

  /**
   * Adoption selection: true only for direct Effect runtime dependencies
   * (dependencies/optionalDependencies, or a catalog reference).
   */
  adopter: Schema.Boolean,

  recordedAt: Schema.DateTimeUtcFromString,
});

export type RepoCloneState = Schema.Schema.Type<typeof RepoCloneStateSchema>;

/**
 * Only direct `effect` dependency evidence counts as adoption: runtime
 * dependencies and catalog references, not dev-only or peer-only usage.
 */
export const isEffectAdopter = (signals: ReadonlyArray<Signal>): boolean =>
  signals.some(
    (s) =>
      s._tag === "effect-version-in-catalog" ||
      (s._tag === "effect-in-package-json" &&
        s.occurrences.some(
          (occ) => occ.field === "dependencies" || occ.field === "optionalDependencies",
        )),
  );
