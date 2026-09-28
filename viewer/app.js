/**
 * Viewer application: loads local JSONL files, validates records minimally,
 * and renders searchable / filterable / sortable tables, summary tiles and
 * charts.
 *
 * Extension points are marked with "EXTENSION POINT" comments; see README.md.
 */
(function () {
  "use strict";

  const Viz = window.Viz;

  // ------------------------------------------------------------------
  // State
  // ------------------------------------------------------------------

  /** @type {{ rows: Array<object>, problems: Array<{file: string, line: number, text: string}> }} */
  const state = {
    rows: [],
    problems: [],
    files: [],
    search: "",
    type: "all",
    status: "all",
    adopter: "all",
    signals: new Set(),
    // Sort state per record type: { type, column, dir } with dir 1 = ascending.
    sort: { type: "clone-state", column: "recordedAt", dir: -1 },
  };

  const MAX_ROWS = 500;

  /** Fixed bins for "effect imports per effect-using file". */
  const IMPORT_BINS = [
    { label: "1", min: 1, max: 1 },
    { label: "2", min: 2, max: 2 },
    { label: "3", min: 3, max: 3 },
    { label: "4", min: 4, max: 4 },
    { label: "5–9", min: 5, max: 9 },
    { label: "10–19", min: 10, max: 19 },
    { label: "20–49", min: 20, max: 49 },
    { label: "50–99", min: 50, max: 99 },
    { label: "100+", min: 100, max: Infinity },
  ];

  // ------------------------------------------------------------------
  // Loading, minimal validation and per-row derivation
  // ------------------------------------------------------------------

  /**
   * Derived numbers are computed once per row at load time (EXTENSION POINT:
   * cheap per-keystroke aggregation depends on this), so filtering, sorting
   * and chart rendering never walk huge nested signals again.
   */
  function deriveRow(record) {
    const derived = {
      search: JSON.stringify(record).toLowerCase(),
      // selection stage
      cloned: record.cloneStatus === "cloned",
      adopter: Boolean(record.adopter),
      // deep-analysis stage
      analyzed: record.analysisStatus === "analyzed",
      tsSource: 0,
      tsTest: 0,
      tsTotal: 0,
      effectFiles: 0,
      effectImports: 0,
      packages: [],
      symbols: null,
      importBins: null,
    };

    if (record.analysisStatus !== undefined) {
      const tsFiles = Viz.signalOf(record, "ts-file-count");
      if (tsFiles && tsFiles.byRole) {
        derived.tsSource = tsFiles.byRole.source || 0;
        derived.tsTest = tsFiles.byRole.test || 0;
        derived.tsTotal = tsFiles.total || derived.tsSource + derived.tsTest;
      }
      const using = Viz.signalOf(record, "files-using-effect-count");
      if (using) derived.effectFiles = using.count || 0;

      const imports = Viz.signalOf(record, "effect-imports-per-file");
      if (imports) {
        derived.effectImports = imports.importCount || 0;
        const bins = new Array(IMPORT_BINS.length).fill(0);
        for (const file of imports.files || []) {
          const count = (file.imports || []).length;
          const index = IMPORT_BINS.findIndex((bin) => count >= bin.min && count <= bin.max);
          if (index >= 0) bins[index] += 1;
        }
        derived.importBins = bins;
      }

      const used = Viz.signalOf(record, "effect-packages-used");
      if (used) derived.packages = used.packages || [];

      const symbols = new Map();
      for (const signal of record.signals || []) {
        if (signal._tag !== "effect-symbols-per-file") continue;
        for (const usage of signal.symbols || []) {
          symbols.set(usage.symbol, (symbols.get(usage.symbol) || 0) + (usage.count || 0));
        }
      }
      if (symbols.size > 0) derived.symbols = symbols;
    }

    return derived;
  }

  function parseLine(text, file, lineNo) {
    if (text.trim() === "") return;
    let record;
    try {
      record = JSON.parse(text);
    } catch (error) {
      state.problems.push({ file, line: lineNo, text: `not JSON: ${error.message}` });
      return;
    }
    if (record === null || typeof record !== "object" || Array.isArray(record)) {
      state.problems.push({ file, line: lineNo, text: "not a JSON object" });
      return;
    }
    state.rows.push({
      type: Viz.detectRecordType(record),
      file: file,
      line: lineNo,
      record,
      derived: deriveRow(record),
    });
  }

  function loadText(text, fileName) {
    text.split(/\r?\n/).forEach((line, index) => parseLine(line, fileName, index + 1));
    if (!state.files.includes(fileName)) state.files.push(fileName);
    render();
  }

  function loadFiles(fileList) {
    for (const file of fileList) {
      const reader = new FileReader();
      reader.onload = () => {
        loadText(String(reader.result), file.name);
      };
      reader.readAsText(file);
    }
  }

  // Programmatic entry point: also used for testing and embedding. The
  // visible API surface for extensions is documented in README.md.
  Viz.loadText = loadText;
  Viz.state = state;

  // ------------------------------------------------------------------
  // Filtering / sorting
  // ------------------------------------------------------------------

  function filteredRows() {
    const query = state.search.trim().toLowerCase();
    return state.rows.filter((row) => {
      if (state.type !== "all" && row.type !== state.type) return false;
      if (state.status !== "all" && row.record.cloneStatus !== state.status) return false;
      if (state.adopter !== "all") {
        if (row.record.adopter === undefined) return false;
        if (Boolean(row.record.adopter) !== (state.adopter === "yes")) return false;
      }
      if (state.signals.size > 0) {
        const tags = (row.record.signals || []).map((signal) => signal._tag);
        if (!tags.some((tag) => state.signals.has(tag))) return false;
      }
      if (query !== "" && !row.derived.search.includes(query)) return false;
      return true;
    });
  }

  // ------------------------------------------------------------------
  // Aggregation (EXTENSION POINT: add counters here)
  // ------------------------------------------------------------------

  function aggregate(rows) {
    const byType = {};
    const byStatus = {};
    const bySignal = {};
    let adopters = 0;
    for (const row of rows) {
      byType[row.type] = (byType[row.type] || 0) + 1;
      const status = row.record.cloneStatus;
      if (status !== undefined) byStatus[status] = (byStatus[status] || 0) + 1;
      if (row.derived.adopter) adopters += 1;
      for (const signal of row.record.signals || []) {
        const tag = signal._tag || "signal";
        bySignal[tag] = (bySignal[tag] || 0) + 1;
      }
    }

    // Population and effect-usage counters. Records are appended across
    // runs, so they are deduped per record type (last record wins, like the
    // pipeline's own state files) before counting; the same repository
    // legitimately has one record per state file.
    const latest = new Map();
    for (const row of rows) {
      if (row.record.repoId !== undefined) {
        latest.set(`${row.type}:${row.record.repoId}`, row);
      }
    }

    const usage = {
      analyzedRepos: 0,
      cloneFailures: 0,
      adopters: 0,
      analyzedAdopters: 0,
      withCodeUsage: 0,
      tsSource: 0,
      tsTest: 0,
      effectFiles: 0,
      effectImports: 0,
    };
    const packages = {};
    const symbols = new Map();
    const importBins = new Array(IMPORT_BINS.length).fill(0);
    const depth = [];

    for (const row of latest.values()) {
      const derived = row.derived;
      if (row.record.cloneStatus !== undefined) {
        if (derived.cloned) usage.analyzedRepos += 1;
        else usage.cloneFailures += 1;
        if (derived.adopter) usage.adopters += 1;
      }
      if (row.record.analysisStatus === undefined) continue;

      if (derived.analyzed) {
        usage.analyzedAdopters += 1;
        if (derived.effectFiles > 0) usage.withCodeUsage += 1;
      }
      usage.tsSource += derived.tsSource;
      usage.tsTest += derived.tsTest;
      usage.effectFiles += derived.effectFiles;
      usage.effectImports += derived.effectImports;

      for (const name of derived.packages) {
        packages[name] = (packages[name] || 0) + 1;
      }
      if (derived.symbols) {
        for (const [symbol, count] of derived.symbols) {
          symbols.set(symbol, (symbols.get(symbol) || 0) + count);
        }
      }
      if (derived.importBins) {
        derived.importBins.forEach((count, index) => {
          importBins[index] += count;
        });
      }
      if (derived.tsTotal > 0 && derived.effectFiles > 0) {
        depth.push({
          label: row.record.fullName || `repo ${row.record.repoId}`,
          value: (derived.effectFiles / derived.tsTotal) * 100,
          hint: `${derived.effectFiles} of ${derived.tsTotal} TypeScript files use Effect`,
        });
      }
    }

    // Population ratios over runs, from the run-summary records. Labels are
    // unique even for several runs on the same day (they collapse otherwise).
    const seenAt = new Map();
    const runs = rows
      .filter((row) => row.record.population !== undefined && row.record.deepAnalysis !== undefined)
      .map((row) => {
        const stamp = String(row.record.recordedAt || "");
        const base = stamp.slice(5, 16).replace("T", " ") || "run";
        const seen = (seenAt.get(base) || 0) + 1;
        seenAt.set(base, seen);
        return {
          at: seen > 1 ? `${base} #${seen}` : base,
          adopterRatio: Number(row.record.population.adopterRatio) || 0,
          codeUsageRatio: Number(row.record.deepAnalysis.codeUsageRatio) || 0,
        };
      })
      .sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0));

    return {
      byType,
      byStatus,
      bySignal,
      adopters,
      usage,
      packages,
      symbols,
      importBins,
      depth,
      runs,
    };
  }

  // ------------------------------------------------------------------
  // Rendering
  // ------------------------------------------------------------------

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

  function render() {
    const rows = filteredRows();
    document.body.classList.toggle("is-empty", state.rows.length === 0);
    renderStats(rows);
    renderCharts(rows);
    renderSignalFilters();
    renderTables(rows);
    renderProblems();
    renderFileSummary();
  }

  function renderFileSummary() {
    const container = document.getElementById("file-summary");
    if (state.files.length === 0) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML =
      `Loaded <b>${state.files.length}</b> file${state.files.length === 1 ? "" : "s"} · ` +
      `<b>${state.rows.length}</b> records` +
      (state.problems.length > 0 ? ` · <b>${state.problems.length}</b> skipped lines` : "");
  }

  function renderStats(rows) {
    const summary = aggregate(rows);
    const ratio = (part, total) => (total === 0 ? "0.0%" : `${((part / total) * 100).toFixed(1)}%`);
    const cells = [
      ["files", state.files.length],
      ["records", state.rows.length],
      ["matching", rows.length],
      ["adopters", summary.adopters],
    ];
    for (const [status, count] of Object.entries(summary.byStatus)) cells.push([status, count]);
    for (const [tag, count] of Object.entries(summary.bySignal)) cells.push([tag, count]);

    const usage = summary.usage;
    if (usage.analyzedRepos > 0) {
      cells.push(["adopter ratio", ratio(usage.adopters, usage.analyzedRepos)]);
    }
    if (usage.analyzedAdopters > 0) {
      cells.push(["analysed for usage", usage.analyzedAdopters]);
      cells.push(["with code usage", ratio(usage.withCodeUsage, usage.analyzedAdopters)]);
    }
    if (usage.tsSource + usage.tsTest > 0) {
      cells.push(["ts files (src/test)", `${usage.tsSource} / ${usage.tsTest}`]);
    }
    if (usage.effectFiles > 0) {
      cells.push(["effect files", usage.effectFiles]);
      cells.push(["effect imports", usage.effectImports]);
    }

    const packageEntries = Object.entries(summary.packages).sort(
      (a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])),
    );
    const packageHtml =
      packageEntries.length === 0
        ? ""
        : `<div class="stat-row"><div class="stat stat-wide"><span>effect packages (repos)</span><b>${packageEntries
            .slice(0, 12)
            .map(([name, count]) => `${escapeHtml(name)} (${count})`)
            .join(" · ")}</b></div></div>`;

    document.getElementById("stats").innerHTML =
      `<h2>Summary</h2><div class="stat-row">` +
      cells
        .map(
          ([label, value]) =>
            `<div class="stat"><b>${escapeHtml(value)}</b><span>${escapeHtml(label)}</span></div>`,
        )
        .join("") +
      `</div>` +
      packageHtml;
  }

  function renderCharts(rows) {
    const summary = aggregate(rows);
    const grid = document.getElementById("charts-grid");
    const card = (id) => `<div class="chart-card" id="chart-${id}"></div>`;

    grid.innerHTML = ["population", "trend", "imports", "packages", "symbols", "depth"]
      .map(card)
      .join("");

    const usage = summary.usage;

    Viz.charts.bars(document.getElementById("chart-population"), {
      title: "Population",
      subtitle: "repositories in the loaded records (latest per repo)",
      rows: [
        { label: "analysed", value: usage.analyzedRepos },
        { label: "effect adopters", value: usage.adopters },
        { label: "with code usage", value: usage.withCodeUsage },
      ].filter((row) => row.value > 0),
    });

    Viz.charts.trend(document.getElementById("chart-trend"), {
      title: "Adoption over runs",
      subtitle: "ratios recorded per run in run-summary.jsonl",
      series: [
        {
          label: "adopters / analysed",
          points: summary.runs.map((run) => ({ x: run.at, y: run.adopterRatio })),
        },
        {
          label: "code usage / adopters",
          points: summary.runs.map((run) => ({ x: run.at, y: run.codeUsageRatio })),
        },
      ],
    });

    Viz.charts.histogram(document.getElementById("chart-imports"), {
      title: "Effect imports per file",
      subtitle: "distribution across effect-using files",
      bins: IMPORT_BINS.map((bin, index) => ({
        label: bin.label,
        count: summary.importBins[index],
      })),
    });

    Viz.charts.bars(document.getElementById("chart-packages"), {
      title: "Effect packages",
      subtitle: "number of analysed repositories using each package",
      rows: Object.entries(summary.packages)
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
        .slice(0, 10),
    });

    Viz.charts.bars(document.getElementById("chart-symbols"), {
      title: "Most used Effect symbols",
      subtitle: "AST-counted usages across analysed repositories",
      rows: [...summary.symbols.entries()]
        .map(([label, value]) => ({ label, value }))
        .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label))
        .slice(0, 10),
    });

    Viz.charts.bars(document.getElementById("chart-depth"), {
      title: "Adoption depth per repository",
      subtitle: "share of TypeScript files importing Effect",
      format: (value) => `${value.toFixed(1)}%`,
      rows: summary.depth.sort((a, b) => b.value - a.value).slice(0, 10),
    });
  }

  function renderSignalFilters() {
    const present = new Set();
    for (const row of state.rows) {
      for (const signal of row.record.signals || []) present.add(signal._tag || "signal");
    }
    const container = document.getElementById("signal-filters");
    if (present.size === 0) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML =
      `<span class="filter-label">Signals:</span>` +
      [...present]
        .sort()
        .map((tag) => {
          const definition = Viz.signalTags.get(tag);
          const label = definition ? definition.label : tag;
          const checked = state.signals.has(tag) ? "checked" : "";
          return `<label class="chip"><input type="checkbox" data-signal="${escapeHtml(tag)}" ${checked}/> ${escapeHtml(label)}</label>`;
        })
        .join("");
  }

  function renderTables(rows) {
    const byType = new Map();
    for (const row of rows) {
      if (!byType.has(row.type)) byType.set(row.type, []);
      byType.get(row.type).push(row);
    }
    const container = document.getElementById("tables");
    if (rows.length === 0) {
      container.innerHTML = `<p class="empty">No matching records. Load files or relax the filters.</p>`;
      return;
    }
    let html = "";
    for (const [type, typed] of byType) {
      const definition = Viz.recordTypes.get(type);
      const visible = sortedRowsFor(type, typed).slice(0, MAX_ROWS);
      html += `<h2>${escapeHtml(definition ? definition.label : type)} <small>(${typed.length})</small></h2>`;
      html += `<div class="table-wrap"><table><thead><tr>`;
      for (const column of definition.columns) {
        const active = state.sort.type === type && state.sort.column === column.key;
        const arrow = active ? (state.sort.dir === 1 ? " ↑" : " ↓") : "";
        html += `<th data-type="${escapeHtml(type)}" data-column="${escapeHtml(column.key)}" class="sortable">${escapeHtml(column.label)}${arrow}</th>`;
      }
      html += `</tr></thead><tbody>`;
      for (const row of visible) {
        html += `<tr data-line="${row.line}" data-file="${escapeHtml(row.file)}">`;
        for (const column of definition.columns) {
          html += `<td>${escapeHtml(column.get(row.record))}</td>`;
        }
        html += `</tr>`;
      }
      html += `</tbody></table>`;
      if (typed.length > visible.length) {
        html += `<p class="empty">Showing first ${visible.length} of ${typed.length} rows. Narrow with filters or search.</p>`;
      }
      html += `</div>`;
    }
    container.innerHTML = html;
  }

  function sortedRowsFor(type, rows) {
    const definition = Viz.recordTypes.get(type);
    const { column: sortKey, dir } = state.sort;
    const column =
      state.sort.type === type ? definition.columns.find((c) => c.key === sortKey) : undefined;
    if (!column || !column.sort) return rows;
    return [...rows].sort((a, b) => {
      const left = column.sort(a.record);
      const right = column.sort(b.record);
      return left < right ? -dir : left > right ? dir : 0;
    });
  }

  function renderProblems() {
    const container = document.getElementById("problems");
    if (state.problems.length === 0) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML =
      `<h2>Skipped lines (${state.problems.length})</h2><ul>` +
      state.problems
        .slice(0, 50)
        .map((p) => `<li><code>${escapeHtml(p.file)}:${p.line}</code> ${escapeHtml(p.text)}</li>`)
        .join("") +
      `</ul>`;
  }

  const DETAIL_JSON_LIMIT = 200000;

  function renderDetail(file, line) {
    const row = state.rows.find((r) => r.file === file && r.line === line);
    const panel = document.getElementById("detail");
    const body = document.getElementById("detail-body");
    if (!row) {
      panel.hidden = true;
      return;
    }
    const definition = Viz.recordTypes.get(row.type);
    const signals = row.record.signals || [];
    const raw = JSON.stringify(row.record, null, 2);
    const truncated = raw.length > DETAIL_JSON_LIMIT;
    body.innerHTML =
      `<p><code>${escapeHtml(file)}:${line}</code> · ${escapeHtml(definition ? definition.label : row.type)}</p>` +
      signals.map((signal) => Viz.renderSignal(signal)).join("") +
      (truncated
        ? `<p class="detail-note">Raw record too large to show in full (${Math.round(raw.length / 1024)} KB) — showing the first ${Math.round(DETAIL_JSON_LIMIT / 1024)} KB. The complete record is in the state file itself.</p>`
        : "") +
      `<pre>${escapeHtml(truncated ? raw.slice(0, DETAIL_JSON_LIMIT) : raw)}</pre>`;
    panel.hidden = false;
  }

  // ------------------------------------------------------------------
  // Events
  // ------------------------------------------------------------------

  const fileInput = document.getElementById("file-input");
  fileInput.addEventListener("change", () => loadFiles(fileInput.files));

  const dropZone = document.getElementById("drop-zone");
  dropZone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropZone.classList.add("over");
  });
  dropZone.addEventListener("dragleave", () => dropZone.classList.remove("over"));
  dropZone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropZone.classList.remove("over");
    loadFiles(event.dataTransfer.files);
  });

  document.getElementById("clear-btn").addEventListener("click", () => {
    state.rows = [];
    state.problems = [];
    state.files = [];
    render();
  });

  document.getElementById("search-input").addEventListener("input", (event) => {
    state.search = event.target.value;
    render();
  });

  document.getElementById("type-select").addEventListener("change", (event) => {
    state.type = event.target.value;
    render();
  });

  document.getElementById("status-select").addEventListener("change", (event) => {
    state.status = event.target.value;
    render();
  });

  document.getElementById("adopter-select").addEventListener("change", (event) => {
    state.adopter = event.target.value;
    render();
  });

  document.getElementById("signal-filters").addEventListener("change", (event) => {
    const tag = event.target.dataset.signal;
    if (tag === undefined) return;
    if (event.target.checked) state.signals.add(tag);
    else state.signals.delete(tag);
    render();
  });

  document.getElementById("tables").addEventListener("click", (event) => {
    const header = event.target.closest("th.sortable");
    if (header) {
      const type = header.dataset.type;
      const column = header.dataset.column;
      if (state.sort.type === type && state.sort.column === column) {
        state.sort.dir = -state.sort.dir;
      } else {
        state.sort = { type, column, dir: 1 };
      }
      render();
      return;
    }
    const row = event.target.closest("tr[data-line]");
    if (row) renderDetail(row.dataset.file, Number(row.dataset.line));
  });

  render();
})();
