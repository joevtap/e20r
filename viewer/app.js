/**
 * Viewer application: loads local JSONL files, validates records minimally,
 * and renders searchable / filterable / sortable tables with aggregation.
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

  // ------------------------------------------------------------------
  // Loading and minimal validation
  // ------------------------------------------------------------------

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
      if (query !== "" && !JSON.stringify(row.record).toLowerCase().includes(query)) return false;
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
      if (row.record.adopter) adopters += 1;
      for (const signal of row.record.signals || []) {
        const tag = signal._tag || "signal";
        bySignal[tag] = (bySignal[tag] || 0) + 1;
      }
    }

    // Population and effect-usage counters (EXTENSION POINT). Records are
    // appended across runs, so they are deduped per record type (last record
    // wins, like the pipeline's own state files) before counting; the same
    // repository legitimately has one record per state file.
    const latest = new Map();
    for (const row of rows) {
      if (row.record.repoId !== undefined) {
        latest.set(`${row.type}:${row.record.repoId}`, row.record);
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

    for (const record of latest.values()) {
      if (record.cloneStatus !== undefined) {
        if (record.cloneStatus === "cloned") usage.analyzedRepos += 1;
        else usage.cloneFailures += 1;
        if (record.adopter) usage.adopters += 1;
      }

      const using = Viz.signalOf(record, "files-using-effect-count");
      if (record.analysisStatus === "analyzed") {
        usage.analyzedAdopters += 1;
        if (using && using.count > 0) usage.withCodeUsage += 1;
      }
      if (record.analysisStatus === undefined) continue;

      const tsFiles = Viz.signalOf(record, "ts-file-count");
      if (tsFiles && tsFiles.byRole) {
        usage.tsSource += tsFiles.byRole.source || 0;
        usage.tsTest += tsFiles.byRole.test || 0;
      }
      if (using) usage.effectFiles += using.count || 0;

      const imports = Viz.signalOf(record, "effect-imports-per-file");
      if (imports) usage.effectImports += imports.importCount || 0;

      const used = Viz.signalOf(record, "effect-packages-used");
      for (const name of (used && used.packages) || []) {
        packages[name] = (packages[name] || 0) + 1;
      }
    }

    return { byType, byStatus, bySignal, adopters, usage, packages };
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
    renderStats(rows);
    renderSignalFilters();
    renderTables(rows);
    renderProblems();
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
        : `<div class="stat-row"><div class="stat"><b>${packageEntries
            .slice(0, 10)
            .map(([name, count]) => `${escapeHtml(name)} (${count})`)
            .join(", ")}</b><span>effect packages (repos)</span></div></div>`;

    document.getElementById("stats").innerHTML =
      `<h2>Summary</h2><div class="stat-row">` +
      cells
        .map(
          ([label, value]) =>
            `<div class="stat"><b>${value}</b><span>${escapeHtml(label)}</span></div>`,
        )
        .join("") +
      `</div>` +
      packageHtml;
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
    body.innerHTML =
      `<p><code>${escapeHtml(file)}:${line}</code> · ${escapeHtml(definition ? definition.label : row.type)}</p>` +
      signals.map((signal) => Viz.renderSignal(signal)).join("") +
      `<pre>${escapeHtml(JSON.stringify(row.record, null, 2))}</pre>`;
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
