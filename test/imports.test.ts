import { describe, expect, it } from "@effect/vitest";
import {
  effectPackageName,
  isEffectModule,
  parseClauseNames,
  scanEffectImports,
} from "../src/deep-analysis/imports.ts";

// The text scanner is the fallback for files oxc cannot parse (and for files
// above the parse size limit), so it keeps its own coverage.

describe("module matching", () => {
  it("matches effect and @effect/* only", () => {
    expect(["effect", "effect/Schema", "@effect/cli/Args"].map(isEffectModule)).toEqual([
      true,
      true,
      true,
    ]);
    expect(["effectful", "my-effect", "@effectful/x"].map(isEffectModule)).toEqual([
      false,
      false,
      false,
    ]);
    expect(effectPackageName("effect/Schema")).toBe("effect");
    expect(effectPackageName("@effect/cli/Args")).toBe("@effect/cli");
  });
});

describe("parseClauseNames", () => {
  it("parses named, aliased, type, default, namespace and star clauses", () => {
    expect(parseClauseNames("{ Effect, pipe }")).toEqual([
      { imported: "Effect", local: "Effect", typeOnly: false },
      { imported: "pipe", local: "pipe", typeOnly: false },
    ]);
    expect(parseClauseNames("{ Effect as E, type Types }")).toEqual([
      { imported: "Effect", local: "E", typeOnly: false },
      { imported: "Types", local: "Types", typeOnly: true },
    ]);
    expect(parseClauseNames("type { Effect }").every((name) => name.typeOnly)).toBe(true);
    expect(parseClauseNames("Eff, * as NS")).toEqual([
      { imported: "default", local: "Eff", typeOnly: false },
      { imported: "*", local: "NS", typeOnly: false },
    ]);
    expect(parseClauseNames("*")).toEqual([{ imported: "*", local: "*", typeOnly: false }]);
  });
});

describe("scanEffectImports", () => {
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

  it("keeps effect statements only, with kinds and 1-based lines", () => {
    expect(rows.map((row) => [row.module, row.kind, row.line])).toEqual([
      ["effect", "import", 1],
      ["effect/Schema", "import", 2],
      ["effect/Stream", "import", 6],
      ["effect/polyfill", "import", 7],
      ["@effect/cli/Args", "require", 8],
      ["@effect/platform/Worker", "dynamic-import", 9],
      ["effect", "export-from", 10],
      ["effect/Stdin", "export-from", 11],
    ]);
  });

  it("reads multiline, namespace and re-export clauses", () => {
    expect(rows[1]?.names).toEqual([
      { imported: "Schema", local: "Schema", typeOnly: false },
      { imported: "Types", local: "Types", typeOnly: true },
    ]);
    expect(rows[2]?.names).toEqual([{ imported: "*", local: "NS", typeOnly: false }]);
    expect(rows[6]?.names).toEqual([{ imported: "Effect", local: "E", typeOnly: false }]);
    expect(rows[4]?.names).toEqual([]);
  });

  it("ignores statement-like text in strings, and empty files", () => {
    expect(scanEffectImports(`const s = "import { x } from 'effect'"\nconst y = 1`)).toEqual([]);
    expect(scanEffectImports("")).toEqual([]);
  });
});
