import { Schema } from "effect";

/**
 * Where a source file sits in the repository's own conventions. Detection is
 * heuristic (see `src/deep-analysis/tree.ts`): `generated` for code written
 * by a tool (path conventions such as `*.gen.ts` or `__generated__/`, or a
 * "do not edit" header), `test` for filename patterns such as `*.test.ts` /
 * `*.spec.tsx` or a `test/`/`__tests__/`-style directory, `source` for
 * everything else — the hand-written production code.
 */
export const FileRoleSchema = Schema.Literals(["source", "test", "generated"]);

export type FileRole = Schema.Schema.Type<typeof FileRoleSchema>;

export const SourceExtensionSchema = Schema.Literals(["ts", "tsx", "mts", "cts"]);

export type SourceExtension = Schema.Schema.Type<typeof SourceExtensionSchema>;

/** One binding of an import clause, e.g. `Effect as E` -> imported "Effect", local "E". */
export const ImportNameSchema = Schema.Struct({
  imported: Schema.String,
  local: Schema.String,
  typeOnly: Schema.Boolean,
});

export type ImportName = Schema.Schema.Type<typeof ImportNameSchema>;

export const ImportKindSchema = Schema.Literals([
  "import",
  "require",
  "export-from",
  "dynamic-import",
  // `import("effect").Layer.MemoMap` — a type-only module import.
  "type-import",
]);

export type ImportKind = Schema.Schema.Type<typeof ImportKindSchema>;

/** One Effect import statement of one file. */
export const EffectImportSchema = Schema.Struct({
  /** Module specifier as written: "effect", "effect/Schema", "@effect/cli/Args". */
  module: Schema.String,
  /** Package the specifier belongs to: "effect" or "@effect/<name>". */
  package: Schema.String,
  kind: ImportKindSchema,
  /** 1-based line of the statement. */
  line: Schema.Finite,
  names: Schema.Array(ImportNameSchema),
});

export type EffectImport = Schema.Schema.Type<typeof EffectImportSchema>;

export const SymbolKindSchema = Schema.Literals([
  "call",
  "property-access",
  "identifier",
  "type-reference",
]);

export type SymbolKind = Schema.Schema.Type<typeof SymbolKindSchema>;

/**
 * How often one file uses one Effect symbol in one syntactic position.
 * Import aliases are normalized (`Effect as E; E.gen()` counts as
 * `Effect.gen`), see `src/deep-analysis/usage.ts`.
 */
export const SymbolUsageSchema = Schema.Struct({
  /** Normalized name: "Effect.gen", "Schema.Struct", "pipe", "Effect.Effect". */
  symbol: Schema.String,
  kind: SymbolKindSchema,
  count: Schema.Finite,
});

export type SymbolUsage = Schema.Schema.Type<typeof SymbolUsageSchema>;

/** Which parser produced a file's rows. */
export const ParserSchema = Schema.Literals(["oxc", "text-fallback"]);

export type Parser = Schema.Schema.Type<typeof ParserSchema>;

/** The Effect usage of one source file: its imports and the symbols used through them. */
export interface FileUsage {
  readonly imports: ReadonlyArray<EffectImport>;
  readonly symbols: ReadonlyArray<SymbolUsage>;
}
