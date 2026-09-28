import type {
  CallExpression,
  EntityName,
  Identifier,
  Node,
  PropertyAccessExpression,
  QualifiedName,
  SourceFile,
  TypeReferenceNode,
} from "typescript/unstable/ast";
import { SyntaxKind } from "typescript/unstable/ast";

/**
 * Effect symbol usages of one file, counted from the TypeScript AST.
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

export type SymbolKind = "call" | "property-access" | "identifier" | "type-reference";

export interface SymbolUsage {
  readonly symbol: string;
  readonly kind: SymbolKind;
  readonly count: number;
}

/** Local binding name -> normalized symbol base. */
export type EffectBindings = ReadonlyMap<string, string>;

const entityPath = (node: EntityName): ReadonlyArray<string> =>
  node.kind === SyntaxKind.Identifier
    ? [(node as Identifier).text]
    : [...entityPath((node as QualifiedName).left), (node as QualifiedName).right.text];

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
 * Counts the Effect symbol usages of one parsed file. Rows are sorted by
 * count (descending), then by name, so the signal is deterministic.
 */
export const countEffectSymbols = (
  source: SourceFile,
  bindings: EffectBindings,
): ReadonlyArray<SymbolUsage> => {
  const counts = new Map<string, SymbolUsage>();

  const bump = (symbol: string, kind: SymbolKind): void => {
    const key = `${kind} ${symbol}`;
    const current = counts.get(key);
    counts.set(
      key,
      current === undefined
        ? { symbol, kind, count: 1 }
        : { symbol, kind, count: current.count + 1 },
    );
  };

  const usageOf = (path: ReadonlyArray<string>, kind: SymbolKind): boolean => {
    const first = path[0];
    if (first === undefined) return false;
    const base = bindings.get(first);
    if (base === undefined) return false;
    bump([base, ...path.slice(1)].join("."), kind);
    return true;
  };

  const walk = (node: Node): void => {
    if (node.kind === SyntaxKind.TypeReference) {
      // The name of a type reference: `Effect.Effect<…>` is an EntityName
      // chain here (a QualifiedName), not a property access.
      usageOf(entityPath((node as TypeReferenceNode).typeName), "type-reference");
    } else if (node.kind === SyntaxKind.PropertyAccessExpression) {
      // Counted once, at the longest chain; the children only carry usages
      // when the chain is not a plain name (`f(x).a.b`).
      const kind = isCallee(node) ? "call" : "property-access";
      if (usageOf(propertyPath(node as PropertyAccessExpression), kind)) return;
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
        usageOf(
          [identifier.text],
          isType ? "type-reference" : isCallee(node) ? "call" : "identifier",
        );
      }
    }

    node.forEachChild((child) => {
      walk(child);
      return undefined;
    });
  };

  walk(source);

  return [...counts.values()].sort(
    (left, right) =>
      right.count - left.count ||
      left.symbol.localeCompare(right.symbol) ||
      left.kind.localeCompare(right.kind),
  );
};
