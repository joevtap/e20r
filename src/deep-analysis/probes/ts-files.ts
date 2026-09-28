import { Effect } from "effect";
import type { TsFileCountSignal } from "../../domain/analysis-state.ts";
import { findSourceFiles } from "../sources.ts";
import type { AnalysisProbe } from "../probe.ts";

/**
 * Inventories the TypeScript files of the clone: the denominator every
 * "how deep is the adoption" ratio needs. Always emits the signal, even for
 * a repository without a single TypeScript file (everything zero).
 */
export const tsFilesProbe: AnalysisProbe<TsFileCountSignal> = (cloneDir) =>
  Effect.gen(function* () {
    const entries = yield* findSourceFiles(cloneDir);

    let total = 0;
    let declarationFiles = 0;
    const byExtension: Record<string, number> = {};
    const byRole = { source: 0, test: 0 };

    for (const entry of entries) {
      if (entry.declaration) {
        declarationFiles++;
        continue;
      }
      total++;
      byExtension[entry.extension] = (byExtension[entry.extension] ?? 0) + 1;
      byRole[entry.role]++;
    }

    return [
      {
        _tag: "ts-file-count",
        total,
        byExtension,
        byRole,
        declarationFiles,
      } satisfies TsFileCountSignal,
    ];
  });
