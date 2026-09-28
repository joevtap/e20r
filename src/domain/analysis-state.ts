import { Schema } from "effect";

/**
 * Where a source file sits in the repository's own conventions. Detection is
 * heuristic (see `src/deep-analysis/sources.ts`): filename patterns such as
 * `*.test.ts` / `*.spec.tsx`, or a `test/`/`__tests__/`-style directory.
 */
export const FileRoleSchema = Schema.Literals(["source", "test"]);

export type FileRole = Schema.Schema.Type<typeof FileRoleSchema>;

const FileRoleCountsSchema = Schema.Struct({
  source: Schema.Finite,
  test: Schema.Finite,
});

/**
 * Inventory of the TypeScript source files of the clone: the denominator for
 * every "how deep is the adoption" ratio. Counted, not listed: the full file
 * list would dominate the state file on large codebases, while the per-file
 * rows below only cover the (few) files that actually use Effect.
 */
export const TsFileCountSchema = Schema.TaggedStruct("ts-file-count", {
  /** `*.ts` / `*.tsx` / `*.mts` / `*.cts` files, excluding declarations. */
  total: Schema.Finite,
  byExtension: Schema.Record(Schema.String, Schema.Finite),
  byRole: FileRoleCountsSchema,
  /** `*.d.ts` / `*.d.mts` / `*.d.cts` files, counted separately. */
  declarationFiles: Schema.Finite,
});

export type TsFileCountSignal = Schema.Schema.Type<typeof TsFileCountSchema>;

/**
 * How many source files import Effect somewhere in their text. Always emitted
 * (even zero) so manifest-only adopters are distinguishable in aggregations.
 */
export const FilesUsingEffectCountSchema = Schema.TaggedStruct("files-using-effect-count", {
  count: Schema.Finite,
  byRole: FileRoleCountsSchema,
});

export type FilesUsingEffectCountSignal = Schema.Schema.Type<typeof FilesUsingEffectCountSchema>;

/** One binding of an import clause, e.g. `Effect as E` -> imported "Effect", local "E". */
const ImportNameSchema = Schema.Struct({
  imported: Schema.String,
  local: Schema.String,
  typeOnly: Schema.Boolean,
});

const EffectImportSchema = Schema.Struct({
  /** Module specifier as written: "effect", "effect/Schema", "@effect/cli/Args". */
  module: Schema.String,
  /** Package the specifier belongs to: "effect" or "@effect/<name>". */
  package: Schema.String,
  kind: Schema.Literals(["import", "require", "export-from", "dynamic-import"]),
  /** 1-based line of the statement, tying the row to later AST-based signals. */
  line: Schema.Finite,
  names: Schema.Array(ImportNameSchema),
});

const FileImportsSchema = Schema.Struct({
  file: Schema.String,
  role: FileRoleSchema,
  imports: Schema.Array(EffectImportSchema),
});

/**
 * Every Effect import in the clone, per file. This is the raw grain the
 * aggregations are built on: imports per file, packages per file, usage in
 * test vs production code.
 */
export const EffectImportsPerFileSchema = Schema.TaggedStruct("effect-imports-per-file", {
  importCount: Schema.Finite,
  files: Schema.Array(FileImportsSchema),
});

export type EffectImportsPerFileSignal = Schema.Schema.Type<typeof EffectImportsPerFileSchema>;

export type EffectImport = Schema.Schema.Type<typeof EffectImportSchema>;

/**
 * Distinct Effect packages used by the clone and per file, derived from the
 * same scan as `effect-imports-per-file` (so the two can never disagree).
 */
export const EffectPackagesUsedSchema = Schema.TaggedStruct("effect-packages-used", {
  /** Distinct packages across the repository, sorted. */
  packages: Schema.Array(Schema.String),
  files: Schema.Array(
    Schema.Struct({
      file: Schema.String,
      role: FileRoleSchema,
      /** Distinct packages within the file, sorted. */
      packages: Schema.Array(Schema.String),
    }),
  ),
});

export type EffectPackagesUsedSignal = Schema.Schema.Type<typeof EffectPackagesUsedSchema>;

/**
 * What Effect symbols a file actually uses, counted from the TypeScript AST
 * (see `src/deep-analysis/symbols.ts`): import aliases are normalized through
 * the file's imports (`Effect as E` counts as `Effect.gen`), and call sites,
 * property accesses, bare identifiers and type positions are counted apart.
 * The per-symbol grain is what makes "which APIs do adopters use"
 * aggregations possible.
 */
export const EffectSymbolsPerFileSchema = Schema.TaggedStruct("effect-symbols-per-file", {
  file: Schema.String,
  role: FileRoleSchema,
  /** Total usages: the sum of the counts below. */
  total: Schema.Finite,
  symbols: Schema.Array(
    Schema.Struct({
      /** Normalized name: "Effect.gen", "Schema.Struct", "pipe", "Effect.Effect". */
      symbol: Schema.String,
      kind: Schema.Literals(["call", "property-access", "identifier", "type-reference"]),
      count: Schema.Finite,
    }),
  ),
});

export type EffectSymbolsPerFileSignal = Schema.Schema.Type<typeof EffectSymbolsPerFileSchema>;

/**
 * A detected evidence of how the cloned repository uses Effect, gathered by
 * the deep-analysis probes. Separate from the selection signals of
 * `clone-state.ts`: those answer "is this an adopter?", these answer "how is
 * Effect used?". Like selection signals, absence of evidence is simply no
 * signal.
 */
export const AnalysisSignalSchema = Schema.Union([
  TsFileCountSchema,
  FilesUsingEffectCountSchema,
  EffectImportsPerFileSchema,
  EffectPackagesUsedSchema,
  EffectSymbolsPerFileSchema,
]);

export type AnalysisSignal = Schema.Schema.Type<typeof AnalysisSignalSchema>;

export const AnalysisStatusSchema = Schema.Literals(["analyzed", "analysis-failed"]);

export type AnalysisStatus = Schema.Schema.Type<typeof AnalysisStatusSchema>;

/**
 * The deep-analysis state of one Effect adopter: the commit actually analyzed
 * (which is whatever the clone's HEAD was, not necessarily the commit the
 * selection stage pinned), the usage signals gathered by the probes, and the
 * outcome. Records are appended to `analysis-state.jsonl` and keyed by
 * `repoId` for resume; failed analyses are retried on later runs.
 */
export const AnalysisStateSchema = Schema.Struct({
  repoId: Schema.Finite,
  fullName: Schema.String,

  /**
   * Commit hash of the analyzed snapshot (the clone's HEAD). Absent while the
   * analysis failed before a snapshot was available.
   */
  commit: Schema.optionalKey(Schema.String),

  analysisStatus: AnalysisStatusSchema,
  analysisError: Schema.optionalKey(Schema.String),
  signals: Schema.Array(AnalysisSignalSchema),
  recordedAt: Schema.DateTimeUtcFromString,
});

export type AnalysisState = Schema.Schema.Type<typeof AnalysisStateSchema>;

/**
 * Whether the analyzed repository actually imports Effect in its source tree
 * (as opposed to only declaring it in a manifest).
 */
export const hasEffectCodeUsage = (signals: ReadonlyArray<AnalysisSignal>): boolean =>
  signals.some((signal) => signal._tag === "files-using-effect-count" && signal.count > 0);
