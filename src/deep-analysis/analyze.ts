import { Buffer } from "node:buffer";
import { Effect, Option, Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import type {
  EffectImport,
  FileRole,
  Parser,
  SourceExtension,
  SymbolUsage,
} from "../domain/usage.ts";
import { scanEffectImports } from "./imports.ts";
import { countLoc } from "./lines.ts";
import { hasGeneratedHeader, type SourceFileEntry } from "./tree.ts";
import { analyzeFile } from "./usage.ts";

/**
 * Bumped whenever the deep analysis changes what it records, so previously
 * analyzed adopters can be re-analyzed (`--reanalyze`) and rows of different
 * analyzer generations are never mixed silently.
 */
export const ANALYZER_VERSION = 3;

/**
 * The file inventory of one repository at the grain aggregations need:
 * workspace package x role x extension. Every repository gets these rows
 * from its tree listing alone (`files`, `declarationFiles`); adopters get
 * them per workspace package, other repositories per repository
 * (`packageDir` null), which keeps the population-wide inventory small.
 * Deep-analyzed adopters also get the content-derived columns (LOC, Effect
 * files).
 */
export interface FileTotalsRow {
  /** The workspace package directory, null when not split by package. */
  readonly packageDir: string | null;
  readonly role: FileRole;
  readonly extension: SourceExtension;
  /** Non-declaration TypeScript files. */
  readonly files: number;
  readonly declarationFiles: number;
  /** Non-blank lines over `files`; null when the contents were not analyzed. */
  readonly loc: number | null;
  /** Files with at least one Effect import; null when not analyzed. */
  readonly effectFiles: number | null;
  /** LOC of the Effect files; null when not analyzed. */
  readonly effectLoc: number | null;
  /** Files above the parse size limit (scanned as text only); null when not analyzed. */
  readonly largeFiles: number | null;
  /** Listed files that could not be read from the checkout; null when not analyzed. */
  readonly unreadableFiles: number | null;
}

/** One source file that imports Effect: the per-file grain of the analysis. */
export interface EffectFileRow {
  readonly file: string;
  readonly packageDir: string;
  readonly role: FileRole;
  readonly extension: SourceExtension;
  readonly loc: number;
  readonly bytes: number;
  readonly parser: Parser;
  readonly imports: ReadonlyArray<EffectImport>;
  readonly symbols: ReadonlyArray<SymbolUsage>;
}

export interface DeepAnalysis {
  readonly totals: ReadonlyArray<FileTotalsRow>;
  readonly effectFiles: ReadonlyArray<EffectFileRow>;
}

export interface AnalyzeOptions {
  /** Files above this size are scanned as text only (they are usually generated). */
  readonly maxParseBytes: number;
}

type MutableTotals = { -readonly [K in keyof FileTotalsRow]: FileTotalsRow[K] };

const totalsKey = (entry: SourceFileEntry, byPackage: boolean): string =>
  `${byPackage ? entry.packageDir : ""}\0${entry.role}\0${entry.extension}`;

const emptyTotals = (
  entry: SourceFileEntry,
  byPackage: boolean,
  analyzed: boolean,
): MutableTotals => ({
  packageDir: byPackage ? entry.packageDir : null,
  role: entry.role,
  extension: entry.extension,
  files: 0,
  declarationFiles: 0,
  loc: analyzed ? 0 : null,
  effectFiles: analyzed ? 0 : null,
  effectLoc: analyzed ? 0 : null,
  largeFiles: analyzed ? 0 : null,
  unreadableFiles: analyzed ? 0 : null,
});

const groupTotals = (
  files: ReadonlyArray<SourceFileEntry>,
  byPackage: boolean,
  analyzed: boolean,
): Map<string, MutableTotals> => {
  const totals = new Map<string, MutableTotals>();
  for (const entry of files) {
    const key = totalsKey(entry, byPackage);
    let row = totals.get(key);
    if (row === undefined) {
      row = emptyTotals(entry, byPackage, analyzed);
      totals.set(key, row);
    }
    if (entry.declaration) row.declarationFiles++;
    else row.files++;
  }
  return totals;
};

const sortedTotals = (totals: Map<string, MutableTotals>): ReadonlyArray<FileTotalsRow> =>
  [...totals.entries()].sort(([left], [right]) => (left < right ? -1 : 1)).map(([, row]) => row);

/**
 * File totals from the tree listing alone: counts, no content-derived
 * columns; split by workspace package only when `byPackage`.
 */
export const inventoryTotals = (
  files: ReadonlyArray<SourceFileEntry>,
  byPackage: boolean,
): ReadonlyArray<FileTotalsRow> => sortedTotals(groupTotals(files, byPackage, false));

type FileOutcome =
  | { readonly _tag: "unreadable" }
  | {
      readonly _tag: "read";
      /** The path role, or `generated` when the header says a tool wrote the file. */
      readonly role: FileRole;
      readonly loc: number;
      readonly large: boolean;
      readonly row?: EffectFileRow;
    };

/**
 * Deep-analyzes the checked-out TypeScript sources of one repository: every
 * non-declaration file is read whole once, measured (LOC), classified as
 * generated when its header says so (on top of the path role), and — when
 * its text mentions `effect` at all, a necessary condition for any Effect
 * module specifier — parsed for imports and symbol usages. Each file's
 * contents are dropped once it is processed (eight files in flight at a
 * time), but the per-file rows are accumulated for the whole repository,
 * so peak memory grows with the repository's per-file results, not with
 * the read concurrency alone.
 */
export const analyzeSources = (
  cloneDir: string,
  files: ReadonlyArray<SourceFileEntry>,
  options: AnalyzeOptions,
): Effect.Effect<DeepAnalysis, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const sources = files.filter((entry) => !entry.declaration);

    const outcomes = yield* Effect.forEach(
      sources,
      (entry) =>
        Effect.map(
          Effect.option(fs.readFileString(path.join(cloneDir, entry.file))),
          Option.match({
            onNone: (): FileOutcome => ({ _tag: "unreadable" }),
            onSome: (text): FileOutcome => {
              const role: FileRole =
                entry.role !== "generated" && hasGeneratedHeader(text) ? "generated" : entry.role;
              const loc = countLoc(text);
              const bytes = Buffer.byteLength(text);
              const large = bytes > options.maxParseBytes;
              if (!text.includes("effect")) return { _tag: "read", role, loc, large };
              const usage = large
                ? {
                    parser: "text-fallback" as const,
                    imports: scanEffectImports(text),
                    symbols: [],
                  }
                : analyzeFile(entry.file, text, entry.extension);
              if (usage.imports.length === 0) return { _tag: "read", role, loc, large };
              return {
                _tag: "read",
                role,
                loc,
                large,
                row: {
                  file: entry.file,
                  packageDir: entry.packageDir,
                  role,
                  extension: entry.extension,
                  loc,
                  bytes,
                  parser: usage.parser,
                  imports: usage.imports,
                  symbols: usage.symbols,
                },
              };
            },
          }),
        ),
      { concurrency: 8 },
    );

    // Totals are grouped by the final role, so a header-detected generated
    // file moves out of its path role's row. Declarations keep their path role.
    const finalRole = new Map<string, FileRole>();
    sources.forEach((entry, index) => {
      const outcome = outcomes[index];
      if (outcome?._tag === "read") finalRole.set(entry.file, outcome.role);
    });
    const classified = files.map((entry) => {
      const role = finalRole.get(entry.file);
      return role === undefined || role === entry.role ? entry : { ...entry, role };
    });
    const totals = groupTotals(classified, true, true);

    const effectFiles: Array<EffectFileRow> = [];
    sources.forEach((entry, index) => {
      const outcome = outcomes[index];
      const role = finalRole.get(entry.file) ?? entry.role;
      const row = totals.get(totalsKey({ ...entry, role }, true));
      if (outcome === undefined || row === undefined) return;
      if (outcome._tag === "unreadable") {
        row.unreadableFiles = (row.unreadableFiles ?? 0) + 1;
        return;
      }
      row.loc = (row.loc ?? 0) + outcome.loc;
      if (outcome.large) row.largeFiles = (row.largeFiles ?? 0) + 1;
      if (outcome.row !== undefined) {
        row.effectFiles = (row.effectFiles ?? 0) + 1;
        row.effectLoc = (row.effectLoc ?? 0) + outcome.loc;
        effectFiles.push(outcome.row);
      }
    });

    return { totals: sortedTotals(totals), effectFiles };
  });
