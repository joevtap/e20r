import { parseSync, rawTransferSupported, visitorKeys, type ParserOptions } from "oxc-parser";
import type {
  EffectImport,
  FileUsage,
  ImportName,
  Parser,
  SourceExtension,
  SymbolKind,
  SymbolUsage,
} from "../domain/usage.ts";
import { effectPackageName, isEffectModule, scanEffectImports } from "./imports.ts";
import { makeLineIndex } from "./lines.ts";

/**
 * Effect usage of one file, read from the oxc AST (ESTree + TS-ESTree) in a
 * single tree walk: the imports (static, side-effect, re-export, `require`,
 * `import x = require()`, dynamic and type imports) plus the symbol usages
 * counted through them. oxc is a parse-only parser: no program, no project,
 * no type information — exactly what a syntactic count needs, at a fraction
 * of the cost of a language server.
 *
 * A "symbol" is the name of an Effect import plus the property path it is
 * used through: `Effect.gen(...)`, `Schema.Struct`, `Match.value`, `pipe`.
 * Aliases are normalized through the file's imports, so `Effect as E;
 * E.gen()` counts as `Effect.gen`. Where an import has no name of its own
 * (default and namespace imports) the local binding is the base name.
 *
 * Usages are counted syntactically, per kind:
 *
 * - `call` — the symbol is called: `Effect.gen(...)`, `pipe(x)`;
 * - `property-access` — the symbol is passed around: `Effect.runPromise`;
 * - `identifier` — a bare binding: `yield* Effect` (as a value);
 * - `type-reference` — a type position: `Effect.Effect<…>`, `: Effect`,
 *   `typeof Effect.gen`.
 *
 * Declarations, binding patterns, import/export clauses, object keys and the
 * inner names of dotted chains are not usages and are not counted (a chain
 * counts once, at its longest). Shadowing is not tracked: a local that reuses
 * an imported name still counts, which is rare enough to accept for a
 * syntactic scan.
 */

/** Local binding name -> normalized symbol base. */
export type EffectBindings = ReadonlyMap<string, string>;

/**
 * The normalized bases of a file's Effect imports: `import { Effect as E }`
 * binds "E" to "Effect", `import * as NS` binds "NS" to "NS". Re-exports
 * create no local binding and are skipped, and `require`/dynamic-import
 * bindings are not destructured here.
 */
export const bindingsFrom = (rows: ReadonlyArray<EffectImport>): EffectBindings => {
  const bindings = new Map<string, string>();
  for (const row of rows) {
    if (row.kind !== "import") continue;
    for (const name of row.names) {
      const base =
        name.imported === "default" || name.imported === "*" ? name.local : name.imported;
      bindings.set(name.local, base);
    }
  }
  return bindings;
};

// The walker is deliberately untyped: it dispatches on `type` strings over
// the whole ESTree node zoo, which the generated union types cannot narrow
// cheaply. Every access is guarded.
type AnyNode = any;

const isNode = (value: unknown): value is AnyNode =>
  typeof value === "object" && value !== null && typeof (value as AnyNode).type === "string";

const stringLiteral = (node: AnyNode): string | undefined =>
  isNode(node) && node.type === "Literal" && typeof node.value === "string"
    ? node.value
    : undefined;

/** `Identifier` / `Literal` module export names: `{ "a-b" as c }`. */
const exportName = (node: AnyNode): string =>
  node.type === "Identifier" ? node.name : String(node.value);

/** A type-name chain (`Effect.Effect`, `import("x").A.B` qualifiers), root first. */
const typeNamePath = (node: AnyNode): ReadonlyArray<string> => {
  if (!isNode(node)) return [];
  if (node.type === "Identifier") return [node.name];
  if (node.type === "TSQualifiedName") {
    const left = typeNamePath(node.left);
    return left.length === 0 ? [] : [...left, node.right.name];
  }
  return [];
};

/**
 * The dotted name of a non-computed member chain, root first, or [] when
 * its root is not a plain identifier (`f(x).a.b`, `this.a`).
 */
const memberPath = (node: AnyNode): ReadonlyArray<string> => {
  const names: Array<string> = [];
  let current: AnyNode = node;
  while (current.type === "MemberExpression" && !current.computed) {
    const property = current.property;
    names.unshift(property.type === "PrivateIdentifier" ? `#${property.name}` : property.name);
    current = current.object;
  }
  if (current.type !== "Identifier") return [];
  names.unshift(current.name);
  return names;
};

