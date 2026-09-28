// Headless smoke test for the viewer: loads the three browser scripts with a
// minimal DOM stub and exercises detection, summary, parsing, filtering and
// rendering through the app's own event handlers. Run from the viewer dir:
//
//   node smoke.mjs
//
// Extend it alongside the registries when adding signals or record types.
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";

const listeners = {};
const classes = new Map();
const element = (id) => ({
  id,
  innerHTML: "",
  hidden: false,
  value: "",
  files: [],
  dataset: {},
  classList: { add() {}, remove() {} },
  addEventListener: (event, handler) => {
    listeners[`${id}:${event}`] = handler;
  },
});
const elements = new Map();
const document = {
  body: {
    classList: {
      toggle: (name, on) => classes.set(name, Boolean(on)),
    },
  },
  getElementById: (id) => {
    if (!elements.has(id)) elements.set(id, element(id));
    return elements.get(id);
  },
};

const context = createContext({
  window: {},
  document,
  FileReader: class FileReaderStub {
    readAsText() {}
  },
  console,
});
for (const file of ["records.js", "signals.js", "charts.js", "app.js"]) {
  runInContext(readFileSync(new URL(file, import.meta.url), "utf8"), context, {
    filename: file,
  });
}

const Viz = context.window.Viz;
let failures = 0;
const check = (name, condition, detail) => {
  if (condition) console.log(`PASS ${name}`);
  else {
    failures++;
    console.error(`FAIL ${name}`, detail ?? "");
  }
};
const fire = (id, event, event2) =>
  listeners[`${id}:${event}`](event2 ?? { target: document.getElementById(id) });
const html = (id) => document.getElementById(id).innerHTML;

// --- record detection ---
check(
  "detects clone-state",
  Viz.detectRecordType({ cloneStatus: "cloned", repoId: 1 }) === "clone-state",
);
check(
  "detects effect-repo",
  Viz.detectRecordType({ defaultBranch: "main", commit: "a".repeat(40) }) === "effect-repo",
);
check(
  "detects github-repo (wire shape)",
  Viz.detectRecordType({ stargazers_count: 12, full_name: "a/b" }) === "github-repo",
);
check(
  "detects github-repo (camelCase shape)",
  Viz.detectRecordType({ stargazersCount: 12, fullName: "a/b" }) === "github-repo",
);
check(
  "detects deep-analysis",
  Viz.detectRecordType({ analysisStatus: "analyzed", repoId: 1 }) === "deep-analysis",
);
check(
  "detects run summary",
  Viz.detectRecordType({ population: {}, deepAnalysis: {} }) === "run-summary",
);
check("falls back to unknown", Viz.detectRecordType({ weird: true }) === "unknown");

// --- signal summaries + fallback ---
check(
  "summarizes known signal",
  Viz.summarizeSignal({
    _tag: "effect-in-package-json",
    versions: ["^5.0.0"],
    occurrences: [{}],
  }).includes("^5.0.0"),
);
check(
  "unknown signal falls back",
  Viz.summarizeSignal({ _tag: "brand-new-signal" }) === "brand-new-signal",
  Viz.summarizeSignal({ _tag: "brand-new-signal" }),
);
check(
  "summarizes ts-file-count",
  Viz.summarizeSignal({
    _tag: "ts-file-count",
    total: 12,
    byRole: { source: 9, test: 3 },
  }).includes("12 ts files (3 test)"),
);
check(
  "summarizes effect-imports-per-file",
  Viz.summarizeSignal({
    _tag: "effect-imports-per-file",
    importCount: 3,
    files: [{}, {}],
  }).includes("3 imports in 2 files"),
);
check(
  "summarizes effect-packages-used",
  Viz.summarizeSignal({ _tag: "effect-packages-used", packages: ["effect", "@effect/cli"] }) ===
    "effect, @effect/cli",
);
check(
  "summarizes effect-symbols-per-file",
  Viz.summarizeSignal({
    _tag: "effect-symbols-per-file",
    file: "src/main.ts",
    total: 3,
    symbols: [{}, {}],
  }).includes("3 usages, 2 symbols"),
);
check("renderSignal escapes HTML", !Viz.renderSignal({ _tag: "x<script>" }).includes("<script>"));

// --- load sample data through the app API ---
Viz.loadText(readFileSync(new URL("sample.jsonl", import.meta.url), "utf8"), "sample.jsonl");

check(
  "15 lines -> 14 records + 1 problem",
  Viz.state.rows.length === 14 && Viz.state.problems.length === 1,
  {
    rows: Viz.state.rows.length,
    problems: Viz.state.problems.length,
  },
);
check(
  "tables rendered for all types",
  html("tables").includes("clone state") &&
    html("tables").includes("effect repo") &&
    html("tables").includes("deep analysis") &&
    html("tables").includes("run summary") &&
    html("tables").includes("crawled repository"),
);
check("problem line listed", html("problems").includes("not JSON"));
check("signal chips rendered", html("signal-filters").includes("effect-in-package-json"));
check("file summary rendered", html("file-summary").includes("records"));
check("summary shows counts", html("stats").includes("adopters"));
check("summary shows usage tiles", html("stats").includes("adopter ratio"));
check("summary shows package breakdown", html("stats").includes("@effect/vitest"));
check("dashboard visible once data is loaded", classes.get("is-empty") === false);

