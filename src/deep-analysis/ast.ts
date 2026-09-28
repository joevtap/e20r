import { Effect, Path } from "effect";
import type { SourceFile } from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

/**
 * AST access for the deep-analysis probes.
 *
 * The TypeScript 7 toolchain has no pure-JS parser: source text only becomes
 * a `SourceFile` through the bundled tsgo language-server binary, spawned
 * per session. One session per repository is the right grain — the spawn is
 * cheap (~30ms) and parsing is lazy per file. Files outside any tsconfig are
 * attached to an inferred project, so repositories without configuration
 * still parse.
 */
export interface AstSession {
  /**
   * The parsed AST of a file path (relative to the run's working directory
   * or absolute), or `undefined` when the file cannot be attached to a
   * project (broken configuration, unreadable file).
   */
  readonly sourceFile: (path: string) => SourceFile | undefined;
}

/**
 * Runs `body` against an AST session covering the given file paths. The
 * paths must be passed up front: `updateSnapshot` is what makes them known
 * to the session at all (nothing is parsed without it).
 *
 * Paths are resolved to absolute form before reaching the language server:
 * it keys projects and program files by absolute path, so a relative path
 * silently attaches to nothing.
 */
export const withAstSession = <A>(
  files: ReadonlyArray<string>,
  body: (session: AstSession) => A,
): Effect.Effect<A, never, Path.Path> =>
  Effect.gen(function* () {
    const path = yield* Path.Path;
    const absolute = (file: string): string => path.resolve(file);

    return yield* Effect.acquireUseRelease(
      Effect.sync(() => new API()),
      (api) =>
        Effect.sync(() => {
          const snapshot =
            files.length === 0 ? undefined : api.updateSnapshot({ openFiles: files.map(absolute) });
          return body({
            sourceFile: (file) => {
              if (snapshot === undefined) return undefined;
              const resolved = absolute(file);
              return snapshot.getDefaultProjectForFile(resolved)?.program.getSourceFile(resolved);
            },
          });
        }),
      (api) => Effect.sync(() => api.close()),
    );
  });