/** Keys whose value is a declared name, never a usage (when not computed). */
const nameKeys: Readonly<Record<string, ReadonlyArray<string>>> = {
  FunctionDeclaration: ["id"],
  FunctionExpression: ["id"],
  TSDeclareFunction: ["id"],
  TSEmptyBodyFunctionExpression: ["id"],
  ClassDeclaration: ["id"],
  ClassExpression: ["id"],
  TSInterfaceDeclaration: ["id"],
  TSTypeAliasDeclaration: ["id"],
  TSEnumDeclaration: ["id"],
  TSEnumMember: ["id"],
  TSModuleDeclaration: ["id"],
  TSImportEqualsDeclaration: ["id"],
  TSNamespaceExportDeclaration: ["id"],
  TSTypeParameter: ["name"],
  TSMappedType: ["key"],
  TSTypePredicate: ["parameterName"],
  LabeledStatement: ["label"],
  BreakStatement: ["label"],
  ContinueStatement: ["label"],
  MetaProperty: ["meta", "property"],
  ExportAllDeclaration: ["exported"],
};

/** Keys that name a member only when not `computed`. */
const memberKeyTypes = new Set([
  "Property",
  "MethodDefinition",
  "PropertyDefinition",
  "AccessorProperty",
  "TSAbstractMethodDefinition",
  "TSAbstractPropertyDefinition",
  "TSAbstractAccessorProperty",
  "TSPropertySignature",
  "TSMethodSignature",
]);

/** Keys whose subtree is a binding pattern (parameters, declarators). */
const bindingKeys: Readonly<Record<string, ReadonlyArray<string>>> = {
  VariableDeclarator: ["id"],
  FunctionDeclaration: ["params"],
  FunctionExpression: ["params"],
  ArrowFunctionExpression: ["params"],
  TSDeclareFunction: ["params"],
  TSEmptyBodyFunctionExpression: ["params"],
  CatchClause: ["param"],
  TSMethodSignature: ["params"],
  TSCallSignatureDeclaration: ["params"],
  TSConstructSignatureDeclaration: ["params"],
  TSFunctionType: ["params"],
  TSConstructorType: ["params"],
  TSIndexSignature: ["parameters"],
  TSParameterProperty: ["parameter"],
};

/** Nodes whose whole subtree carries no usage (import/export clauses). */
const skippedTypes = new Set([
  "ImportSpecifier",
  "ImportDefaultSpecifier",
  "ImportNamespaceSpecifier",
  "ExportSpecifier",
  "ImportAttribute",
]);

interface Collected {
  readonly imports: Array<EffectImport>;
  readonly usages: Array<{ readonly path: ReadonlyArray<string>; readonly kind: SymbolKind }>;
}

const importNames = (declaration: AnyNode): ReadonlyArray<ImportName> => {
  const declarationTypeOnly = declaration.importKind === "type";
  const names: Array<ImportName> = [];
  for (const specifier of declaration.specifiers ?? []) {
    if (specifier.type === "ImportDefaultSpecifier") {
      names.push({
        imported: "default",
        local: specifier.local.name,
        typeOnly: declarationTypeOnly,
      });
    } else if (specifier.type === "ImportNamespaceSpecifier") {
      names.push({ imported: "*", local: specifier.local.name, typeOnly: declarationTypeOnly });
    } else {
      names.push({
        imported: exportName(specifier.imported),
        local: specifier.local.name,
        typeOnly: declarationTypeOnly || specifier.importKind === "type",
      });
    }
  }
  return names;
};

const reExportNames = (declaration: AnyNode): ReadonlyArray<ImportName> => {
  const declarationTypeOnly = declaration.exportKind === "type";
  if (declaration.type === "ExportAllDeclaration") {
    const local = declaration.exported === null ? "*" : exportName(declaration.exported);
    return [{ imported: "*", local, typeOnly: declarationTypeOnly }];
  }
  return (declaration.specifiers ?? []).map((specifier: AnyNode): ImportName => ({
    imported: exportName(specifier.local),
    local: exportName(specifier.exported),
    typeOnly: declarationTypeOnly || specifier.exportKind === "type",
  }));
};

