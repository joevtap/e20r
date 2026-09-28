// Ad-hoc smoke test for the deep-analysis probes: runs them against this
// repository itself (it is a TypeScript repo that uses Effect) and checks the
// gathered signals both loosely and against their schemas. Run from the
// repository root:
//
//   pnpm tsx scripts/test-deep-analysis.ts
//
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, Option, Schema } from "effect";
import { analyzeDeep } from "../src/deep-analysis/probe.ts";
import {
  AnalysisSignalSchema,
  type AnalysisSignal,
  type EffectImportsPerFileSignal,
  type EffectPackagesUsedSignal,
  type EffectSymbolsPerFileSignal,
  type FilesUsingEffectCountSignal,
  type TsFileCountSignal,
} from "../src/domain/analysis-state.ts";

let failures = 0;
const check = (name: string, condition: boolean, detail?: unknown): void => {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
};

const program = Effect.gen(function* () {
  // `repo` is unused by the current probes; the typed signature still wants it.
  const signals = yield* analyzeDeep(process.cwd(), {} as never);

  const decoded = Schema.decodeUnknownOption(Schema.Array(AnalysisSignalSchema))([...signals]);
  check("signals decode against the schema", Option.isSome(decoded));

  const byTag = <S extends AnalysisSignal>(tag: S["_tag"]): S | undefined =>
    signals.find((signal) => signal._tag === tag) as S | undefined;

  const tsFiles = byTag<TsFileCountSignal>("ts-file-count");
  check("ts-file-count gathered", tsFiles !== undefined);
  check("this repo has TypeScript sources", (tsFiles?.total ?? 0) > 10, tsFiles?.total);
  check(
    "byRole counts add up",
    (tsFiles?.byRole.source ?? 0) + (tsFiles?.byRole.test ?? 0) === (tsFiles?.total ?? -1),
    tsFiles?.byRole,
  );
  check(
    "byExtension counts add up",
    Object.values(tsFiles?.byExtension ?? {}).reduce((a, b) => a + b, 0) === (tsFiles?.total ?? -1),
    tsFiles?.byExtension,
  );

  const count = byTag<FilesUsingEffectCountSignal>("files-using-effect-count");
  check("files-using-effect-count gathered", count !== undefined && count.count >= 5, count);

  const imports = byTag<EffectImportsPerFileSignal>("effect-imports-per-file");
  check("effect-imports-per-file gathered", imports !== undefined && imports.files.length >= 5);
  check(
    "importCount matches the rows",
    (imports?.importCount ?? -1) ===
      (imports?.files ?? []).reduce((total, file) => total + file.imports.length, 0),
    imports?.importCount,
  );
  check(
    "every row has effect imports",
    (imports?.files ?? []).every((file) => file.imports.length > 0),
  );

  const packages = byTag<EffectPackagesUsedSignal>("effect-packages-used");
  check("effect-packages-used gathered", packages !== undefined && packages.packages.length >= 1);
  check("effect package present", packages?.packages.includes("effect"), packages?.packages);
  check(
    "packages sorted and distinct",
    JSON.stringify(packages?.packages) ===
      JSON.stringify([...new Set(packages?.packages ?? [])].sort()),
    packages?.packages,
  );
  check(
    "per-file package rows are non-empty",
    (packages?.files ?? []).every((file) => file.packages.length > 0),
  );

  // effect-symbols-per-file is emitted per file: gather them all.
  const symbolRows = signals.filter(
    (signal): signal is EffectSymbolsPerFileSignal => signal._tag === "effect-symbols-per-file",
  );
  check("effect-symbols-per-file gathered", symbolRows.length >= 5, symbolRows.length);
  check(
    "symbol totals match their rows",
    symbolRows.every(
      (row) => row.total === row.symbols.reduce((sum, usage) => sum + usage.count, 0),
    ),
  );
  check(
    "symbol rows sorted by count",
    symbolRows.every((row) =>
      row.symbols.every(
        (usage, index) => index === 0 || row.symbols[index - 1]!.count >= usage.count,
      ),
    ),
  );
  const allUsages = symbolRows.flatMap((row) => row.symbols);
  check(
    "Effect.gen calls counted",
    allUsages.some((usage) => usage.symbol === "Effect.gen" && usage.kind === "call"),
    allUsages.slice(0, 10),
  );
  check(
    "type references counted",
    allUsages.some((usage) => usage.kind === "type-reference"),
    allUsages.slice(0, 10),
  );
  check(
    "symbols only in files with imports",
    symbolRows.every((row) => row.symbols.length > 0),
  );

  if (failures > 0) {
    console.error(`\n${failures} FAILURES`);
    process.exitCode = 1;
  } else {
    console.log("\nAll deep-analysis probe assertions passed");
  }
}).pipe(Effect.provide(NodeServices.layer));

NodeRuntime.runMain(program);
