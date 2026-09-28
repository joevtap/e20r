import { Array, Cause, Effect, Exit, Option, Path } from "effect";
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
}

/**
 * Counts the Effect symbol usages of every file that imports Effect, from the
 * TypeScript AST. The text-level scan only selects the candidate files and
 * their import bindings, so the AST cost stays proportional to effect usage
 * instead of repository size.
 *
 * Emits one `effect-symbols-per-file` signal per file with usages; a file
 * that imports Effect but uses none of it emits nothing. If the AST cannot
 * run at all (broken TypeScript install, unusable repository), the failure
 * is logged and the probe emits nothing rather than failing the run.
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
          Option.map(content, (text): Candidate & { rows: ReadonlyArray<EffectImportRow> } => {
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

    const exit = yield* Effect.exit(
      withAstSession(
        candidates.map((entry) => path.join(cloneDir, entry.file)),
        (session) => {
          const gathered: Array<EffectSymbolsPerFileSignal> = [];
          for (const entry of candidates) {
            const source = session.sourceFile(path.join(cloneDir, entry.file));
            if (source === undefined) continue;
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
          return gathered;
        },
      ),
    );

    if (Exit.isFailure(exit)) {
      // The AST layer is best-effort: a broken TypeScript install or an
      // unusable repository must not fail the whole analysis run.
      yield* Effect.logWarning(`AST symbol analysis failed: ${Cause.pretty(exit.cause)}`);
      return [];
    }

    return exit.value;
  });
