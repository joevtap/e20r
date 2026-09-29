import { describe, expect, it } from "@effect/vitest";
import { analyzeFile, bindingsFrom } from "../src/deep-analysis/usage.ts";

const symbolsOf = (text: string, extension: "ts" | "tsx" = "ts") =>
  Object.fromEntries(
    analyzeFile(`file.${extension}`, text, extension).symbols.map((s) => [
      `${s.kind} ${s.symbol}`,
      s.count,
    ]),
  );

describe("analyzeFile imports", () => {
  it("reads every import form", () => {
    const result = analyzeFile(
      "a.ts",
      [
        `import { Effect as E, type Layer } from "effect";`,
        `import * as S from "effect/Schema";`,
        `import type Def from "@effect/platform";`,
        `import "effect/side";`,
        `export { pipe as p } from "effect/Function";`,
        `export * from "effect/Stream";`,
        `export type * as T from "effect/Types";`,
        `const r = require("@effect/cli");`,
        `const d = import("effect/Data");`,
        `import X = require("effect/Option");`,
        `type M = import("effect").Layer.MemoMap;`,
        `import { Other } from "effectful";`,
      ].join("\n"),
      "ts",
    );
    expect(result.parser).toBe("oxc");
    expect(result.imports).toEqual([
      {
        module: "effect",
        package: "effect",
        kind: "import",
        line: 1,
        names: [
          { imported: "Effect", local: "E", typeOnly: false },
          { imported: "Layer", local: "Layer", typeOnly: true },
        ],
      },
      {
        module: "effect/Schema",
        package: "effect",
        kind: "import",
        line: 2,
        names: [{ imported: "*", local: "S", typeOnly: false }],
      },
      {
        module: "@effect/platform",
        package: "@effect/platform",
        kind: "import",
        line: 3,
        names: [{ imported: "default", local: "Def", typeOnly: true }],
      },
      { module: "effect/side", package: "effect", kind: "import", line: 4, names: [] },
      {
        module: "effect/Function",
        package: "effect",
        kind: "export-from",
        line: 5,
        names: [{ imported: "pipe", local: "p", typeOnly: false }],
      },
      {
        module: "effect/Stream",
        package: "effect",
        kind: "export-from",
        line: 6,
        names: [{ imported: "*", local: "*", typeOnly: false }],
      },
      {
        module: "effect/Types",
        package: "effect",
        kind: "export-from",
        line: 7,
        names: [{ imported: "*", local: "T", typeOnly: true }],
      },
      { module: "@effect/cli", package: "@effect/cli", kind: "require", line: 8, names: [] },
      { module: "effect/Data", package: "effect", kind: "dynamic-import", line: 9, names: [] },
      {
        module: "effect/Option",
        package: "effect",
        kind: "require",
        line: 10,
        names: [{ imported: "*", local: "X", typeOnly: false }],
      },
      {
        module: "effect",
        package: "effect",
        kind: "type-import",
        line: 11,
        names: [{ imported: "Layer.MemoMap", local: "Layer.MemoMap", typeOnly: true }],
      },
    ]);
  });

  it("reports lines after non-ASCII text", () => {
    const result = analyzeFile(
      "a.ts",
      `// ☃ ünïcødé\nconst s = "✓✓✓";\nimport { Effect } from "effect";`,
      "ts",
    );
    expect(result.imports[0]?.line).toBe(3);
  });

  it("falls back to the text scanner on fatal syntax errors", () => {
    const result = analyzeFile("a.ts", `import { Effect } from "effect";\nconst = = = ;`, "ts");
    expect(result.parser).toBe("text-fallback");
    expect(result.imports.map((row) => row.module)).toEqual(["effect"]);
    expect(result.symbols).toEqual([]);
  });
});

describe("analyzeFile symbols", () => {
  it("normalizes aliases and counts chains once, at their longest", () => {
    expect(
      symbolsOf(`import { Effect as E, pipe } from "effect";
E.gen(function* () {});
E.gen(function* () {});
const run = E.runPromise;
pipe(1, E.map((x) => x));
E.Service.Tag.make();
`),
    ).toEqual({
      "call Effect.gen": 2,
      "property-access Effect.runPromise": 1,
      "call pipe": 1,
      "call Effect.map": 1,
      "call Effect.Service.Tag.make": 1,
    });
  });

  it("counts type positions once (bare, qualified, typeof, generic arguments)", () => {
    expect(
      symbolsOf(`import { Effect, Layer } from "effect";
let a: Effect;
let b: Effect.Effect<Layer.Layer<never>>;
type C = typeof Effect.gen;
`),
    ).toEqual({
      "type-reference Effect": 1,
      "type-reference Effect.Effect": 1,
      "type-reference Layer.Layer": 1,
      "type-reference Effect.gen": 1,
    });
  });

  it("does not count declarations, bindings, keys or import clauses", () => {
    expect(
      symbolsOf(`import { Effect } from "effect";
const { Effect: x } = other;
function f(Effect: number, [Effect2 = Effect.void]: any[]) {}
class K { Effect = 1; Effect() {} }
const o = { Effect: 1, [Effect.key]: 2 };
interface I { Effect: string }
export { Effect };
label: for (;;) { break label; }
`),
    ).toEqual({
      "property-access Effect.void": 1,
      "property-access Effect.key": 1,
    });
  });

  it("counts shorthand values, bare identifiers and non-chain roots", () => {
    expect(
      symbolsOf(`import { Effect, Layer } from "effect";
const o = { Effect };
yield* Effect;
Layer.merge(a, b).pipe(Effect.provide(x));
Effect[key];
new Layer.Thing();
`),
    ).toEqual({
      "identifier Effect": 3,
      "call Layer.merge": 1,
      "call Effect.provide": 1,
      "property-access Layer.Thing": 1,
    });
  });

  it("walks type annotations of bindings and parameter properties", () => {
    expect(
      symbolsOf(`import { Effect } from "effect";
const x: Effect.Effect<number> = y;
class A { constructor(private readonly svc: Effect.Service) {} }
const f = ({ a }: Effect.Opts) => a;
`),
    ).toEqual({
      "type-reference Effect.Effect": 1,
      "type-reference Effect.Service": 1,
      "type-reference Effect.Opts": 1,
    });
  });

  it("parses TSX", () => {
    expect(
      symbolsOf(
        `import { Effect } from "effect";
export const C = () => <div onClick={() => Effect.runFork(x)}>{Effect.void}</div>;
`,
        "tsx",
      ),
    ).toEqual({ "call Effect.runFork": 1, "property-access Effect.void": 1 });
  });

  it("ignores usages without an effect import", () => {
    expect(symbolsOf(`Effect.gen(); const x: Effect.Effect = 1;`)).toEqual({});
  });
});

describe("bindingsFrom", () => {
  it("binds named, default and namespace imports, never re-exports", () => {
    const bindings = bindingsFrom([
      {
        module: "effect",
        package: "effect",
        kind: "import",
        line: 1,
        names: [
          { imported: "Effect", local: "E", typeOnly: false },
          { imported: "default", local: "D", typeOnly: false },
          { imported: "*", local: "NS", typeOnly: false },
        ],
      },
      {
        module: "effect",
        package: "effect",
        kind: "export-from",
        line: 2,
        names: [{ imported: "pipe", local: "pipe", typeOnly: false }],
      },
    ]);
    expect([...bindings]).toEqual([
      ["E", "Effect"],
      ["D", "D"],
      ["NS", "NS"],
    ]);
  });
});
