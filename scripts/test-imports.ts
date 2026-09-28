// Ad-hoc tests for the pure text-level import scanner and the source-file
// role classification (both run without touching the filesystem). Run with:
//
//   pnpm tsx scripts/test-imports.ts
//
import {
  effectPackageName,
  isEffectModule,
  parseClauseNames,
  scanEffectImports,
} from "../src/deep-analysis/imports.ts";
import { classifyRole } from "../src/deep-analysis/sources.ts";

let failures = 0;
const check = (name: string, condition: boolean, detail?: unknown): void => {
  if (condition) {
    console.log(`PASS ${name}`);
  } else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
};

// --- module matching ---
check("effect matches", isEffectModule("effect"));
check("effect subpath matches", isEffectModule("effect/Schema"));
check("@effect package matches", isEffectModule("@effect/cli/Args"));
check("effectful does not match", !isEffectModule("effectful"));
check("my-effect does not match", !isEffectModule("my-effect"));
check("@effectful does not match", !isEffectModule("@effectful/x"));
check("package of effect subpath", effectPackageName("effect/Schema") === "effect");
check("package of scoped subpath", effectPackageName("@effect/cli/Args") === "@effect/cli");

// --- clause parsing ---
check(
  "named import",
  JSON.stringify(parseClauseNames("{ Effect, pipe }")) ===
    JSON.stringify([
      { imported: "Effect", local: "Effect", typeOnly: false },
      { imported: "pipe", local: "pipe", typeOnly: false },
    ]),
  parseClauseNames("{ Effect, pipe }"),
);
check(
  "aliased + type names",
  JSON.stringify(parseClauseNames("{ Effect as E, type Types }")) ===
    JSON.stringify([
      { imported: "Effect", local: "E", typeOnly: false },
      { imported: "Types", local: "Types", typeOnly: true },
    ]),
  parseClauseNames("{ Effect as E, type Types }"),
);
check(
  "type-only clause",
  parseClauseNames("type { Effect }").every((name) => name.typeOnly),
);
check(
  "default + namespace",
  JSON.stringify(parseClauseNames("Eff, * as NS")) ===
    JSON.stringify([
      { imported: "default", local: "Eff", typeOnly: false },
      { imported: "*", local: "NS", typeOnly: false },
    ]),
  parseClauseNames("Eff, * as NS"),
);
check(
  "bare star re-export",
  JSON.stringify(parseClauseNames("*")) ===
    JSON.stringify([{ imported: "*", local: "*", typeOnly: false }]),
);

// --- scanning ---
const source = [
  `import { Effect } from "effect"`,
  `import {`,
  `  Schema,`,
  `  type Types,`,
  `} from "effect/Schema"`,
  `import * as NS from "effect/Stream"`,
  `import "effect/polyfill"`,
  `const dep = require("@effect/cli/Args")`,
  `const worker = await import("@effect/platform/Worker")`,
  `export { Effect as E } from "effect"`,
  `export * from "effect/Stdin"`,
  `import { debounce } from "lodash-es"`,
  `import { helper } from "effectful"`,
  `// import { commented } from "effect"`,
].join("\n");

const rows = scanEffectImports(source);
check("only effect imports kept", rows.length === 8, rows);
check(
  "modules found",
  JSON.stringify(rows.map((row) => row.module)) ===
    JSON.stringify([
      "effect",
      "effect/Schema",
      "effect/Stream",
      "effect/polyfill",
      "@effect/cli/Args",
      "@effect/platform/Worker",
      "effect",
      "effect/Stdin",
    ]),
  rows.map((row) => row.module),
);
check(
  "kinds",
  rows[0]?.kind === "import" &&
    rows[4]?.kind === "require" &&
    rows[5]?.kind === "dynamic-import" &&
    rows[6]?.kind === "export-from" &&
    rows[3]?.kind === "import",
  rows.map((r) => r.kind),
);
check(
  "lines are 1-based and ordered",
  JSON.stringify(rows.map((row) => row.line)) === JSON.stringify([1, 2, 6, 7, 8, 9, 10, 11]),
  rows.map((row) => row.line),
);
check(
  "multiline clause names",
  JSON.stringify(rows[1]?.names) ===
    JSON.stringify([
      { imported: "Schema", local: "Schema", typeOnly: false },
      { imported: "Types", local: "Types", typeOnly: true },
    ]),
  rows[1]?.names,
);
check(
  "comment ignored",
  rows.every((row) => row.names.every((name) => name.imported !== "commented")),
);
check(
  "re-export alias",
  JSON.stringify(rows[6]?.names) ===
    JSON.stringify([{ imported: "Effect", local: "E", typeOnly: false }]),
  rows[6]?.names,
);
check(
  "namespace import",
  JSON.stringify(rows[2]?.names) ===
    JSON.stringify([{ imported: "*", local: "NS", typeOnly: false }]),
  rows[2]?.names,
);
check("require has no names", rows[4]?.names.length === 0);
check(
  "statement-like text in strings is not a statement",
  scanEffectImports(`const s = "import { x } from 'effect'"\nconst y = 1`).length === 0,
);
check("empty file", scanEffectImports("").length === 0);

// --- role classification ---
check("plain source file", classifyRole("src/index.ts") === "source");
check("test suffix", classifyRole("src/index.test.ts") === "test");
check("spec suffix tsx", classifyRole("src/App.spec.tsx") === "test");
check("test-d declarations", classifyRole("types/api.test-d.ts") === "test");
check("__tests__ dir", classifyRole("src/__tests__/index.ts") === "test");
check("test dir", classifyRole("packages/app/test/helpers.ts") === "test");
check("e2e dir", classifyRole("e2e/login.ts") === "test");
check("testing dir is source", classifyRole("src/testing/utils.ts") === "source");
check("test-utils file is source", classifyRole("src/test-utils.ts") === "source");

if (failures > 0) {
  console.error(`\n${failures} FAILURES`);
  process.exitCode = 1;
} else {
  console.log("\nAll import scanner assertions passed");
}
