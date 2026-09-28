import type {
  CallExpression,
  ExportDeclaration,
  ExportSpecifier,
  Identifier,
  ImportClause,
  ImportDeclaration,
  ImportSpecifier,
  ImportTypeNode,
  LiteralTypeNode,
  ModuleExportName,
  NamedExports,
  NamedImports,
  NamespaceExport,
  NamespaceImport,
  Node,
  PropertyAccessExpression,
  QualifiedName,
  SourceFile,
  StringLiteral,
  TypeReferenceNode,
} from "typescript/unstable/ast";
import { SyntaxKind } from "typescript/unstable/ast";
import type { EffectImport } from "../domain/analysis-state.ts";
import { effectPackageName, isEffectModule } from "./imports.ts";

/**
 * Effect usage of one file, read from the TypeScript AST in a single tree
 * walk: the imports (static, side-effect, re-export, `require`, dynamic and
 * type imports) plus the symbol usages counted through them. Exact where the
 * text-level scanner of `imports.ts` is heuristic; the same row shapes, so
 * signals and fallbacks can mix both sources freely.
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
 * - `type-reference` — a type position: `Effect.Effect<…>`, `: Effect`.
 *
 * Declarations, import clauses and the inner names of dotted chains are not
 * usages and are not counted (a chain counts once, at its longest).
 */

export type EffectImportRow = EffectImport;

export type SymbolKind = "call" | "property-access" | "identifier" | "type-reference";

export interface SymbolUsage {
  readonly symbol: string;
  readonly kind: SymbolKind;
  readonly count: number;
}

/** Local binding name -> normalized symbol base. */
export type EffectBindings = ReadonlyMap<string, string>;

export interface FileUsage {
  readonly imports: ReadonlyArray<EffectImportRow>;
  readonly symbols: ReadonlyArray<SymbolUsage>;
}

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

const moduleSpecifierOf = (node: Node | undefined): string | undefined =>
  node !== undefined && node.kind === SyntaxKind.StringLiteral
    ? (node as StringLiteral).text
    : undefined;

const nameText = (name: ModuleExportName): string => name.text;

const lineOf = (source: SourceFile, node: Node): number =>
  source.getLineAndCharacterOfPosition(node.getStart()).line + 1;

const importNames = (clause: ImportClause | undefined): EffectImport["names"] => {
  if (clause === undefined) return []; // side-effect `import "effect"`
  const clauseTypeOnly = clause.phaseModifier === SyntaxKind.TypeKeyword;
  const names: Array<EffectImport["names"][number]> = [];

  if (clause.name !== undefined) {
    names.push({ imported: "default", local: clause.name.text, typeOnly: clauseTypeOnly });
  }

  const bindings = clause.namedBindings;
  if (bindings !== undefined) {
    if (bindings.kind === SyntaxKind.NamespaceImport) {
      names.push({
        imported: "*",
        local: (bindings as NamespaceImport).name.text,
        typeOnly: clauseTypeOnly,
      });
    } else {
      for (const specifier of (bindings as NamedImports).elements) {
        const spec = specifier as ImportSpecifier;
        names.push({
          imported: spec.propertyName === undefined ? spec.name.text : nameText(spec.propertyName),
          local: spec.name.text,
          typeOnly: clauseTypeOnly || spec.isTypeOnly,
        });
      }
    }
  }

  return names;
};

const exportNames = (declaration: ExportDeclaration): EffectImport["names"] => {
  const clause = declaration.exportClause;
  if (clause === undefined) return [{ imported: "*", local: "*", typeOnly: false }]; // `export * from`

  if (clause.kind === SyntaxKind.NamespaceExport) {
    return [
      {
        imported: "*",
        local: nameText((clause as NamespaceExport).name),
        typeOnly: declaration.isTypeOnly,
      },
    ];
  }

  return (clause as NamedExports).elements.map((specifier) => {
    const spec = specifier as ExportSpecifier;
    return {
      imported: spec.propertyName === undefined ? spec.name.text : nameText(spec.propertyName),
      local: spec.name.text,
      typeOnly: declaration.isTypeOnly || spec.isTypeOnly,
    };
  });
};

const effectRow = (
  source: SourceFile,
  node: Node,
  module: string,
  kind: EffectImport["kind"],
  names: EffectImport["names"],
): EffectImportRow =>
  ({
    module,
    package: effectPackageName(module),
    kind,
    line: lineOf(source, node),
    names,
  }) satisfies EffectImportRow;

const entityPath = (node: Node): ReadonlyArray<string> => {
  if (node.kind === SyntaxKind.Identifier) return [(node as Identifier).text];
  if (node.kind === SyntaxKind.QualifiedName) {
    const qualified = node as QualifiedName;
    return [...entityPath(qualified.left), qualified.right.text];
  }
  return [];
};

/** The dotted name of a property access, root first, or [] when not a name chain. */
const propertyPath = (node: PropertyAccessExpression): ReadonlyArray<string> => {
  const names: Array<string> = [];
  let current: Node = node;
  while (current.kind === SyntaxKind.PropertyAccessExpression) {
    const access = current as PropertyAccessExpression;
    names.unshift(access.name.text);
    current = access.expression;
  }
  if (current.kind !== SyntaxKind.Identifier) return [];
  names.unshift((current as Identifier).text);
  return names;
};

const isCallee = (node: Node): boolean => {
  const parent = node.parent;
  return (
    parent.kind === SyntaxKind.CallExpression && (parent as CallExpression).expression === node
  );
};

