import type { EffectImport } from "../domain/analysis-state.ts";

/**
 * Text-level scan for Effect imports in one source file. Pure and cheap by
 * design: the deep-analysis stage runs it on every source file of every
 * adopter, and the AST-based probes of a later stage build on its rows.
 *
 * It is a scanner, not a parser: statements are recognized by line-anchored
 * patterns shaped like the real import grammar, which is exact for normal
 * code and only approximate for pathological input (e.g. an `import` inside
 * a block comment or a template literal). When an AST-based probe lands, it
 * can emit corrected rows for the edge cases this scan misses.
 */

/** One binding of an import clause, e.g. `Effect as E` -> imported "Effect", local "E". */
export type ImportName = EffectImport["names"][number];

export type ImportKind = EffectImport["kind"];

/** One Effect import of one file, exactly as the signal stores it. */
export type EffectImportRow = EffectImport;

/**
 * Module specifiers that belong to the Effect library: the `effect` package
 * (with subpaths) and the official `@effect/*` packages. Unrelated packages
 * that merely start with the word ("effectful", "my-effect") do not match.
 */
export const isEffectModule = (specifier: string): boolean =>
  specifier === "effect" || specifier.startsWith("effect/") || specifier.startsWith("@effect/");

/** The package a module specifier belongs to: "effect", "@effect/cli", … */
export const effectPackageName = (specifier: string): string => {
  const parts = specifier.split("/");
  return specifier.startsWith("@") ? parts.slice(0, 2).join("/") : (parts[0] ?? specifier);
};

// `import … from "<spec>"` / `export … from "<spec>"`, anchored to a line
// start so comments and string contents rarely masquerade as statements. The
// clause is modelled as the real grammar — optional prefix, optional
// `{ named }` block, optional suffix — with quotes and `;` excluded and the
// outer parts kept on one line, so a match can never run on into a following
// statement (e.g. a side-effect `import "x"` swallowing a later
// `export { y } from "z"`).
const fromStatement =
  /^[\t ]*(?<keyword>import|export)[ \t]+(?<clause>[^;{}\n"']*(?:\{[^{}]*\})?[^;{}\n"']*)\s*\bfrom\s*["'](?<specifier>[^"']+)["']/gm;

// Side-effect `import "<spec>"`.
const sideEffectImport = /^[\t ]*import\s+["'](?<specifier>[^"']+)["']/gm;

const requireCall = /\brequire\s*\(\s*["'](?<specifier>[^"']+)["']\s*\)/g;

const dynamicImport = /\bimport\s*\(\s*["'](?<specifier>[^"']+)["']\s*\)/g;

const identifier = /^[A-Za-z_$][\w$]*$/;

/**
 * The bindings of an import/re-export clause: default binding, `* as ns`
 * namespace, and the `{ named, list }` with per-name `type` markers and
 * `as` aliases. `export … from` clauses have no default binding; a bare `*`
 * becomes the pseudo-names `imported: "*"`.
 */
export const parseClauseNames = (clause: string): ReadonlyArray<ImportName> => {
  let text = clause.trim();
  let typeOnly = false;
  if (text.startsWith("type ") && !text.startsWith("type from")) {
    typeOnly = true;
    text = text.slice("type ".length).trim();
  }

  const names: Array<ImportName> = [];

  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  const named =
    braceStart >= 0 && braceEnd > braceStart ? text.slice(braceStart + 1, braceEnd) : undefined;
  const prefix = braceStart >= 0 ? text.slice(0, braceStart) : text;

  for (const part of prefix.split(",")) {
    const entry = part.trim();
    if (entry === "") continue;
    const namespace = /^\*\s+as\s+([A-Za-z_$][\w$]*)$/.exec(entry);
    if (namespace !== null && namespace[1] !== undefined) {
      names.push({ imported: "*", local: namespace[1], typeOnly });
    } else if (entry === "*") {
      names.push({ imported: "*", local: "*", typeOnly });
    } else if (identifier.test(entry)) {
      names.push({ imported: "default", local: entry, typeOnly });
    }
  }

  if (named !== undefined) {
    for (const part of named.split(",")) {
      const entry = part.trim();
      if (entry === "") continue;
      const aliased = /\s+as\s+/.test(entry);
      const cleaned = entry.startsWith("type ") ? entry.slice("type ".length).trim() : entry;
      const [imported, local] = aliased ? cleaned.split(/\s+as\s+/) : ([cleaned, cleaned] as const);
      if (imported === undefined || local === undefined) continue;
      names.push({
        imported: imported.trim(),
        local: local.trim(),
        typeOnly: typeOnly || entry.startsWith("type "),
      });
    }
  }

  return names;
};

const lineOf = (source: string, index: number): number => {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (source.charCodeAt(i) === 10) line++;
  }
  return line;
};

const row = (
  source: string,
  match: RegExpExecArray | RegExpMatchArray,
  kind: ImportKind,
  names: ReadonlyArray<ImportName>,
): EffectImportRow | undefined => {
  const specifier = match.groups?.["specifier"];
  const index = match.index ?? 0;
  if (specifier === undefined || !isEffectModule(specifier)) return undefined;
  return {
    module: specifier,
    package: effectPackageName(specifier),
    kind,
    line: lineOf(source, index),
    names,
  };
};

/**
 * Every Effect import of one source file, ordered by line. Absence of Effect
 * imports is an empty list.
 */
export const scanEffectImports = (source: string): ReadonlyArray<EffectImportRow> => {
  const rows: Array<EffectImportRow> = [];

  for (const match of source.matchAll(fromStatement)) {
    const keyword = match.groups?.["keyword"];
    const clause = match.groups?.["clause"] ?? "";
    const kind: ImportKind = keyword === "export" ? "export-from" : "import";
    const parsed = row(source, match, kind, parseClauseNames(clause));
    if (parsed !== undefined) rows.push(parsed);
  }

  for (const match of source.matchAll(sideEffectImport)) {
    const parsed = row(source, match, "import", []);
    if (parsed !== undefined) rows.push(parsed);
  }

  for (const match of source.matchAll(requireCall)) {
    const parsed = row(source, match, "require", []);
    if (parsed !== undefined) rows.push(parsed);
  }

  for (const match of source.matchAll(dynamicImport)) {
    const parsed = row(source, match, "dynamic-import", []);
    if (parsed !== undefined) rows.push(parsed);
  }

  return rows.sort((left, right) => left.line - right.line);
};
