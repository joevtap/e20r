import { Array, Effect, Option, Path } from "effect";
import * as FileSystem from "effect/FileSystem";
import type {
  EffectImportsPerFileSignal,
  EffectPackagesUsedSignal,
  FilesUsingEffectCountSignal,
} from "../../domain/analysis-state.ts";
import { findSourceFiles } from "../sources.ts";
import { scanEffectImports } from "../imports.ts";
import type { AnalysisProbe } from "../probe.ts";

type FileImports = EffectImportsPerFileSignal["files"][number];
type FilePackages = EffectPackagesUsedSignal["files"][number];

/**
 * Scans every non-declaration source file of the clone for Effect imports and
 * emits the per-file rows plus their roll-ups, all from the same scan so they
 * can never disagree:
 *
 * - `files-using-effect-count` — always emitted, even zero, so manifest-only
 *   adopters are distinguishable in aggregations;
 * - `effect-imports-per-file` and `effect-packages-used` — emitted when at
 *   least one file uses Effect (absence of evidence is no signal).
 */
export const effectImportsProbe: AnalysisProbe<
  FilesUsingEffectCountSignal | EffectImportsPerFileSignal | EffectPackagesUsedSignal
> = (cloneDir) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    const sources = Array.filter(yield* findSourceFiles(cloneDir), (entry) => !entry.declaration);

    // Files are read concurrently but bounded: an unbounded read of a very
    // large repository would exhaust file descriptors for no benefit.
    const scanned = yield* Effect.forEach(
      sources,
      (entry) =>
        Effect.map(Effect.option(fs.readFileString(path.join(cloneDir, entry.file))), (content) =>
          Option.map(content, (text) => ({
            file: entry.file,
            role: entry.role,
            imports: scanEffectImports(text),
          })),
        ),
      { concurrency: 16 },
    );

    const used = Array.filter(Array.getSomes(scanned), (entry) => entry.imports.length > 0);

    const byRole = { source: 0, test: 0 };
    let importCount = 0;
    const allPackages = new Set<string>();

    const files: Array<FileImports> = [];
    const packageFiles: Array<FilePackages> = [];

    for (const entry of used) {
      byRole[entry.role]++;
      importCount += entry.imports.length;

      const packages = [...new Set(entry.imports.map((row) => row.package))].sort();
      for (const name of packages) allPackages.add(name);

      files.push({
        file: entry.file,
        role: entry.role,
        imports: entry.imports,
      });
      packageFiles.push({ file: entry.file, role: entry.role, packages });
    }

    const signals: Array<
      FilesUsingEffectCountSignal | EffectImportsPerFileSignal | EffectPackagesUsedSignal
    > = [
      {
        _tag: "files-using-effect-count",
        count: used.length,
        byRole,
      } satisfies FilesUsingEffectCountSignal,
    ];

    if (used.length > 0) {
      signals.push(
        {
          _tag: "effect-imports-per-file",
          importCount,
          files,
        } satisfies EffectImportsPerFileSignal,
        {
          _tag: "effect-packages-used",
          packages: [...allPackages].sort(),
          files: packageFiles,
        } satisfies EffectPackagesUsedSignal,
      );
    }

    return signals;
  });