/**
 * The Effect imports and symbol usages of one parsed file, from a single
 * tree walk (usage paths are collected syntactically and resolved through
 * the imports afterwards, so imports can appear anywhere in the file).
 */
export const collectUsage = (source: SourceFile): FileUsage => {
  const importRows: Array<EffectImportRow> = [];
  const usages: Array<{ path: ReadonlyArray<string>; kind: SymbolKind }> = [];

  const visit = (node: Node): void => {
    // ---- imports ----
    if (node.kind === SyntaxKind.ImportDeclaration) {
      const declaration = node as ImportDeclaration;
      const module = moduleSpecifierOf(declaration.moduleSpecifier);
      if (module !== undefined && isEffectModule(module)) {
        importRows.push(
          effectRow(source, node, module, "import", importNames(declaration.importClause)),
        );
      }
    } else if (node.kind === SyntaxKind.ExportDeclaration) {
      const declaration = node as ExportDeclaration;
      const module = moduleSpecifierOf(declaration.moduleSpecifier);
      if (module !== undefined && isEffectModule(module)) {
        importRows.push(effectRow(source, node, module, "export-from", exportNames(declaration)));
      }
    } else if (node.kind === SyntaxKind.ImportType) {
      // `import("effect").Layer.MemoMap` — a type-only module import. Its
      // qualifier is the used name path (`Layer.MemoMap`).
      const importType = node as ImportTypeNode;
      const module = moduleSpecifierOf((importType.argument as LiteralTypeNode).literal);
      if (module !== undefined && isEffectModule(module)) {
        const qualifier = importType.qualifier;
        const used = qualifier === undefined ? undefined : qualifier.getText();
        importRows.push(
          effectRow(
            source,
            node,
            module,
            "type-import",
            used === undefined ? [] : [{ imported: used, local: used, typeOnly: true }],
          ),
        );
      }
    } else if (node.kind === SyntaxKind.CallExpression) {
      const call = node as CallExpression;
      const module = moduleSpecifierOf(call.arguments[0]);
      if (module !== undefined && isEffectModule(module)) {
        const target = call.expression;
        const kind: EffectImport["kind"] | undefined =
          target.kind === SyntaxKind.ImportKeyword
            ? "dynamic-import"
            : target.kind === SyntaxKind.Identifier && (target as Identifier).text === "require"
              ? "require"
              : undefined;
        if (kind !== undefined) {
          importRows.push(effectRow(source, node, module, kind, []));
        }
      }
    }

    // ---- symbol usages ----
    if (node.kind === SyntaxKind.TypeReference) {
      // The name of a type reference: `Effect.Effect<…>` is an EntityName
      // chain here (a QualifiedName), not a property access.
      const path = entityPath((node as TypeReferenceNode).typeName);
      if (path.length > 0) usages.push({ path, kind: "type-reference" });
    } else if (node.kind === SyntaxKind.PropertyAccessExpression) {
      // Counted once, at the longest chain; the children only carry usages
      // when the chain is not a plain name (`f(x).a.b`).
      const path = propertyPath(node as PropertyAccessExpression);
      if (path.length > 0) {
        usages.push({ path, kind: isCallee(node) ? "call" : "property-access" });
        return;
      }
    } else if (node.kind === SyntaxKind.Identifier) {
      const identifier = node as Identifier;
      const parent = node.parent;
      // A shorthand `{ Effect }` names itself but really references the
      // binding, unlike every other declaration name.
      const isShorthandValue = parent.kind === SyntaxKind.ShorthandPropertyAssignment;
      const isChainPart =
        parent.kind === SyntaxKind.PropertyAccessExpression ||
        parent.kind === SyntaxKind.QualifiedName ||
        parent.kind === SyntaxKind.ImportSpecifier ||
        parent.kind === SyntaxKind.ImportClause ||
        parent.kind === SyntaxKind.NamespaceImport ||
        parent.kind === SyntaxKind.ExportSpecifier;
      // Declarations name themselves through `name` (variable, parameter,
      // function, class, property assignment, …): a name is not a usage.
      const isDeclarationName =
        !isShorthandValue && (parent as Node & { name?: Node }).name === node;
      if (!isChainPart && !isDeclarationName) {
        const isType =
          parent.kind === SyntaxKind.TypeReference &&
          (parent as TypeReferenceNode).typeName === node;
        usages.push({
          path: [identifier.text],
          kind: isType ? "type-reference" : isCallee(node) ? "call" : "identifier",
        });
      }
    }

    node.forEachChild((child) => {
      visit(child);
      return undefined;
    });
  };

  visit(source);

  // Resolve the collected paths through the imports and count them.
  const bindings = bindingsFrom(importRows);
  const counts = new Map<string, SymbolUsage>();
  for (const usage of usages) {
    const first = usage.path[0];
    if (first === undefined) continue;
    const base = bindings.get(first);
    if (base === undefined) continue;
    const symbol = [base, ...usage.path.slice(1)].join(".");
    const key = `${usage.kind} ${symbol}`;
    const current = counts.get(key);
    counts.set(
      key,
      current === undefined
        ? { symbol, kind: usage.kind, count: 1 }
        : { symbol, kind: usage.kind, count: current.count + 1 },
    );
  }

  return {
    imports: [...importRows].sort((left, right) => left.line - right.line),
    symbols: [...counts.values()].sort(
      (left, right) =>
        right.count - left.count ||
        left.symbol.localeCompare(right.symbol) ||
        left.kind.localeCompare(right.kind),
    ),
  };
};
