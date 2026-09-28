# e20r state viewer

A self-contained, dependency-free viewer for the pipeline's JSONL state
files. Plain HTML + CSS + JS: open `index.html` in a browser (double-click
works — no build step, no server, no network) and drop your `.jsonl` files
onto the page. Files are read locally in the browser and never uploaded.

## What it shows

| File | Record | Source of truth |
| --- | --- | --- |
| `clone-state.jsonl` | `RepoCloneState` | `src/domain/clone-state.ts` |
| `effect-repos.jsonl` | `EffectRepoState` | `src/domain/effect-repo.ts` |
| `analysis-state.jsonl` | `AnalysisState` | `src/domain/analysis-state.ts` |
| `run-summary.jsonl` | `RunSummary` | `src/domain/run-summary.ts` |
| `repos.jsonl` | `GithubRepo` (crawl cache) | `src/domain/github.ts` |

Features: a "what each file reveals" guide, full-text search, filters (record
type, clone status, adopter, signal tags), sortable columns, a per-row detail
panel with rendered signals, summary tiles, and an insights grid (population
bars, adoption ratios over runs, an effect-imports-per-file histogram, top
effect packages, top AST-counted symbols, adoption depth per repository).
Unknown record shapes and unknown signal tags still load and render as raw
JSON — nothing is rejected for being newer than the viewer.

Lines that fail to parse as JSON objects are skipped and listed under
"Skipped lines". That is the only validation: the viewer trusts records to
match the schemas above.

## Files

| File | Role |
| --- | --- |
| `index.html` | Page structure: hero/loader, the "what each file reveals" guide, summary, insights, filters, tables, detail. New panels get an element here. |
| `style.css` | Minimal styling (light and dark via `prefers-color-scheme`). |
| `records.js` | **Record type registry**: how each JSONL record is detected and columned. |
| `signals.js` | **Signal registry**: how each probe signal is summarized and rendered. |
| `charts.js` | **Chart primitives**: horizontal bars, histograms and SVG trends (`Viz.charts.*`). |
| `app.js` | Loading, per-row derivation, filtering, sorting, aggregation, charts, rendering, event wiring. |
| `sample.jsonl` | Fixture used by `smoke.mjs`; also handy to try the UI. |
| `smoke.mjs` | Headless test (`node smoke.mjs`). Run it after any change. |

All scripts share one global namespace, `window.Viz`, and load in order
(`records.js`, `signals.js`, `app.js`) via plain `<script>` tags — they run
from `file://` because they are not ES modules. Keep it that way unless you
also change how the page is expected to be served.

## Extending

### Adding a signal

When the pipeline grows a new signal tag (a new `Schema.TaggedStruct` in
`src/domain/clone-state.ts`, or a signal in the deep-analysis stage later),
add a registration block to `signals.js`:

```js
Viz.registerSignal("my-new-signal", {
  label: "my new signal",
  // One line for table cells and the summary chips.
  summarize: (signal) => `detail: ${signal.someField}`,
  // Optional HTML block for the detail panel. Use the shared escapeHtml /
  // renderList helpers in signals.js; unknown fields are fine to omit here
  // because the detail panel always shows the raw JSON below the rendered
  // block.
  render: (signal) => renderList("some field", [String(signal.someField)]),
});
```

Nothing else is needed: the filter chips and the per-signal counts in the
summary are derived from the loaded data automatically. Until you register
the tag, it still appears — with its tag name as the summary and raw JSON in
the detail panel — so the viewer never blocks on being updated first.

To verify, add a line with your signal to `sample.jsonl` and run
`node smoke.mjs`, then reload the page and check the detail panel.

### Adding a record type

When the pipeline gains another state file (for example the future
deep-analysis records), add a block to `records.js`:

```js
Viz.registerRecordType("analysis", {
  label: "deep analysis",
  // Cheap shape check used to pick the record type; test discriminative
  // fields that no other record type can have.
  test: (record) => "findings" in record && "repoId" in record,
  columns: [
    { key: "repoId", label: "id", get: (r) => String(r.repoId), sort: (r) => Number(r.repoId) },
    { key: "fullName", label: "repository", get: (r) => r.fullName, sort: (r) => r.fullName },
    // `sort` is optional; omit it for columns that should not be sortable.
  ],
});
```

Registration order matters: `test` functions are tried in registration
order and the first match wins, so put more specific record types before
more general ones. `columns.get` must return a plain string — the renderer
HTML-escapes it. If a column needs markup, render it escaped yourself.

### Adding a filter

Filters live in three places (all small, greppable):

1. `index.html` — add the control inside `<section id="filters">` with an
   `id`.
2. `app.js` — add a field to `state`, an `addEventListener` in the event
   section, and one `if (...) return false;` clause in `filteredRows()`.
3. Done — `render()` re-renders everything on every change.

### Adding an aggregation

Extend the `aggregate()` function in `app.js` (marked `EXTENSION POINT`);
it returns plain counters that `renderStats()` displays as tiles and
`renderCharts()` turns into charts (`Viz.charts.bars|histogram|trend` in
`charts.js`). Keep it cheap — it runs on every keystroke.

Per-row numbers are computed once at load time in `deriveRow()` (also marked
`EXTENSION POINT`): put anything expensive there and read it back from
`row.derived`, so filtering and charting never walk huge nested signals
again.

### Adding a detail rendering

Per record type: pass `renderDetail(record)` when registering the type in
`records.js`. Per signal: the `render` hook above. The raw JSON is always
appended after the rendered part, so render only what benefits from being
highlighted.

## Conventions

- **No dependencies, no build.** If you add a library, the tool stops being
  double-clickable; prefer ~20 lines of plain JS.
- **Escape everything interpolated into HTML.** Use the `escapeHtml` helper
  present in `signals.js` and `app.js`; the fixture in `smoke.mjs` includes
  an injection-ish line to catch regressions.
- **Degrade, don't reject.** Unknown records and signals must still show up
  (as raw JSON) rather than erroring; the pipeline is expected to evolve
  faster than this viewer.
- **Keep schemas authoritative in `src/domain/`** and this README's table in
  sync with them.

## Testing

```sh
node smoke.mjs   # from this directory
```

The smoke test loads the real scripts into a stubbed DOM and drives them
through the app's own event handlers (search, filters, sorting, detail,
clear). When you add a registry entry or a filter, add an assertion there —
the test file mirrors this README's extension points.
