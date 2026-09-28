import { Effect } from "effect";
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
   * The parsed AST of an absolute path, or `undefined` when the file cannot
   * be attached to a project (broken configuration, unreadable file).
   */
  readonly sourceFile: (path: string) => SourceFile | undefined;
}

/**
 * Runs `body` against an AST session covering the given absolute file paths.
 * The paths must be passed up front: `updateSnapshot` is what makes them
 * known to the session at all (nothing is parsed without it).
 */
export const withAstSession = <A>(
  files: ReadonlyArray<string>,
  body: (session: AstSession) => A,
): Effect.Effect<A> =>
  Effect.acquireUseRelease(
    Effect.sync(() => new API()),
    (api) =>
      Effect.sync(() => {
        const snapshot =
          files.length === 0 ? undefined : api.updateSnapshot({ openFiles: [...files] });
        return body({
          sourceFile: (path) => {
            if (snapshot === undefined) return undefined;
            const project = snapshot.getDefaultProjectForFile(path);
            return project?.program.getSourceFile(path);
          },
        });
      }),
    (api) => Effect.sync(() => api.close()),
  );
