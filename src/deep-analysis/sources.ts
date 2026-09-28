import { Array, Effect, Option, String } from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type { FileRole } from "../domain/analysis-state.ts";

/**
 * The TypeScript file inventory of a clone, shared by every deep-analysis
 * probe (text-level and, later, AST-based) so they all agree on what counts
 * as a source file and where it sits in the repository's conventions.
 */

export type SourceExtension = "ts" | "tsx" | "mts" | "cts";

export interface SourceFileEntry {
  /** Path relative to the clone root, `/`-separated as globbed. */
  readonly file: string;
  readonly extension: SourceExtension;
  readonly role: FileRole;
  /** `*.d.ts` / `*.d.mts` / `*.d.cts`: counted, never parsed as usage. */
  readonly declaration: boolean;
}

/** One glob per extension: brace patterns are not portable across globbers. */
const sourceGlobs = ["**/*.ts", "**/*.tsx", "**/*.mts", "**/*.cts"];

/**
 * Directories that never contain repository-authored source: dependencies,
 * VCS metadata, and the usual generated build output. Excluding build output
 * keeps the inventory from counting compiled copies of the same files.
 */
const excludePatterns = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/out/**",
  "**/coverage/**",
  "**/vendor/**",
];

const testFileNames = /\.(test|spec)\.(ts|tsx|mts|cts)$/;
const testDeclarationNames = /\.test-d\.(ts|mts|cts)$/;
const testDirectories = /(^|\/)(__tests__|tests?|spec|e2e|cypress|playwright)(\/|$)/;

/**
 * Whether a source file is test code or production code. Heuristic, applied
 * uniformly so every signal can split its rows by role:
 *
 * - filename: `*.test.ts`, `*.spec.tsx`, `*.test-d.ts`, …
 * - directory: `__tests__/`, `test/`, `tests/`, `spec/`, `e2e/`,
 *   `cypress/`, `playwright/` anywhere in the path
 *
 * A `test/`-style directory that holds non-test helpers still counts as test
 * code, which is the useful side of the error for adoption analysis.
 */
export const classifyRole = (file: string): FileRole =>
  testFileNames.test(file) || testDeclarationNames.test(file) || testDirectories.test(file)
    ? "test"
    : "source";

const declarationNames = /\.d\.(ts|mts|cts)$/;

const describeFile = (file: string): SourceFileEntry => {
  const declaration = declarationNames.test(file);
  const extension = file.endsWith(".tsx")
    ? "tsx"
    : file.endsWith(".mts")
      ? "mts"
      : file.endsWith(".cts")
        ? "cts"
        : "ts";
  return {
    file,
    extension,
    role: classifyRole(file),
    declaration,
  } satisfies SourceFileEntry;
};

/**
 * Every TypeScript file below `cloneDir` (declarations included, build output
 * and dependencies excluded), sorted by path. Unreadable or failed globs
 * contribute nothing rather than failing the probe.
 */
export const findSourceFiles = (
  cloneDir: string,
): Effect.Effect<ReadonlyArray<SourceFileEntry>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const globbed = yield* Effect.forEach(sourceGlobs, (pattern) =>
      Effect.option(fs.glob(pattern, { root: cloneDir, exclude: excludePatterns })),
    );

    const found = new Set<string>();
    for (const result of globbed) {
      Option.match(result, {
        onNone: () => {},
        onSome: (files) => {
          for (const file of files) found.add(file);
        },
      });
    }

    return Array.map(Array.sort(String.Order)([...found]), describeFile);
  });