// --- charts ---
check(
  "charts render cards",
  html("charts-grid").includes("chart-card") &&
    html("chart-population").includes("Population") &&
    html("chart-depth").includes("Adoption depth"),
);
check(
  "import histogram renders bins",
  html("chart-imports").includes("Effect imports per file") &&
    html("chart-imports").includes("hist-bar"),
);
check(
  "package chart uses data",
  html("chart-packages").includes("@effect/vitest") || html("chart-packages").includes("effect"),
  html("chart-packages").slice(0, 200),
);
check(
  "symbol chart uses data",
  html("chart-symbols").includes("Effect.gen"),
  html("chart-symbols").slice(0, 200),
);
check("trend chart renders svg", html("chart-trend").includes("trend-svg"));

// --- search via the real event handler ---
fire("search-input", "input", { target: { value: "effect-app" } });
check(
  "search narrows to effect-app",
  html("tables").includes("acme/effect-app") && !html("tables").includes("freeCodeCamp"),
);

fire("search-input", "input", { target: { value: "git clone exited" } });
check(
  "search matches error text",
  html("tables").includes("acme/broken") && !html("tables").includes("freeCodeCamp"),
);

fire("search-input", "input", { target: { value: "" } });

// --- filters via real handlers ---
fire("status-select", "change", { target: { value: "clone-failed" } });
check(
  "status filter keeps only failures",
  html("tables").includes("acme/broken") && !html("tables").includes("freeCodeCamp"),
);
fire("status-select", "change", { target: { value: "all" } });

fire("adopter-select", "change", { target: { value: "yes" } });
check(
  "adopter filter works",
  html("tables").includes("acme/effect-app") && !html("tables").includes("acme/dev-only"),
);
fire("adopter-select", "change", { target: { value: "all" } });

fire("signal-filters", "change", {
  target: { dataset: { signal: "effect-in-package-json" }, checked: true },
});
check(
  "signal filter works",
  html("tables").includes("acme/dev-only") && !html("tables").includes("acme/bun-user"),
);
fire("signal-filters", "change", {
  target: { dataset: { signal: "effect-in-package-json" }, checked: false },
});

fire("type-select", "change", { target: { value: "effect-repo" } });
check(
  "type filter works",
  html("tables").includes("effect repo") && !html("tables").includes("clone state"),
);
fire("type-select", "change", { target: { value: "deep-analysis" } });
check(
  "deep-analysis type filter works",
  html("tables").includes("deep analysis") && !html("tables").includes("clone state"),
);
fire("type-select", "change", { target: { value: "all" } });

// --- sorting via real handler ---
fire("tables", "click", {
  target: {
    closest: (sel) =>
      sel === "th.sortable" ? { dataset: { type: "clone-state", column: "fullName" } } : null,
  },
});
check("sort applied", html("tables").includes("↑") || html("tables").includes("↓"));

// --- detail via real handler (line 2 of sample.jsonl is acme/effect-app) ---
fire("tables", "click", {
  target: {
    closest: (sel) =>
      sel === "th.sortable" ? null : { dataset: { line: "2", file: "sample.jsonl" } },
  },
});
check("detail renders signals", html("detail-body").includes("effect in package.json"));
check(
  "detail renders raw JSON",
  html("detail-body").includes("&quot;fullName&quot;: &quot;acme/effect-app&quot;"),
);

// --- deep-analysis detail (line 10 of sample.jsonl is the analyzed effect-app) ---
fire("tables", "click", {
  target: {
    closest: (sel) =>
      sel === "th.sortable" ? null : { dataset: { line: "10", file: "sample.jsonl" } },
  },
});
check("detail renders usage signals", html("detail-body").includes("effect imports per file"));
check(
  "detail lists per-file rows",
  html("detail-body").includes("src/Effect.ts [test]") ||
    html("detail-body").includes("src/App.test.tsx [test]"),
);

// --- symbol detail (line 14 of sample.jsonl is acme/symbols, aliased import) ---
fire("tables", "click", {
  target: {
    closest: (sel) =>
      sel === "th.sortable" ? null : { dataset: { line: "14", file: "sample.jsonl" } },
  },
});
check("detail renders symbol signal", html("detail-body").includes("effect symbols per file"));
check("detail renders normalized symbols", html("detail-body").includes("Effect.gen (call) × 2"));

// --- clear ---
fire("clear-btn", "click");
check("clear empties state", Viz.state.rows.length === 0 && Viz.state.problems.length === 0);
check("empty state returns to the guide", classes.get("is-empty") === true);

if (failures > 0) {
  console.error(`\n${failures} FAILURES`);
  process.exitCode = 1;
} else {
  console.log("\nAll viewer smoke assertions passed");
}
