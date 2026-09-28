import { Array, Effect, Option } from "effect";
import * as FileSystem from "effect/FileSystem";
import type { SignalOf } from "../../domain/clone-state.ts";
import type { Probe } from "../probe.ts";

type PackageManagerSignal = SignalOf<"uses-pnpm" | "uses-bun" | "uses-npm">;

interface LockfileEvidence {
  readonly file: string;
  readonly exists: boolean;
}

/** The found file names joined for the signal's evidence, "" when none. */
const evidenceText = (evidence: ReadonlyArray<LockfileEvidence>): string =>
  Array.map(
    Array.filter(evidence, (entry) => entry.exists),
    (entry) => entry.file,
  ).join(", ");

/**
 * Detects the package managers backing the repository through their
 * lockfiles/workspace files at the clone root. A repository can legitimately
 * carry evidence for more than one manager, so this probe can emit up to
 * three signals.
 */
export const packageManagerProbe: Probe<PackageManagerSignal> = (cloneDir) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const exists = (file: string) =>
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

    const pnpm = evidenceText([pnpmWorkspace, pnpmLock]);
    const bun = evidenceText([bunBinaryLock, bunTextLock]);
    const npm = evidenceText([npmLock]);

    return [
      ...(pnpm === ""
        ? []
        : [{ _tag: "uses-pnpm", evidence: pnpm } satisfies SignalOf<"uses-pnpm">]),
      ...(bun === "" ? [] : [{ _tag: "uses-bun", evidence: bun } satisfies SignalOf<"uses-bun">]),
      ...(npm === "" ? [] : [{ _tag: "uses-npm", evidence: npm } satisfies SignalOf<"uses-npm">]),
    ];
  });
