import { Array, Effect, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import type * as Path from "effect/Path";
import type { Signal } from "../../domain/clone-state.ts";

interface LockfileEvidence {
  readonly file: string;
  readonly exists: boolean;
}

const lockfileSignals = (
  tag: "uses-pnpm" | "uses-bun" | "uses-npm",
  evidence: ReadonlyArray<LockfileEvidence>,
): ReadonlyArray<Signal> => {
  const found = Array.filter(evidence, (entry) => entry.exists);
  if (found.length === 0) return [];
  return [
    {
      _tag: tag,
      evidence: Array.map(found, (entry) => entry.file).join(", "),
    } satisfies Signal,
  ];
};

/**
 * Detects the package managers backing the repository through their
 * lockfiles/workspace files at the clone root. A repository can legitimately
 * carry evidence for more than one manager, so this probe can emit up to
 * three signals.
 */
export const packageManagerProbe = (
  cloneDir: string,
): Effect.Effect<ReadonlyArray<Signal>, never, FileSystem.FileSystem | Path.Path> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const exists = (
      file: string,
    ): Effect.Effect<LockfileEvidence, never, FileSystem.FileSystem | Path.Path> =>
      Effect.map(Effect.option(fs.exists(`${cloneDir}/${file}`)), (result) => ({
        file,
        exists: Option.getOrElse(result, () => false),
      }));

    const [pnpmWorkspace, pnpmLock, bunBinaryLock, bunTextLock, npmLock] = yield* Effect.all(
      [
        exists("pnpm-workspace.yaml"),
        exists("pnpm-lock.yaml"),
        exists("bun.lockb"),
        exists("bun.lock"),
        exists("package-lock.json"),
      ],
      { concurrency: "unbounded" },
    );

    return [
      ...lockfileSignals("uses-pnpm", [pnpmWorkspace, pnpmLock]),
      ...lockfileSignals("uses-bun", [bunBinaryLock, bunTextLock]),
      ...lockfileSignals("uses-npm", [npmLock]),
    ];
  });
