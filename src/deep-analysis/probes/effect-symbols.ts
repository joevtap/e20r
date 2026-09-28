import { Array, Cause, Effect, Exit, Option, Path, String } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { EffectSymbolsPerFileSignal } from "../../domain/analysis-state.ts";
import { findSourceFiles } from "../sources.ts";
import { scanEffectImports, type EffectImportRow } from "../imports.ts";
import { withAstSession } from "../ast.ts";
import { countEffectSymbols, type EffectBindings } from "../symbols.ts";
import type { AnalysisProbe } from "../probe.ts";

/**
 * The normalized bases of a file's static Effect imports: `import { Effect
 * as E }` binds "E" to "Effect", `import * as NS` binds "NS" to "NS".
 * Re-exports create no local binding and are skipped, and `require`/
 * dynamic-import bindings are not destructured here.
 */
const bindingsOf = (rows: ReadonlyArray<EffectImportRow>): EffectBindings => {
  const bindings = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== "import") continue;
    for (const name of row.names) {
      const base =
        name.imported === "default" || name.imported === "*" ? name.local : name.imported;
      bindings.set(name.local, base);
    }
  }
  return bindings;
};

interface Candidate {
  readonly file: string;
  readonly role: EffectSymbolsPerFileSignal["role"];
  readonly bindings: EffectBindings;
  readonly rows: ReadonlyArray<EffectImportRow>;
}

interface ParseOutcome {
  readonly gathered: ReadonlyArray<EffectSymbolsPerFileSignal>;
  /** Files the AST session could not attach to any project. */
  readonly unparsed: ReadonlyArray<Candidate>;
}

/**
 * Counts the Effect symbol usages of every file that imports Effect, from the
 * TypeScript AST. The text-level scan only selects the candidate files and
 * their import bindings, so the AST cost stays proportional to effect usage
 * instead of repository size.
 *
 * Emits one `effect-symbols-per-file` signal per file with usages; a file
 * that imports Effect but uses none of it emits nothing. Files the AST
 * session cannot attach to a project are retried once in a fresh session
 * (project attachment can fail transiently under load), and what still
 * cannot be parsed is reported as a warning instead of being dropped
 * silently. If the AST cannot run at all, the probe logs and emits nothing
 * rather than failing the run.
 */
export const effectSymbolsProbe: AnalysisProbe<EffectSymbolsPerFileSignal> = (cloneDir) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const sources = Array.filter(yield* findSourceFiles(cloneDir), (entry) => !entry.declaration);

    const scanned = yield* Effect.forEach(
      sources,
      (entry) =>
        Effect.map(Effect.option(fs.readFileString(path.join(cloneDir, entry.file))), (content) =>
          Option.map(content, (text): Candidate => {
            const rows = scanEffectImports(text);
            return {
              file: entry.file,
              role: entry.role,
              bindings: bindingsOf(rows),
              rows,
            };
          }),
        ),
      { concurrency: 16 },
    );

    // Candidates are the files the text scan found Effect imports in — the
    // same set the effect-imports probe reports rows for.
    const candidates = Array.filter(Array.getSomes(scanned), (entry) => entry.rows.length > 0);
    if (candidates.length === 0) return [];

    const parseCandidates = (
      entries: ReadonlyArray<Candidate>,
    ): Effect.Effect<ParseOutcome, never, Path.Path> =>
      withAstSession(
        entries.map((entry) => path.join(cloneDir, entry.file)),
        (session) => {
          const gathered: Array<EffectSymbolsPerFileSignal> = [];
          const unparsed: Array<Candidate> = [];
          for (const entry of entries) {
            const source = session.sourceFile(path.join(cloneDir, entry.file));
            if (source === undefined) {
              unparsed.push(entry);
              continue;
            }
            const symbols = countEffectSymbols(source, entry.bindings);
            if (symbols.length === 0) continue;
            gathered.push({
              _tag: "effect-symbols-per-file",
              file: entry.file,
              role: entry.role,
              total: symbols.reduce((sum, usage) => sum + usage.count, 0),
              symbols,
            });
          }
          return { gathered, unparsed };
        },
      );

    const first = yield* Effect.exit(parseCandidates(candidates));

    if (Exit.isFailure(first)) {
      // The AST layer is best-effort: a broken TypeScript install or an
      // unusable repository must not fail the whole analysis run.
      yield* Effect.logWarning(`AST symbol analysis failed: ${Cause.pretty(first.cause)}`);
      return [];
    }

    let gathered = [...first.value.gathered];
    let unparsed = first.value.unparsed;

    if (unparsed.length > 0) {
      // One retry in a fresh session: project attachment can fail
      // transiently (load from concurrent work in the same run), and the
      // retry is cheap because only the missed files are re-opened.
      const second = yield* Effect.exit(parseCandidates(unparsed));
      if (Exit.isFailure(second)) {
        yield* Effect.logWarning(`AST symbol analysis retry failed: ${Cause.pretty(second.cause)}`);
      } else {
        gathered = [...gathered, ...second.value.gathered];
        unparsed = second.value.unparsed;
      }
    }

    if (unparsed.length > 0) {
      yield* Effect.logWarning(
        `AST symbol analysis could not parse ${unparsed.length} of ${candidates.length} effect-using files in ${cloneDir}`,
      );
    }

    return gathered.sort((left, right) => String.Order(left.file, right.file));
  });
