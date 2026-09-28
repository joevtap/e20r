/**
 * Signal registry.
 *
 * Each signal tag known to the pipeline registers a short summary (table
 * cells, aggregation) and an optional detail renderer. Unknown signal tags
 * fall back to a generic JSON renderer, so new pipeline signals show up in
 * the viewer before this file knows about them.
 *
 * To add a signal, copy a `registerSignal(...)` block below and see
 * README.md ("Adding a signal").
 */
(function () {
  "use strict";

  const Viz = (window.Viz = window.Viz || {});

  const registry = new Map();

  /**
   * @param {string} tag the `_tag` of the signal, exactly as in the JSONL
   * @param {{
   *   label: string,
   *   summarize: (signal: object) => string,
   *   render?: (signal: object) => string
   * }} definition
   */
  Viz.registerSignal = function registerSignal(tag, definition) {
    registry.set(tag, definition);
  };

  Viz.signalTags = registry;

  /** Short one-line summary for tables and aggregation. */
  Viz.summarizeSignal = function summarizeSignal(signal) {
    const definition = registry.get(signal && signal._tag);
    if (definition) return definition.summarize(signal);
    return signal && signal._tag ? String(signal._tag) : "signal";
  };

  /** HTML block for the detail panel. Unknown signals render as JSON. */
  Viz.renderSignal = function renderSignal(signal) {
    const definition = registry.get(signal && signal._tag);
    const body = definition && definition.render ? definition.render(signal) : renderJson(signal);
    return `<div class="signal"><h4>${escapeHtml(definition ? definition.label : String(signal && signal._tag))}</h4>${body}</div>`;
  };

  const escapeHtml = (value) =>
    String(value).replace(
      /[&<>"']/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[char],
    );

  const renderJson = (value) => `<pre>${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;

  const renderList = (title, items) =>
    items.length === 0
      ? ""
      : `<p><strong>${escapeHtml(title)}</strong> ${escapeHtml(items.join(", "))}</p>`;

  /** Same as renderList but one line per item: long enumerations read better. */
  const renderStack = (title, items) =>
    items.length === 0
      ? ""
      : `<p><strong>${escapeHtml(title)}</strong></p><ul class="stack">` +
        items.map((item) => `<li>${escapeHtml(item)}</li>`).join("") +
        `</ul>`;

  // ---------------------------------------------------------------------
  // Signals currently emitted by the selection probes
  // (src/domain/clone-state.ts, src/analysis/probes/).
  // ---------------------------------------------------------------------

  Viz.registerSignal("effect-in-package-json", {
    label: "effect in package.json",
    summarize: (signal) => {
      const versions = (signal.versions || []).join(", ");
      const count = (signal.occurrences || []).length;
      return `package.json: ${versions} (${count} occurrence${count === 1 ? "" : "s"})`;
    },
    render: (signal) =>
      renderList("versions", signal.versions || []) +
      renderStack(
        "occurrences",
        (signal.occurrences || []).map((occ) => `${occ.file} · ${occ.field} · ${occ.version}`),
      ),
  });

  Viz.registerSignal("effect-version-in-catalog", {
    label: "effect version in catalog",
    summarize: (signal) => `${signal.manager} catalog: ${(signal.versions || []).join(", ")}`,
    render: (signal) =>
      renderList("manager", [String(signal.manager)]) +
      renderList("versions", signal.versions || []),
  });

  for (const tag of ["uses-pnpm", "uses-bun", "uses-npm"]) {
    Viz.registerSignal(tag, {
      label: tag.replace("uses-", "uses "),
      summarize: (signal) => `evidence: ${signal.evidence}`,
      render: (signal) => renderList("evidence", [signal.evidence]),
    });
  }

  // ---------------------------------------------------------------------
  // Signals emitted by the deep-analysis probes (src/domain/analysis-state.ts,
  // src/deep-analysis/probes/).
  // ---------------------------------------------------------------------

  const roleText = (signal) => {
    const role = signal.byRole || {};
    return `source ${role.source ?? 0}, test ${role.test ?? 0}`;
  };

  /** Capped list of rows: the detail panel must stay usable. */
  const renderRows = (title, rows, describe) => {
    const limit = 25;
    const shown = rows.slice(0, limit);
    const rest = rows.length - shown.length;
    return renderStack(title, [
      ...shown.map(describe),
      ...(rest > 0 ? [`… and ${rest} more`] : []),
    ]);
  };

  const describeImports = (file) => {
    const imports = (file.imports || []).map((row) => {
      const kind = row.kind && row.kind !== "import" ? ` (${row.kind})` : "";
      return `${row.module}${kind} :${row.line}`;
    });
    return `${file.file} [${file.role ?? "?"}]: ${imports.join(", ")}`;
  };

  Viz.registerSignal("ts-file-count", {
    label: "typescript files",
    summarize: (signal) =>
      `${signal.total ?? 0} ts files (${(signal.byRole && signal.byRole.test) ?? 0} test)`,
    render: (signal) =>
      renderList("total", [String(signal.total ?? 0)]) +
      renderList("roles", [roleText(signal)]) +
      renderList(
        "extensions",
        Object.entries(signal.byExtension || {}).map(
          ([extension, count]) => `${extension}: ${count}`,
        ),
      ) +
      renderList("declaration files", [String(signal.declarationFiles ?? 0)]),
  });

  Viz.registerSignal("files-using-effect-count", {
    label: "files using effect",
    summarize: (signal) =>
      `${signal.count ?? 0} files (${(signal.byRole && signal.byRole.test) ?? 0} test)`,
    render: (signal) =>
      renderList("count", [String(signal.count ?? 0)]) + renderList("roles", [roleText(signal)]),
  });

  Viz.registerSignal("effect-imports-per-file", {
    label: "effect imports per file",
    summarize: (signal) =>
      `${signal.importCount ?? 0} imports in ${(signal.files || []).length} files`,
    render: (signal) => renderRows("files", signal.files || [], describeImports),
  });

  Viz.registerSignal("effect-packages-used", {
    label: "effect packages used",
    summarize: (signal) => (signal.packages || []).join(", ") || "no packages",
    render: (signal) =>
      renderList("packages", signal.packages || []) +
      renderRows(
        "per file",
        signal.files || [],
        (file) => `${file.file} [${file.role ?? "?"}]: ${(file.packages || []).join(", ")}`,
      ),
  });

  Viz.registerSignal("effect-symbols-per-file", {
    label: "effect symbols per file",
    summarize: (signal) => `${signal.total ?? 0} usages, ${(signal.symbols || []).length} symbols`,
    render: (signal) =>
      renderRows(
        `symbols in ${signal.file} [${signal.role ?? "?"}]`,
        signal.symbols || [],
        (usage) => `${usage.symbol} (${usage.kind}) × ${usage.count}`,
      ),
  });
})();
