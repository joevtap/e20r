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
 * A detected evidence of a fact about the analyzed repository. Signals are
 * gathered by probes; a probe returns zero or more signals.
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

/**
 * The outcome of cloning and analyzing one repository. Records are appended
 * to `analyses.jsonl` and keyed by `repoId` for resume.
 */
export const RepoAnalysisSchema = Schema.Struct({
  repoId: Schema.Finite,
  fullName: Schema.String,
  cloneStatus: CloneStatusSchema,
  cloneError: Schema.optionalKey(Schema.String),
  signals: Schema.Array(SignalSchema),
  adopter: Schema.Boolean,
  analyzedAt: Schema.DateTimeUtcFromString,
});

export type RepoAnalysis = Schema.Schema.Type<typeof RepoAnalysisSchema>;
