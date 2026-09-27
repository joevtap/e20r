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
      renderList(
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
})();