const walk = (program: AnyNode, lineOf: (offset: number) => number): Collected => {
  const collected: Collected = { imports: [], usages: [] };

  const pushImport = (
    node: AnyNode,
    module: string,
    kind: EffectImport["kind"],
    names: ReadonlyArray<ImportName>,
  ): void => {
    collected.imports.push({
      module,
      package: effectPackageName(module),
      kind,
      line: lineOf(node.start),
      names,
    });
  };

  const visitChildren = (node: AnyNode, binding: boolean): void => {
    const keys = visitorKeys[node.type];
    if (keys === undefined) return;
    const names = nameKeys[node.type];
    const bindings = bindingKeys[node.type];
    const memberKey = memberKeyTypes.has(node.type) && !node.computed;
    for (const key of keys) {
      if (names?.includes(key)) continue;
      if (memberKey && key === "key") continue;
      // In a binding pattern, only the value side of `{ key: value }` binds.
      const childBinding =
        bindings?.includes(key) === true ||
        (binding && node.type === "Property" && key === "value");
      const child = node[key];
      if (Array.isArray(child)) {
        for (const item of child) if (isNode(item)) visit(item, node, key, childBinding);
      } else if (isNode(child)) {
        visit(child, node, key, childBinding);
      }
    }
  };

  const visit = (node: AnyNode, parent: AnyNode, key: string, binding: boolean): void => {
    if (skippedTypes.has(node.type)) return;

    switch (node.type) {
      // ---- imports ----
      case "ImportDeclaration": {
        const module = stringLiteral(node.source);
        if (module !== undefined && isEffectModule(module)) {
          pushImport(node, module, "import", importNames(node));
        }
        return;
      }
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration": {
        const module = stringLiteral(node.source);
        if (module !== undefined) {
          if (isEffectModule(module)) pushImport(node, module, "export-from", reExportNames(node));
          return;
        }
        // `export const x = …` / `export { local }`: only the declaration
        // carries usages (the specifiers are skipped as export clauses).
        if (isNode(node.declaration)) visit(node.declaration, node, "declaration", false);
        return;
      }
      case "TSImportEqualsDeclaration": {
        // `import E = require("effect")`
        const reference = node.moduleReference;
        const module =
          reference?.type === "TSExternalModuleReference"
            ? stringLiteral(reference.expression)
            : undefined;
        if (module !== undefined && isEffectModule(module)) {
          pushImport(node, module, "require", [
            { imported: "*", local: node.id.name, typeOnly: node.importKind === "type" },
          ]);
          return;
        }
        break;
      }
      case "ImportExpression": {
        const module = stringLiteral(node.source);
        if (module !== undefined && isEffectModule(module)) {
          pushImport(node, module, "dynamic-import", []);
        }
        break;
      }
      case "CallExpression": {
        const callee = node.callee;
        if (callee.type === "Identifier" && callee.name === "require") {
          const module = stringLiteral(node.arguments[0]);
          if (module !== undefined && isEffectModule(module)) {
            pushImport(node, module, "require", []);
          }
        }
        break;
      }
      case "TSImportType": {
        // `import("effect").Layer.MemoMap` — a type-only module import. Its
        // qualifier is the used name path (`Layer.MemoMap`).
        const module = stringLiteral(node.source);
        if (module !== undefined && isEffectModule(module)) {
          const used = typeNamePath(node.qualifier).join(".");
          pushImport(
            node,
            module,
            "type-import",
            used === "" ? [] : [{ imported: used, local: used, typeOnly: true }],
          );
        }
        if (isNode(node.typeArguments)) visit(node.typeArguments, node, "typeArguments", false);
        return;
      }

      // ---- symbol usages ----
      case "TSTypeReference": {
        // `Effect.Effect<…>`: the name is a TSQualifiedName chain, counted
        // once here; only the type arguments carry further usages.
        const path = typeNamePath(node.typeName);
        if (path.length > 0) collected.usages.push({ path, kind: "type-reference" });
        if (isNode(node.typeArguments)) visit(node.typeArguments, node, "typeArguments", false);
        return;
      }
      case "TSTypeQuery": {
        // `typeof Effect.gen` / `typeof Effect`: a type position too.
        const path = typeNamePath(node.exprName);
        if (path.length > 0) {
          collected.usages.push({ path, kind: "type-reference" });
        } else if (isNode(node.exprName)) {
          visit(node.exprName, node, "exprName", false);
        }
        if (isNode(node.typeArguments)) visit(node.typeArguments, node, "typeArguments", false);
        return;
      }
      case "TSQualifiedName": {
        // Outside type references (handled above): `import X = Effect.Foo`.
        const path = typeNamePath(node);
        if (path.length > 0) collected.usages.push({ path, kind: "property-access" });
        return;
      }
      case "MemberExpression": {
        if (!node.computed) {
          // Counted once, at the longest chain; the object only carries
          // usages when the chain is not a plain name (`f(x).a.b`).
          const path = memberPath(node);
          if (path.length > 0) {
            const callee = parent?.type === "CallExpression" && key === "callee";
            collected.usages.push({ path, kind: callee ? "call" : "property-access" });
          } else {
            visit(node.object, node, "object", false);
          }
          return;
        }
        break;
      }
      case "Identifier": {
        if (binding) {
          // A declared name; its type annotation is still a type position.
          if (isNode(node.typeAnnotation))
            visit(node.typeAnnotation, node, "typeAnnotation", false);
          return;
        }
        const callee = parent?.type === "CallExpression" && key === "callee";
        collected.usages.push({ path: [node.name], kind: callee ? "call" : "identifier" });
        return;
      }
      case "AssignmentPattern": {
        if (binding) {
          // `(x = Effect.void) =>`: the default value is an expression.
          visit(node.left, node, "left", true);
          visit(node.right, node, "right", false);
          if (isNode(node.typeAnnotation))
            visit(node.typeAnnotation, node, "typeAnnotation", false);
          return;
        }
        break;
      }
      case "ObjectPattern":
      case "ArrayPattern":
      case "RestElement": {
        if (binding) {
          for (const childKey of visitorKeys[node.type] ?? []) {
            const child = node[childKey];
            // Everything but type annotations and decorators binds.
            const childBinding = childKey !== "typeAnnotation" && childKey !== "decorators";
            if (Array.isArray(child)) {
              for (const item of child) if (isNode(item)) visit(item, node, childKey, childBinding);
            } else if (isNode(child)) {
              visit(child, node, childKey, childBinding);
            }
          }
          return;
        }
        break;
      }
    }

    visitChildren(node, binding && node.type === "Property");
  };

  for (const statement of program.body ?? []) visit(statement, program, "body", false);
  return collected;
};

