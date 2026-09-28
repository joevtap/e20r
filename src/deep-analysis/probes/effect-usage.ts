import { Array, Cause, Effect, Exit, Option, Path, String } from "effect";
import * as FileSystem from "effect/FileSystem";
import type {
  EffectImportsPerFileSignal,
  EffectPackagesUsedSignal,
  EffectSymbolsPerFileSignal,
  FilesUsingEffectCountSignal,
} from "../../domain/analysis-state.ts";
import { findSourceFiles } from "../sources.ts";
import { scanEffectImports } from "../imports.ts";
import { collectUsage, type FileUsage } from "../usage.ts";
import { withAstSession } from "../ast.ts";
import type { AnalysisProbe } from "../probe.ts";

type UsageSignal =
  | FilesUsingEffectCountSignal
  | EffectImportsPerFileSignal
  | EffectPackagesUsedSignal
  | EffectSymbolsPerFileSignal;

interface Candidate {
  readonly file: string;
  readonly role: "source" | "test";
  readonly text: string;
}

interface FileResult {
  readonly entry: Candidate;
  readonly usage: FileUsage;
}

/**
 * The effect-usage probe: one read and one AST walk per candidate file emit
 * the four usage signals together (`files-using-effect-count`,
 * `effect-imports-per-file`, `effect-packages-used`, `effect-symbols-per-
 * file`), which is both the fastest and the most consistent shape — the
 * imports and the symbols counted through them can never come from
 * different parses.
 *
 * Selection is a loose text check (`"effect"` substring — a necessary
 * condition for any effect module specifier), so files the regex scanner
 * would miss are still parsed. What the AST cannot parse falls back to the
 * text-level scanner (imports only), and whatever is still unparseable is
 * reported instead of dropped silently. The AST layer failing entirely
 * degrades to text-scanned imports without symbols.
 */
export const effectUsageProbe: AnalysisProbe<UsageSignal> = (cloneDir, _repo, runOptions) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const sources = Array.filter(yield* findSourceFiles(cloneDir), (entry) => !entry.declaration);

    // One read per file.
    const read = yield* Effect.forEach(
      sources,
      (entry) =>
        Effect.map(Effect.option(fs.readFileString(path.join(cloneDir, entry.file))), (content) =>
          Option.map(content, (text): Candidate => ({ file: entry.file, role: entry.role, text })),
        ),
      { concurrency: 16 },
    );

    const candidates = Array.filter(Array.getSomes(read), (entry) => entry.text.includes("effect"));

    // Reliability floor: the text scanner only misses exotic syntax (a
    // statement not starting its line, imports inside comments), and never
    // fails where an AST cannot be built.
    const fallback = (entry: Candidate): FileResult => ({
      entry,
      usage: { imports: scanEffectImports(entry.text), symbols: [] },
    });

    const parseAll = (
      entries: ReadonlyArray<Candidate>,
    ): Effect.Effect<
      { parsed: ReadonlyArray<FileResult>; unparsed: ReadonlyArray<Candidate> },
      never,
      Path.Path
    > =>
      withAstSession(
        entries.map((entry) => path.join(cloneDir, entry.file)),
        (session) => {
          const parsed: Array<FileResult> = [];
          const unparsed: Array<Candidate> = [];
          for (const entry of entries) {
            const source = session.sourceFile(path.join(cloneDir, entry.file));
            if (source === undefined) {
              unparsed.push(entry);
              continue;
            }
            parsed.push({ entry, usage: collectUsage(source) });
          }
          return { parsed, unparsed };
        },
      );

    let parsed: Array<FileResult> = [];

    if (candidates.length > 0 && runOptions.ast) {
      let unparsed: ReadonlyArray<Candidate> = candidates;

      const first = yield* Effect.exit(parseAll(candidates));
      if (Exit.isFailure(first)) {
        yield* Effect.logWarning(`AST usage analysis failed: ${Cause.pretty(first.cause)}`);
      } else {
        parsed = [...first.value.parsed];
        unparsed = first.value.unparsed;
      }

      if (unparsed.length > 0) {
        // One retry in a fresh session: project attachment can fail
        // transiently (load from concurrent work in the same run), and the
        // retry is cheap because only the missed files are re-opened.
        const second = yield* Effect.exit(parseAll(unparsed));
        if (Exit.isFailure(second)) {
          yield* Effect.logWarning(
            `AST usage analysis retry failed: ${Cause.pretty(second.cause)}`,
          );
        } else {
          parsed = [...parsed, ...second.value.parsed];
          unparsed = second.value.unparsed;
        }
      }

      if (unparsed.length > 0) {
        yield* Effect.logWarning(
          `AST usage analysis could not parse ${unparsed.length} of ${candidates.length} effect-using files in ${cloneDir}; falling back to the text scanner`,
        );
      }
      parsed = [...parsed, ...unparsed.map(fallback)];
    } else if (candidates.length > 0) {
      // --no-ast: the text scanner is the only source — imports without
      // symbol counts, and the scanner's documented blind spots.
      parsed = candidates.map(fallback);
    }

    const withImports = Array.filter(parsed, (result) => result.usage.imports.length > 0);
    withImports.sort((left, right) => String.Order(left.entry.file, right.entry.file));

    // Files, imports and packages come from the same rows, so the signals
    // can never disagree; the file count is always emitted, even zero.
    const byRole = { source: 0, test: 0 };
    let importCount = 0;
    const allPackages = new Set<string>();
    const importFiles: Array<EffectImportsPerFileSignal["files"][number]> = [];
    const packageFiles: Array<EffectPackagesUsedSignal["files"][number]> = [];

    for (const result of withImports) {
      byRole[result.entry.role]++;
      importCount += result.usage.imports.length;

      const packages = [...new Set(result.usage.imports.map((row) => row.package))].sort();
      for (const name of packages) allPackages.add(name);

      importFiles.push({
        file: result.entry.file,
        role: result.entry.role,
        imports: result.usage.imports,
      });
      packageFiles.push({ file: result.entry.file, role: result.entry.role, packages });
    }

    const signals: Array<UsageSignal> = [
      {
        _tag: "files-using-effect-count",
        count: withImports.length,
        byRole,
      } satisfies FilesUsingEffectCountSignal,
    ];

    if (withImports.length > 0) {
      signals.push(
        {
          _tag: "effect-imports-per-file",
          importCount,
          files: importFiles,
        } satisfies EffectImportsPerFileSignal,
        {
          _tag: "effect-packages-used",
          packages: [...allPackages].sort(),
          files: packageFiles,
        } satisfies EffectPackagesUsedSignal,
      );
    }

    for (const result of withImports) {
      const symbols = result.usage.symbols;
      if (symbols.length === 0) continue;
      signals.push({
        _tag: "effect-symbols-per-file",
        file: result.entry.file,
        role: result.entry.role,
        total: symbols.reduce((sum, symbol) => sum + symbol.count, 0),
        symbols,
      } satisfies EffectSymbolsPerFileSignal);
    }

    return signals;
  });