const langOf = (extension: SourceExtension): "ts" | "tsx" => (extension === "tsx" ? "tsx" : "ts");

/**
 * Raw transfer hands the AST to JS through a shared buffer instead of a JSON
 * string, which makes parsing ~5x faster; the option is experimental (and
 * untyped), so it is only used where the platform supports it.
 */
const rawTransfer = rawTransferSupported();

const parserOptions = (extension: SourceExtension): ParserOptions =>
  ({
    lang: langOf(extension),
    sourceType: "module",
    ...(rawTransfer ? { experimentalRawTransfer: true } : {}),
  }) as ParserOptions;

/** Resolves the collected paths through the imports and counts them. */
const countSymbols = (collected: Collected): ReadonlyArray<SymbolUsage> => {
  const bindings = bindingsFrom(collected.imports);
  if (bindings.size === 0) return [];
  const counts = new Map<string, { symbol: string; kind: SymbolKind; count: number }>();
  for (const usage of collected.usages) {
    const first = usage.path[0];
    if (first === undefined) continue;
    const base = bindings.get(first);
    if (base === undefined) continue;
    const symbol = usage.path.length === 1 ? base : [base, ...usage.path.slice(1)].join(".");
    const key = `${usage.kind} ${symbol}`;
    const current = counts.get(key);
    if (current === undefined) counts.set(key, { symbol, kind: usage.kind, count: 1 });
    else current.count++;
  }
  return [...counts.values()].sort(
    (left, right) =>
      right.count - left.count ||
      left.symbol.localeCompare(right.symbol) ||
      left.kind.localeCompare(right.kind),
  );
};

export interface AnalyzedFile extends FileUsage {
  readonly parser: Parser;
}

/**
 * The Effect imports and symbol usages of one source file. Never throws: a
 * file oxc cannot parse (or that crashes the parser) falls back to the text
 * scanner — imports only, no symbols — and says so through `parser`.
 */
export const analyzeFile = (
  file: string,
  text: string,
  extension: SourceExtension,
): AnalyzedFile => {
  const fallback = (): AnalyzedFile => ({
    parser: "text-fallback",
    imports: scanEffectImports(text),
    symbols: [],
  });

  try {
    const result = parseSync(file, text, parserOptions(extension));
    const program = result.program;
    // oxc does not recover from fatal syntax errors: the program comes back
    // empty. Non-fatal errors (early errors on otherwise valid syntax) still
    // leave a usable tree.
    if (result.errors.length > 0 && program.body.length === 0 && text.trim() !== "") {
      return fallback();
    }
    const collected = walk(program, makeLineIndex(text));
    return {
      parser: "oxc",
      imports: collected.imports.sort((left, right) => left.line - right.line),
      symbols: countSymbols(collected),
    };
  } catch {
    return fallback();
  }
};
