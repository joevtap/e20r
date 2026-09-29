/**
 * The e20r viewer: a read-only window onto the state database, served by
 * `e20r view`. Every number comes from the JSON API (`/api/*`, see
 * `src/viewer/queries.ts`), which aggregates in SQL; the page only renders.
 *
 * The URL hash holds the whole view state (tab, filters, open drawer), so a
 * view can be bookmarked or shared, and the back button works.
 */
(function () {
  "use strict";

  const { h, fill, charts } = window.Viz;

  // ------------------------------------------------------------------
  // Formatting
  // ------------------------------------------------------------------

  const intFormat = new Intl.NumberFormat("en-US");
  const compactFormat = new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  });
  const int = (value) => (value === null || value === undefined ? "–" : intFormat.format(value));
  const compact = (value) =>
    value === null || value === undefined ? "–" : compactFormat.format(value);
  const pct = (value, digits = 1) =>
    value === null || value === undefined || Number.isNaN(value)
      ? "–"
      : `${(value * 100).toFixed(digits)}%`;
  const share = (part, whole) => (whole > 0 ? part / whole : 0);
  const seconds = (millis) => `${(millis / 1000).toFixed(1)}s`;

  const ago = (iso) => {
    if (!iso) return "never";
    const delta = (Date.now() - Date.parse(iso)) / 1000;
    if (delta < 60) return `${Math.max(0, Math.round(delta))}s ago`;
    if (delta < 3600) return `${Math.round(delta / 60)}m ago`;
    if (delta < 86400) return `${Math.round(delta / 3600)}h ago`;
    return new Date(iso).toISOString().slice(0, 10);
  };

  const roleLabel = {
    all: "TypeScript files",
    authored: "hand-written files",
    source: "production files",
    test: "test files",
    generated: "generated files",
  };

  const roleName = { source: "production", test: "tests", generated: "generated" };

  const statusLabel = {
    analyzed: "analyzed",
    excluded: "excluded",
    selected: "awaiting analysis",
    "not-adopter": "not an adopter",
    failed: "failed",
  };

  const exclusionText = {
    "effect-ts-org":
      "Owned by the Effect-TS organization: Effect itself is not an adopter of Effect.",
    configured: "Listed in EXCLUDE_REPOS.",
    "defines-effect-package":
      "Defines a package named `effect` or `@effect/*` in its own tree: a copy or mirror of Effect.",
  };

  const badge = (status) => h("span", { class: `badge ${status}` }, statusLabel[status] || status);

  const githubUrl = (repo) => repo.htmlUrl || `https://github.com/${repo.fullName}`;
  const fileUrl = (repo, file, line) =>
    `${githubUrl(repo)}/blob/${repo.commitSha}/${file.split("/").map(encodeURIComponent).join("/")}${line ? `#L${line}` : ""}`;

  // ------------------------------------------------------------------
  // State <-> URL hash
  // ------------------------------------------------------------------

  const defaults = { q: "", status: "processed", minStars: "", role: "all", kind: "all" };
  const tabs = ["overview", "repos", "symbols", "files", "data"];

  const state = {
    tab: "overview",
    filters: { ...defaults },
    repo: null,
    symbol: null,
    symbolKind: "all",
    search: "",
    reposSort: { key: "stars", dir: "desc" },
    symbolsSort: { key: "repos", dir: "desc" },
    filesSort: { key: "usages", dir: "desc" },
    path: "",
    uses: "",
    /** The Files tab narrowed to one repository (from its drawer). */
    fileRepo: "",
    fileRepoName: "",
    table: "repo_state",
    tableOffset: 0,
    tableSort: { key: "", dir: "asc" },
    lastUpdate: null,
    meta: null,
  };

  const readHash = () => {
    const [tab, query] = location.hash.replace(/^#/, "").split("?");
    const params = new URLSearchParams(query || "");
    state.tab = tabs.includes(tab) ? tab : "overview";
    for (const key of Object.keys(defaults)) state.filters[key] = params.get(key) ?? defaults[key];
    state.repo = params.get("repo");
    state.symbol = params.get("symbol");
    state.symbolKind = params.get("symbolKind") || "all";
    state.search = params.get("search") || "";
    state.path = params.get("path") || "";
    state.uses = params.get("uses") || "";
    state.fileRepo = params.get("fileRepo") || "";
    state.fileRepoName = params.get("fileRepoName") || "";
    state.table = params.get("table") || state.table;
    state.tableOffset = Math.max(0, Number(params.get("offset")) || 0);
    if (state.tab === "data") {
      const [key, dir] = (params.get("sort") || "").split(":");
      state.tableSort = { key: key || "", dir: dir === "desc" ? "desc" : "asc" };
    }
    const sort = params.get("sort");
    if (sort && state.tab !== "data") {
      const [key, dir] = sort.split(":");
      const target =
        state.tab === "symbols"
          ? state.symbolsSort
          : state.tab === "files"
            ? state.filesSort
            : state.reposSort;
      target.key = key;
      target.dir = dir === "asc" ? "asc" : "desc";
    }
  };

  const hashFor = (changes) => {
    const next = { ...state, filters: { ...state.filters }, ...changes };
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(next.filters)) {
      if (value !== "" && value !== defaults[key]) params.set(key, value);
    }
    if (next.repo) params.set("repo", next.repo);
    if (next.symbol) {
      params.set("symbol", next.symbol);
      if (next.symbolKind !== "all") params.set("symbolKind", next.symbolKind);
    }
    if (next.tab === "symbols" && next.search) params.set("search", next.search);
    if (next.tab === "files" && next.path) params.set("path", next.path);
    if (next.tab === "files" && next.uses) params.set("uses", next.uses);
    if (next.tab === "files" && next.fileRepo) {
      params.set("fileRepo", next.fileRepo);
      params.set("fileRepoName", next.fileRepoName);
    }
    if (next.tab === "data") {
      params.set("table", next.table);
      if (next.tableOffset > 0) params.set("offset", String(next.tableOffset));
      if (next.tableSort.key) params.set("sort", `${next.tableSort.key}:${next.tableSort.dir}`);
    }
    const sort =
      next.tab === "repos"
        ? next.reposSort
        : next.tab === "symbols"
          ? next.symbolsSort
          : next.tab === "files"
            ? next.filesSort
            : null;
    if (sort) params.set("sort", `${sort.key}:${sort.dir}`);
    const query = params.toString();
    return `#${next.tab}${query ? `?${query}` : ""}`;
  };

  const navigate = (changes, replace = false) => {
    const hash = hashFor(changes);
    if (hash === location.hash) return;
    if (replace) history.replaceState(null, "", hash);
    else history.pushState(null, "", hash);
    onRoute();
  };

  // ------------------------------------------------------------------
  // API
  // ------------------------------------------------------------------

  const filterParams = () => {
    const params = {};
    for (const [key, value] of Object.entries(state.filters))
      if (value !== "" && value !== defaults[key]) params[key] = value;
    return params;
  };

  const api = async (path, params = {}) => {
    const url = `/api/${path}?${new URLSearchParams(params)}`;
    const response = await fetch(url);
    const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
    if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
    return body;
  };

  // ------------------------------------------------------------------
  // Views
  // ------------------------------------------------------------------

  const view = document.getElementById("view");
  let renderToken = 0;

  /** Renders a view, keeping the previous frame (dimmed) until the new one is ready. */
  const renderView = async () => {
    const token = ++renderToken;
    viewStale = false;
    view.classList.add("loading");
    if (view.childElementCount === 0) fill(view, h("p", { class: "muted" }, "Loading…"));
    try {
      const content = await { overview, repos, symbols, files: filesTab, data }[state.tab]();
      if (token !== renderToken) return;
      fill(view, content);
    } catch (error) {
      if (token !== renderToken) return;
      fill(view, h("p", { class: "error" }, `Could not load this view: ${error.message}`));
    } finally {
      if (token === renderToken) view.classList.remove("loading");
    }
  };

  const sectionHead = (title, note) =>
    h(
      "div",
      { class: "section-head" },
      h("h2", null, title),
      note ? h("span", { class: "note" }, note) : null,
    );

  const kpi = (value, label, sub, unit) =>
    h(
      "div",
      { class: "kpi" },
      h("div", { class: "value" }, value, unit ? [" ", h("small", null, unit)] : null),
      h("div", { class: "label" }, label),
      sub ? h("div", { class: "sub" }, sub) : null,
    );

  // ---- overview ----

  async function overview() {
    const [o, meta] = await Promise.all([
      api("overview", filterParams()),
      state.meta ? Promise.resolve(state.meta) : api("meta"),
    ]);
    const c = o.counts;
    const files = roleLabel[state.filters.role];

    if (c.processed === 0) {
      return h(
        "div",
        null,
        sectionHead("Nothing to show yet"),
        h(
          "p",
          { class: "note" },
          "No processed repository matches the filters. Run `e20r run` to fill the database, or relax the filters.",
        ),
      );
    }

    const kpis = h(
      "div",
      { class: "kpis" },
      kpi(
        int(c.probed),
        "repositories probed",
        c.failed > 0 ? `${int(c.failed)} failed to process` : "top TypeScript repos by stars",
      ),
      kpi(
        int(c.adopters),
        "Effect adopters",
        "runtime dependency on effect",
        pct(o.ratios.adopters),
      ),
      kpi(
        int(c.analyzed),
        "deep-analyzed",
        `${int(c.excluded)} excluded · ${int(c.selected)} awaiting`,
      ),
      kpi(
        pct(o.ratios.codeUsage),
        "import Effect in code",
        `${int(c.withCodeUsage)} of ${int(c.analyzed)} analyzed adopters`,
      ),
      kpi(
        pct(o.ratios.effectFiles),
        `of ${files} use Effect`,
        `${int(c.effectFiles)} of ${int(c.tsFiles)} in analyzed repos`,
      ),
      kpi(
        pct(o.ratios.effectLoc),
        "of lines in those files",
        `${compact(c.effectLoc)} of ${compact(c.loc)} non-blank lines`,
      ),
    );

    const funnel = charts.bars({
      title: "Adoption funnel",
      subtitle: "each stage as a share of the previous one · click to filter",
      rows: [
        { label: "probed", value: c.probed, display: int(c.probed), status: "processed" },
        {
          label: "adopters",
          value: c.adopters,
          display: `${int(c.adopters)} · ${pct(share(c.adopters, c.probed))}`,
          status: "adopters",
        },
        {
          label: "deep-analyzed",
          value: c.analyzed,
          display: `${int(c.analyzed)} · ${pct(share(c.analyzed, c.adopters))}`,
          status: "analyzed",
        },
        {
          label: "Effect in code",
          value: c.withCodeUsage,
          display: `${int(c.withCodeUsage)} · ${pct(share(c.withCodeUsage, c.analyzed))}`,
          status: "analyzed",
        },
      ].map((row) => ({
        ...row,
        onClick: () => navigate({ filters: { ...state.filters, status: row.status } }),
      })),
    });

    const popularity = charts.bars({
      title: "Adoption by popularity",
      subtitle: "adopter rate in five equal-size star bands",
      rows: o.popularity.map((band) => ({
        label: band.label,
        value: band.rate,
        display: pct(band.rate),
        tip: {
          value: pct(band.rate),
          label: `${band.adopters} of ${band.repos} repositories adopt Effect`,
        },
      })),
    });

    const declared = o.declaration.runtime + o.declaration.peer + o.declaration.dev;
    const declaration = charts.bars({
      title: "How effect is declared",
      subtitle: "repos with any effect dependency · only runtime counts as adoption",
      empty: "No manifest declares effect.",
      rows: [
        { label: "dependencies", value: o.declaration.runtime },
        { label: "peer only", value: o.declaration.peer },
        { label: "dev only", value: o.declaration.dev },
      ]
        .filter(() => declared > 0)
        .map((row) => ({
          ...row,
          display: `${int(row.value)} · ${pct(share(row.value, declared))}`,
        })),
    });

    const versions = charts.bars({
      title: "Effect major version",
      subtitle: "adopters by the highest major they pin (catalogs resolved)",
      empty: "No adopter in the current filters.",
      rows: o.versions.map((row) => ({
        label: row.label,
        value: row.repos,
        display: int(row.repos),
        tip: { value: `${int(row.repos)} repositories`, label: row.label },
      })),
    });

    const analyzedNote = `analyzed repos · ${files}`;
    const packages = charts.bars({
      title: "Effect packages",
      subtitle: `repositories importing each package · ${analyzedNote}`,
      empty: "No Effect import in the current filters.",
      rows: o.packages.map((row) => ({
        label: row.package,
        value: row.repos,
        display: `${int(row.repos)}`,
        tip: {
          value: `${int(row.repos)} repositories`,
          label: `${row.package} · ${int(row.files)} files`,
        },
      })),
    });

    const kindNote = state.filters.kind === "all" ? "any position" : state.filters.kind;
    const symbolsChart = charts.bars({
      title: "Most widespread symbols",
      subtitle: `repositories using each symbol (${kindNote}) · click for the repositories`,
      empty: "No symbol usage in the current filters.",
      rows: o.symbols.map((row) => ({
        label: row.symbol,
        value: row.repos,
        display: int(row.repos),
        tip: {
          value: `${int(row.repos)} repositories`,
          label: `${row.symbol} · ${int(row.usages)} usages in ${int(row.files)} files`,
        },
        onClick: () => navigate({ symbol: row.symbol, symbolKind: state.filters.kind }),
      })),
    });

    const depth = charts.bars({
      title: "Adoption depth",
      subtitle: `share of ${files} importing Effect, per repository · click for details`,
      empty: "No analyzed repository imports Effect.",
      max: Math.max(...o.depth.map((row) => row.fileShare), 0),
      rows: o.depth.map((row) => ({
        label: row.fullName,
        value: row.fileShare,
        display: pct(row.fileShare),
        tip: {
          value: pct(row.fileShare),
          label: `${int(row.effectFiles)} of ${int(row.tsFiles)} files · ${pct(row.locShare)} of lines`,
        },
        onClick: () => navigate({ repo: String(row.repoId) }),
      })),
    });

    const roleUsages = o.byRole.reduce((sum, row) => sum + row.usages, 0);
    const byRole = charts.bars({
      title: "Where Effect lives",
      subtitle: `share of symbol usages by file role (${kindNote}) · not scoped by the Code filter · click to filter`,
      empty: "No analyzed repository in the current filters.",
      max: 1,
      rows: o.byRole.map((row) => ({
        label: roleName[row.role] || row.role,
        value: share(row.usages, roleUsages),
        display: pct(share(row.usages, roleUsages)),
        tip: {
          value: `${int(row.usages)} usages`,
          label: `${int(row.effectFiles)} of ${int(row.files)} ${roleName[row.role] || row.role} files import Effect (${pct(share(row.effectFiles, row.files))})`,
        },
        onClick: () => navigate({ filters: { ...state.filters, role: row.role } }),
      })),
    });

    const totalFiles = o.histogram.reduce((sum, bin) => sum + bin.files, 0);
    const histogram = charts.columns({
      title: "Effect imports per file",
      subtitle: `distribution over ${int(totalFiles)} Effect-using files`,
      bins: o.histogram.map((bin) => ({
        label: bin.label,
        value: bin.files,
        display: compact(bin.files),
        tip: {
          value: `${int(bin.files)} files`,
          label: `${bin.label} Effect import${bin.label === "1" ? "" : "s"} · ${pct(share(bin.files, totalFiles))}`,
        },
      })),
    });

    const runs = meta.runs.filter((run) => run.adopterRatio !== null);
    const trend = charts.trend({
      title: "Ratios over runs",
      subtitle: "whole population as recorded at the end of each run (not filtered)",
      empty: "Needs at least two finished runs.",
      format: (value) => pct(value, 0),
      series: [
        {
          label: "adopters / probed",
          className: "series-1",
          points: runs.map((run) => ({
            x: `#${run.id} ${run.startedAt.slice(5, 10)}`,
            y: run.adopterRatio,
          })),
        },
        {
          label: "Effect in code / analyzed",
          className: "series-2",
          points: runs.map((run) => ({
            x: `#${run.id} ${run.startedAt.slice(5, 10)}`,
            y: run.codeUsageRatio ?? 0,
          })),
        },
      ],
    });

    return h(
      "div",
      null,
      kpis,
      sectionHead("Who adopts Effect"),
      h("div", { class: "grid quad" }, funnel, popularity, declaration, versions),
      sectionHead("How deeply", `per-file metrics count ${files}`),
      h("div", { class: "grid" }, depth, h("div", { class: "stack" }, byRole, histogram)),
      sectionHead("What they use"),
      h("div", { class: "grid" }, packages, symbolsChart),
      sectionHead("Over time"),
      h("div", { class: "grid" }, trend, runsTable(meta.runs)),
    );
  }

  /** Every run, finished or not: the table view of the trend. */
  const runsTable = (runs) =>
    charts.card(
      { title: "Runs", subtitle: "an unfinished run was interrupted (or is still going)" },
      runs.length === 0
        ? charts.empty("No run recorded.")
        : h(
            "div",
            { class: "table-wrap" },
            table({
              columns: [
                { label: "#", num: true, cell: (r) => r.id },
                { label: "Command", cell: (r) => r.command },
                { label: "Started", cell: (r) => r.startedAt.replace("T", " ").slice(0, 16) },
                {
                  label: "Finished",
                  cell: (r) =>
                    r.finishedAt ? ago(r.finishedAt) : h("span", { class: "muted" }, "unfinished"),
                },
                { label: "Probed", num: true, cell: (r) => int(r.probed) },
                { label: "Adopters", num: true, cell: (r) => pct(r.adopterRatio) },
                { label: "In code", num: true, cell: (r) => pct(r.codeUsageRatio) },
              ],
              rows: [...runs].reverse(),
            }),
          ),
    );

  // ---- sortable, pageable tables ----

  /**
   * A table over server-sorted rows: `columns: [{ key, label, num?, sort?,
   * cell(row) }]`; `sort` names the server sort key.
   */
  const table = ({ columns, rows, sort, onSort, onRow, rowLabel, expand }) =>
    h(
      "table",
      null,
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          columns.map((column) => {
            const active = sort && column.sort === sort.key;
            return h(
              "th",
              {
                class:
                  [column.num ? "num" : "", column.sort ? "sortable" : ""].join(" ").trim() ||
                  undefined,
                "aria-sort": active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined,
                tabindex: column.sort ? "0" : undefined,
                onClick: column.sort ? () => onSort(column.sort) : undefined,
                onKeydown: column.sort
                  ? (event) => event.key === "Enter" && onSort(column.sort)
                  : undefined,
              },
              column.label,
              active ? (sort.dir === "asc" ? " ↑" : " ↓") : "",
            );
          }),
        ),
      ),
      h(
        "tbody",
        null,
        rows.map((row) => {
          const tr = h(
            "tr",
            onRow
              ? {
                  class: "clickable",
                  tabindex: "0",
                  "aria-label": rowLabel ? rowLabel(row) : undefined,
                  onClick: () => onRow(row),
                  onKeydown: (event) => event.key === "Enter" && onRow(row),
                }
              : null,
            columns.map((column) =>
              h("td", { class: column.num ? "num" : column.className }, column.cell(row)),
            ),
          );
          return expand ? expandable(tr, columns.length, () => expand(row)) : tr;
        }),
      ),
    );

  const cellBar = (value) =>
    h(
      "span",
      { class: "cell-bar" },
      h("i", { style: `width:${Math.min(100, (value || 0) * 100).toFixed(1)}%` }),
    );

  const toggleSort = (current, key) =>
    current.key === key
      ? { key, dir: current.dir === "asc" ? "desc" : "asc" }
      : { key, dir: key === "name" || key === "symbol" ? "asc" : "desc" };

  /** A paged table whose "Show more" appends the next page in place. */
  const pagedTable = async ({ load, pageSize, render }) => {
    let offset = 0;
    const first = await load(0);
    const rows = [...first.rows];
    const wrap = h("div", { class: "table-wrap" });
    const foot = h("div", { class: "table-foot" });
    const draw = () => {
      fill(wrap, render(rows), foot);
      fill(
        foot,
        h("span", null, `Showing ${int(rows.length)} of ${int(first.total)}`),
        rows.length < first.total
          ? h(
              "button",
              {
                type: "button",
                onClick: async (event) => {
                  event.target.disabled = true;
                  offset += pageSize;
                  const next = await load(offset);
                  rows.push(...next.rows);
                  draw();
                },
              },
              "Show more",
            )
          : "",
      );
    };
    draw();
    return { element: wrap, total: first.total, extra: first };
  };

  // ---- repositories ----

  async function repos() {
    const pageSize = 100;
    const sort = state.reposSort;
    const files = roleLabel[state.filters.role];
    const columns = [
      { label: "Repository", sort: "name", cell: (r) => r.fullName },
      { label: "★", num: true, sort: "stars", cell: (r) => compact(r.stars) },
      { label: "Status", sort: "status", cell: (r) => badge(r.status) },
      { label: "effect", cell: (r) => h("span", { class: "mono" }, r.effectSpecs || "") },
      { label: "TS files", num: true, sort: "tsFiles", cell: (r) => int(r.tsFiles) },
      {
        label: "Effect files",
        num: true,
        sort: "effectFiles",
        cell: (r) => (r.status === "analyzed" ? int(r.effectFiles) : ""),
      },
      {
        label: "Depth",
        sort: "depth",
        cell: (r) => (r.depth === null ? "" : [cellBar(r.depth), pct(r.depth)]),
      },
      {
        label: "Effect lines",
        num: true,
        sort: "locShare",
        cell: (r) => (r.locShare === null ? "" : pct(r.locShare)),
      },
      {
        label: "Effect packages",
        num: true,
        sort: "packages",
        cell: (r) => (r.status === "analyzed" ? int(r.effectPackages) : ""),
      },
      { label: "Updated", sort: "updated", cell: (r) => ago(r.updatedAt) },
    ];
    const paged = await pagedTable({
      pageSize,
      load: (offset) =>
        api("repos", { ...filterParams(), sort: sort.key, dir: sort.dir, limit: pageSize, offset }),
      render: (rows) =>
        table({
          columns,
          rows,
          sort,
          onSort: (key) => navigate({ reposSort: toggleSort(sort, key) }, true),
          onRow: (row) => navigate({ repo: String(row.repoId) }),
          rowLabel: (row) => `Open ${row.fullName}`,
        }),
    });
    return h(
      "div",
      null,
      sectionHead("Repositories", `${int(paged.total)} match · file columns count ${files}`),
      paged.element,
    );
  }

  // ---- symbols ----

  async function symbols() {
    const pageSize = 100;
    const sort = state.symbolsSort;
    let analyzedRepos = 0;
    const columns = [
      { label: "Symbol", sort: "symbol", cell: (r) => h("span", { class: "mono" }, r.symbol) },
      { label: "Position", cell: (r) => r.kind },
      {
        label: "Repositories",
        sort: "repos",
        cell: (r) => [
          cellBar(share(r.repos, analyzedRepos)),
          `${int(r.repos)} · ${pct(share(r.repos, analyzedRepos), 0)}`,
        ],
      },
      { label: "Files", num: true, sort: "files", cell: (r) => int(r.files) },
      { label: "Usages", num: true, sort: "usages", cell: (r) => int(r.usages) },
    ];
    const paged = await pagedTable({
      pageSize,
      load: async (offset) => {
        const page = await api("symbols", {
          ...filterParams(),
          search: state.search,
          sort: sort.key,
          dir: sort.dir,
          limit: pageSize,
          offset,
        });
        analyzedRepos = page.analyzedRepos;
        return page;
      },
      render: (rows) =>
        table({
          columns,
          rows,
          sort,
          onSort: (key) => navigate({ symbolsSort: toggleSort(sort, key) }, true),
          onRow: (row) => navigate({ symbol: row.symbol, symbolKind: row.kind }),
          rowLabel: (row) => `Repositories using ${row.symbol}`,
        }),
    });

    const search = h("input", {
      type: "search",
      placeholder: "Effect.gen, Schema., Layer…",
      value: state.search,
      "aria-label": "Search symbols",
      onInput: debounce((event) => navigate({ search: event.target.value.trim() }, true), 250),
    });
    return h(
      "div",
      null,
      sectionHead(
        "Symbols",
        `${int(paged.total)} symbol × position pairs in ${int(analyzedRepos)} analyzed repos · ${roleLabel[state.filters.role]}`,
      ),
      h(
        "div",
        { class: "local-filters" },
        h("label", { class: "field grow" }, h("span", null, "Symbol"), search),
      ),
      paged.element,
    );
  }

  // ---- files ----

  /** A symbol as listed inline: calls as `fn()`, type positions as `: T`. */
  const symbolLabel = (symbol, kind) =>
    kind === "call" ? `${symbol}()` : kind === "type-reference" ? `: ${symbol}` : symbol;

  async function filesTab() {
    const pageSize = 100;
    const sort = state.filesSort;
    const query = () => ({
      ...filterParams(),
      path: state.path,
      uses: state.uses,
      ...(state.fileRepo ? { repo: state.fileRepo } : {}),
    });
    const columns = [
      { label: "Repository", sort: "file", cell: (r) => r.fullName },
      {
        label: "File",
        className: "wrap",
        cell: (r) => [
          h("span", { class: "mono" }, r.file),
          " ",
          h(
            "a",
            {
              href: fileUrl(r, r.file),
              target: "_blank",
              rel: "noopener",
              title: "Open on GitHub",
            },
            "↗",
          ),
        ],
      },
      { label: "Role", cell: (r) => roleName[r.role] || r.role },
      { label: "LOC", num: true, sort: "loc", cell: (r) => int(r.loc) },
      { label: "Imports", num: true, sort: "imports", cell: (r) => int(r.importCount) },
      { label: "Symbols", num: true, sort: "symbols", cell: (r) => int(r.distinctSymbols) },
      { label: "Usages", num: true, sort: "usages", cell: (r) => int(r.usages) },
      {
        label: "Most used symbols",
        className: "wrap symbols-cell",
        cell: (r) =>
          r.topSymbols.length === 0
            ? h("span", { class: "muted" }, "none")
            : [
                r.topSymbols.map(([symbol, kind, count], index) => [
                  index > 0 ? h("span", { class: "muted" }, " · ") : null,
                  h("span", { class: "mono" }, symbolLabel(symbol, kind)),
                  h("span", { class: "muted" }, ` ×${count}`),
                ]),
                r.distinctSymbols > r.topSymbols.length
                  ? h(
                      "span",
                      { class: "muted" },
                      ` · +${int(r.distinctSymbols - r.topSymbols.length)} more`,
                    )
                  : null,
              ],
      },
    ];

    let paged;
    try {
      paged = await pagedTable({
        pageSize,
        load: (offset) =>
          api("files", { ...query(), sort: sort.key, dir: sort.dir, limit: pageSize, offset }),
        render: (rows) =>
          table({
            columns,
            rows,
            sort,
            onSort: (key) => navigate({ filesSort: toggleSort(sort, key) }, true),
            expand: (row) => fileDetail(row, row.file),
          }),
      });
    } catch (error) {
      if (error.message !== "not found") throw error;
      return h(
        "div",
        null,
        sectionHead("Files"),
        h(
          "p",
          { class: "note" },
          "This view needs a newer server: rebuild (pnpm build) and restart `e20r view`.",
        ),
      );
    }

    const field = (label, key, placeholder) =>
      h(
        "label",
        { class: "field grow" },
        h("span", null, label),
        h("input", {
          type: "search",
          placeholder,
          value: state[key],
          "aria-label": label,
          onInput: debounce((event) => navigate({ [key]: event.target.value.trim() }, true), 300),
        }),
      );
    const csvHref = `/api/files.csv?${new URLSearchParams(query())}`;

    return h(
      "div",
      null,
      sectionHead(
        "Files",
        `${int(paged.total)} Effect files in ${int(paged.extra.repos)} analyzed repo${paged.extra.repos === 1 ? "" : "s"} · ${roleLabel[state.filters.role]} · click a row for every symbol`,
      ),
      h(
        "div",
        { class: "local-filters" },
        state.fileRepo
          ? h(
              "span",
              { class: "chip" },
              `Repository: ${state.fileRepoName || state.fileRepo}`,
              h(
                "button",
                {
                  type: "button",
                  class: "ghost",
                  "aria-label": "Show files of every repository",
                  onClick: () => navigate({ fileRepo: "", fileRepoName: "" }),
                },
                "✕",
              ),
            )
          : null,
        field("File path", "path", "src/services, .test.ts…"),
        field("Uses symbol", "uses", "Layer.effect, Schema.TaggedError…"),
        h(
          "a",
          { class: "button", href: csvHref, download: "e20r-file-symbols.csv" },
          "Download CSV",
        ),
      ),
      h(
        "p",
        { class: "note", style: "margin:0 0 10px" },
        "Calls show as fn(), type positions as : T. The CSV has one line per file × symbol for this selection.",
      ),
      paged.element,
    );
  }

  // ---- data browser ----

  /** What each table holds, at which grain (see src/store/migrations.ts). */
  const tableInfo = {
    repos: "Crawled repository: stars, forks, owner, license, topics, dates, raw GitHub payload",
    repo_state:
      "Pipeline state per repository: status, adopter, commit, exclusion, error, attempts, timings",
    manifest_deps: "Every effect / @effect/* dependency: manifest × package × field × specifier",
    catalog_versions: "pnpm / bun catalog entries for effect",
    package_managers: "Package manager evidence (lockfiles) per repository",
    workspace_packages: "Adopters' workspace packages and how they declare effect",
    file_totals: "TS files, LOC and Effect files per package × role × extension",
    effect_files: "One row per file that imports Effect",
    file_imports: "Every Effect import: module, package, kind, line, bound names",
    file_symbols: "Symbol usages per file: symbol × position with a count",
    runs: "One row per run: configuration, start / end, population summary",
    crawl_state: "Where the resumable crawl stands",
    v_population: "View · the population summary",
    v_repo_adoption: "View · adoption depth per analyzed repository",
    v_symbol_usage: "View · symbol usage across analyzed repositories",
    v_package_usage: "View · package usage across analyzed repositories",
  };

  /** Columns holding a repository id: their cells open the repository drawer. */
  const repoIdColumns = new Set(["repoId"]);

  /** A one-line preview of a JSON value (the full value is in the row drawer). */
  const jsonPreview = (value) => {
    if (Array.isArray(value)) return `[${value.length}] ${JSON.stringify(value).slice(0, 80)}`;
    const keys = Object.keys(value);
    return `{${keys.slice(0, 4).join(", ")}${keys.length > 4 ? ", …" : ""}}`;
  };

  const dataCell = (key, value, tableName) => {
    if (value === null || value === undefined) return h("span", { class: "null" }, "null");
    if (typeof value === "object") {
      return h(
        "span",
        { class: "json", title: "click the row for the full value" },
        jsonPreview(value),
      );
    }
    const text = String(value);
    const isRepo =
      repoIdColumns.has(key) ||
      (tableName === "repos" && key === "id") ||
      (tableName === "repo_state" && key === "repoId");
    if (isRepo && typeof value === "number") {
      return h(
        "a",
        {
          href: hashFor({ repo: String(value) }),
          title: "Open the repository",
          onClick: (event) => {
            event.preventDefault();
            event.stopPropagation();
            navigate({ repo: String(value) });
          },
        },
        text,
      );
    }
    return h("span", { title: text.length > 40 ? text.slice(0, 2000) : undefined }, text);
  };

  /** The full row, one field per line, JSON pretty-printed. */
  const showRow = (tableName, row) => {
    const body = h(
      "dl",
      { class: "row-fields" },
      Object.entries(row).map(([key, value]) => [
        h("dt", { class: "mono" }, key),
        h(
          "dd",
          null,
          value === null || value === undefined
            ? h("span", { class: "null" }, "null")
            : typeof value === "object"
              ? h("pre", null, JSON.stringify(value, null, 2))
              : h("span", { class: typeof value === "number" ? "mono" : undefined }, String(value)),
        ),
      ]),
    );
    const repoId = row.repoId ?? (tableName === "repos" ? row.id : undefined);
    showDrawer(
      `${tableName} row`,
      h(
        "div",
        null,
        repoId !== undefined
          ? h(
              "p",
              { class: "note" },
              h(
                "a",
                {
                  href: hashFor({ repo: String(repoId) }),
                  onClick: (event) => {
                    event.preventDefault();
                    navigate({ repo: String(repoId) });
                  },
                },
                "Open the repository →",
              ),
            )
          : null,
        body,
      ),
    );
  };

  async function data() {
    const meta = state.meta || (await api("meta"));
    const pageSize = 100;
    const name = state.table;
    const sort = state.tableSort;
    const page = await api("table", {
      name,
      limit: pageSize,
      offset: state.tableOffset,
      ...(sort.key ? { sort: sort.key, dir: sort.dir } : {}),
    });
    const columns =
      page.columns && page.columns.length > 0
        ? page.columns
        : [...new Set(page.rows.flatMap((row) => Object.keys(row)))];
    // Right-align columns whose values on this page are all numbers.
    const numeric = new Set(
      columns.filter(
        (key) =>
          page.rows.length > 0 &&
          page.rows.every((row) => row[key] === null || typeof row[key] === "number"),
      ),
    );

    const entry = (item) =>
      h(
        "button",
        {
          type: "button",
          "aria-current": item.name === name ? "true" : undefined,
          title: tableInfo[item.name],
          onClick: () =>
            navigate(
              { table: item.name, tableOffset: 0, tableSort: { key: "", dir: "asc" } },
              true,
            ),
        },
        h("span", null, item.name),
        h("span", { class: "count" }, compact(item.rows)),
      );
    const tables = meta.tables.filter((item) => !item.name.startsWith("v_"));
    const views = meta.tables.filter((item) => item.name.startsWith("v_"));
    const list = h(
      "nav",
      { class: "table-list", "aria-label": "Tables" },
      h("div", { class: "list-head" }, "Tables"),
      tables.map(entry),
      h("div", { class: "list-head" }, "Views"),
      views.map(entry),
    );

    const first = page.total === 0 ? 0 : state.tableOffset + 1;
    const last = Math.min(state.tableOffset + page.rows.length, page.total);
    const go = (offset) => navigate({ tableOffset: Math.max(0, offset) }, true);
    const pager = h(
      "div",
      { class: "pager" },
      h("span", null, `rows ${int(first)}–${int(last)} of ${int(page.total)}`),
      h(
        "button",
        {
          type: "button",
          disabled: state.tableOffset === 0,
          onClick: () => go(0),
          "aria-label": "First page",
        },
        "«",
      ),
      h(
        "button",
        {
          type: "button",
          disabled: state.tableOffset === 0,
          onClick: () => go(state.tableOffset - pageSize),
        },
        "‹ Prev",
      ),
      h(
        "button",
        {
          type: "button",
          disabled: last >= page.total,
          onClick: () => go(state.tableOffset + pageSize),
        },
        "Next ›",
      ),
      h(
        "button",
        {
          type: "button",
          disabled: last >= page.total,
          onClick: () => go(Math.floor((page.total - 1) / pageSize) * pageSize),
          "aria-label": "Last page",
        },
        "»",
      ),
    );

    const onSort = (key) => {
      const next =
        sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" };
      navigate({ tableSort: next, tableOffset: 0 }, true);
    };
    const grid = h(
      "table",
      { class: "data-table" },
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          columns.map((key) => {
            const active = page.sort ? page.sort.column === key : false;
            return h(
              "th",
              {
                class: `sortable${numeric.has(key) ? " num" : ""}`,
                tabindex: "0",
                "aria-sort": active
                  ? page.sort.dir === "asc"
                    ? "ascending"
                    : "descending"
                  : undefined,
                onClick: () => onSort(key),
                onKeydown: (event) => event.key === "Enter" && onSort(key),
              },
              key,
              active ? (page.sort.dir === "asc" ? " ↑" : " ↓") : "",
            );
          }),
        ),
      ),
      h(
        "tbody",
        null,
        page.rows.map((row) =>
          h(
            "tr",
            {
              class: "clickable",
              tabindex: "0",
              onClick: () => showRow(name, row),
              onKeydown: (event) => event.key === "Enter" && showRow(name, row),
            },
            columns.map((key) =>
              h(
                "td",
                { class: numeric.has(key) ? "num" : undefined },
                dataCell(key, row[key], name),
              ),
            ),
          ),
        ),
      ),
    );

    return h(
      "div",
      null,
      sectionHead(
        "Data",
        "raw rows of the state database (read-only) · click a row for all its fields",
      ),
      h(
        "div",
        { class: "data-layout" },
        list,
        h(
          "div",
          { class: "data-main" },
          h(
            "div",
            { class: "data-head" },
            h(
              "div",
              null,
              h("h3", { class: "mono" }, name),
              h("p", { class: "note" }, tableInfo[name] || ""),
            ),
            pager,
          ),
          page.rows.length === 0
            ? h("p", { class: "empty" }, "No rows.")
            : h("div", { class: "data-scroll" }, grid),
        ),
      ),
    );
  }

  // ------------------------------------------------------------------
  // Drawer: repository and symbol details
  // ------------------------------------------------------------------

  const drawer = document.getElementById("drawer");
  const drawerTitle = document.getElementById("drawer-title");
  const drawerBody = document.getElementById("drawer-body");
  const scrim = document.getElementById("scrim");
  let drawerKey = null;
  let lastFocus = null;
  /** New data arrived while the drawer was open; it refreshes on request only. */
  let drawerStale = false;

  // Repository and symbol drawers live in the URL; a data row drawer does not.
  const closeDrawer = () =>
    state.repo || state.symbol
      ? navigate({ repo: null, symbol: null, symbolKind: "all" })
      : hideDrawer();

  const showDrawer = (title, body) => {
    if (drawer.hidden) lastFocus = document.activeElement;
    drawerTitle.textContent = title;
    fill(drawerBody, body);
    drawer.hidden = false;
    scrim.hidden = false;
    // Modal: the page behind stops scrolling, so the drawer's is the only
    // scrollbar and the wheel always scrolls what is under the pointer.
    document.documentElement.classList.add("drawer-open");
    Viz.hideTip();
    document.getElementById("drawer-close").focus({ preventScroll: true });
  };

  const hideDrawer = () => {
    if (drawer.hidden) return;
    drawer.hidden = true;
    scrim.hidden = true;
    drawerKey = null;
    drawerStale = false;
    document.documentElement.classList.remove("drawer-open");
    Viz.hideTip();
    if (lastFocus && document.contains(lastFocus)) {
      lastFocus.focus({ preventScroll: true, focusVisible: false });
    }
    updateStatus();
  };

  const renderDrawer = async (force = false) => {
    const key = state.repo
      ? `repo:${state.repo}:${JSON.stringify(state.filters)}`
      : state.symbol
        ? `symbol:${state.symbol}:${state.symbolKind}:${JSON.stringify(state.filters)}`
        : null;
    if (key === null) return hideDrawer();
    if (key === drawerKey && !force) return;
    drawerKey = key;
    drawerStale = false;
    if (drawer.hidden)
      showDrawer(state.repo ? "Loading…" : state.symbol, h("p", { class: "muted" }, "Loading…"));
    try {
      if (state.repo) await repoDrawer(state.repo, key);
      else await symbolDrawer(state.symbol, state.symbolKind, key);
    } catch (error) {
      if (drawerKey !== key) return;
      // A crawled repository outside the processed top-N has no state yet.
      if (state.repo && error.message === "not found") {
        showDrawer(
          "Not processed yet",
          h(
            "p",
            { class: "note" },
            "This repository was crawled but has not been processed (it is outside the processed top-N, or the run has not reached it yet).",
          ),
        );
      } else {
        showDrawer("Error", h("p", { class: "error" }, error.message));
      }
    }
  };

  async function repoDrawer(id, key) {
    const detail = await api("repo", { ...filterParams(), id });
    if (drawerKey !== key) return;
    const repo = detail.state;
    const files = roleLabel[state.filters.role];
    const totals = detail.totals.reduce(
      (sum, row) => ({
        files: sum.files + (row.files || 0),
        effectFiles: sum.effectFiles + (row.effectFiles || 0),
        loc: sum.loc + (row.loc || 0),
        effectLoc: sum.effectLoc + (row.effectLoc || 0),
        declarations: sum.declarations + (row.declarationFiles || 0),
        generated: sum.generated + (row.role === "generated" ? row.files || 0 : 0),
      }),
      { files: 0, effectFiles: 0, loc: 0, effectLoc: 0, declarations: 0, generated: 0 },
    );
    const analyzed = repo.status === "analyzed";
    const timings = repo.timings || {};

    const facts = h(
      "div",
      { class: "facts" },
      badge(repo.status),
      repo.stars !== null ? h("span", null, h("b", null, `★ ${int(repo.stars)}`)) : null,
      repo.language ? h("span", null, repo.language) : null,
      repo.license ? h("span", null, repo.license) : null,
      repo.commitSha
        ? h(
            "span",
            null,
            "commit ",
            h(
              "a",
              {
                href: `${githubUrl(repo)}/tree/${repo.commitSha}`,
                target: "_blank",
                rel: "noopener",
              },
              h("span", { class: "mono" }, repo.commitSha.slice(0, 10)),
            ),
          )
        : null,
      h(
        "span",
        null,
        h("a", { href: githubUrl(repo), target: "_blank", rel: "noopener" }, "GitHub ↗"),
      ),
      h("span", { class: "muted", title: repo.updatedAt }, `processed ${ago(repo.updatedAt)}`),
    );

    const callouts = [
      repo.status === "excluded"
        ? h(
            "div",
            { class: "callout" },
            h("b", null, "Excluded from the deep analysis. "),
            exclusionText[repo.excludedReason] || repo.excludedReason,
          )
        : null,
      repo.status === "failed"
        ? h(
            "div",
            { class: "callout critical" },
            h("b", null, `Failed at ${repo.errorStage} (attempt ${repo.attempts}). `),
            h("span", { class: "mono" }, repo.error),
          )
        : null,
      repo.status === "selected"
        ? h(
            "div",
            { class: "callout" },
            "Adopter awaiting deep analysis (processed with --skip-analysis, or interrupted).",
          )
        : null,
    ];

    const stageTimes = Object.entries(timings)
      .map(([stage, millis]) => `${stage} ${seconds(millis)}`)
      .join(" · ");

    const kpis = h(
      "div",
      { class: "kpis", style: "margin-top:14px" },
      kpi(
        int(totals.files),
        files,
        `${totals.generated > 0 ? `${int(totals.generated)} generated · ` : ""}${int(totals.declarations)} declaration files · ${int(repo.manifestCount)} manifests`,
      ),
      analyzed
        ? kpi(
            pct(share(totals.effectFiles, totals.files)),
            "import Effect",
            `${int(totals.effectFiles)} files`,
          )
        : null,
      analyzed
        ? kpi(
            pct(share(totals.effectLoc, totals.loc)),
            "of lines",
            `${compact(totals.effectLoc)} of ${compact(totals.loc)}`,
          )
        : null,
    );

    // One row per package, catalog references resolved; the full list of
    // declarations stays one click away.
    const resolveSpec = (spec) => {
      if (!spec.startsWith("catalog:")) return spec;
      const name = spec.slice("catalog:".length) || "default";
      const entry = detail.catalogs.find((c) => c.catalog === name);
      return entry ? `${entry.spec} (${spec})` : spec;
    };
    const byPackage = new Map();
    for (const dep of detail.deps) {
      const entry = byPackage.get(dep.package) || {
        package: dep.package,
        fields: new Set(),
        specs: new Set(),
        manifests: 0,
      };
      entry.fields.add(dep.field);
      entry.specs.add(resolveSpec(dep.spec));
      entry.manifests++;
      byPackage.set(dep.package, entry);
    }
    const deps =
      detail.deps.length === 0
        ? null
        : [
            sectionHead(
              "Effect dependencies",
              `${byPackage.size} packages in ${int(detail.deps.length)} declarations`,
            ),
            h(
              "div",
              { class: "table-wrap" },
              table({
                columns: [
                  { label: "Package", cell: (r) => h("span", { class: "mono" }, r.package) },
                  { label: "Fields", cell: (r) => [...r.fields].join(", ") },
                  {
                    label: "Specs",
                    className: "wrap",
                    cell: (r) => h("span", { class: "mono" }, [...r.specs].join(", ")),
                  },
                  { label: "Manifests", num: true, cell: (r) => int(r.manifests) },
                ],
                rows: [...byPackage.values()],
              }),
            ),
            h(
              "details",
              { class: "note", style: "margin-top:8px" },
              h("summary", null, "Every declaration"),
              h(
                "div",
                { class: "table-wrap", style: "margin-top:8px" },
                table({
                  columns: [
                    { label: "Package", cell: (r) => h("span", { class: "mono" }, r.package) },
                    { label: "Field", cell: (r) => r.field },
                    { label: "Spec", cell: (r) => h("span", { class: "mono" }, r.spec) },
                    {
                      label: "Manifest",
                      cell: (r) =>
                        h(
                          "a",
                          {
                            href: fileUrl(repo, r.manifest),
                            target: "_blank",
                            rel: "noopener",
                            class: "mono",
                          },
                          r.manifest,
                        ),
                    },
                  ],
                  rows: detail.deps,
                }),
              ),
            ),
          ];

    const managers =
      detail.managers.length > 0
        ? h(
            "p",
            { class: "note" },
            `Package managers: ${detail.managers.map((m) => `${m.manager} (${m.evidence})`).join(" · ")}`,
          )
        : null;

    const packages =
      detail.packages.length === 0
        ? null
        : [
            sectionHead("Workspace packages", `${int(detail.packages.length)} packages · ${files}`),
            h(
              "div",
              { class: "table-wrap" },
              table({
                columns: [
                  {
                    label: "Directory",
                    cell: (r) => h("span", { class: "mono" }, r.dir || "(root)"),
                  },
                  { label: "Name", cell: (r) => r.name || "" },
                  { label: "effect dep", cell: (r) => r.effectDependency || "" },
                  { label: "TS files", num: true, cell: (r) => int(r.tsFiles) },
                  {
                    label: "Effect files",
                    num: true,
                    cell: (r) => (analyzed ? int(r.effectFiles) : ""),
                  },
                  {
                    label: "Depth",
                    cell: (r) =>
                      analyzed && r.tsFiles > 0
                        ? [
                            cellBar(share(r.effectFiles, r.tsFiles)),
                            pct(share(r.effectFiles, r.tsFiles)),
                          ]
                        : "",
                  },
                ],
                rows: detail.packages,
              }),
            ),
          ];

    const symbolsChart =
      detail.symbols.length === 0
        ? null
        : charts.bars({
            title: "Most used symbols",
            subtitle: `usages in this repository · ${state.filters.kind === "all" ? "any position" : state.filters.kind}`,
            rows: detail.symbols.slice(0, 15).map((row) => ({
              label: `${row.symbol}${state.filters.kind === "all" ? ` (${row.kind})` : ""}`,
              value: row.usages,
              display: int(row.usages),
              tip: {
                value: `${int(row.usages)} usages`,
                label: `${row.symbol} · ${row.kind} · ${int(row.files)} files`,
              },
              onClick: () => navigate({ repo: null, symbol: row.symbol, symbolKind: row.kind }),
            })),
          });

    const imported =
      detail.imported.length === 0
        ? null
        : charts.bars({
            title: "Imported packages",
            subtitle: "files importing each Effect package",
            rows: detail.imported.map((row) => ({
              label: row.package,
              value: row.files,
              display: int(row.files),
              tip: {
                value: `${int(row.files)} files`,
                label: `${row.package} · ${int(row.imports)} imports`,
              },
            })),
          });

    // The drawer shows the busiest files; the Files tab has all of them,
    // searchable, with every symbol and a CSV export.
    const drawerFiles = 50;
    const fileRows = detail.files.rows.slice(0, drawerFiles);
    const allFilesLink = h(
      "a",
      {
        href: hashFor({
          tab: "files",
          repo: null,
          fileRepo: String(repo.repoId),
          fileRepoName: repo.fullName,
          path: "",
          uses: "",
        }),
        onClick: (event) => {
          event.preventDefault();
          navigate({
            tab: "files",
            repo: null,
            fileRepo: String(repo.repoId),
            fileRepoName: repo.fullName,
            path: "",
            uses: "",
          });
        },
      },
      `All ${int(detail.files.total)} files in the Files tab →`,
    );
    const filesTable =
      fileRows.length === 0
        ? null
        : [
            sectionHead(
              "Effect files",
              `${detail.files.total > fileRows.length ? `top ${int(fileRows.length)} of ${int(detail.files.total)}` : `${int(detail.files.total)} files`} by symbol usages · click to expand`,
            ),
            h("div", { class: "table-wrap" }, effectFilesTable(repo, fileRows)),
            h("p", { class: "note" }, allFilesLink),
          ];

    showDrawer(
      repo.fullName,
      h(
        "div",
        null,
        facts,
        callouts,
        kpis,
        stageTimes ? h("p", { class: "note" }, `Stage timings: ${stageTimes}`) : null,
        symbolsChart || imported
          ? [sectionHead("Usage"), h("div", { class: "grid" }, symbolsChart, imported)]
          : null,
        packages,
        filesTable,
        deps,
        managers,
      ),
    );
  }

  /**
   * One file's imports (each linked to its line on GitHub at the analyzed
   * commit) and its complete symbol list. `repo` needs `repoId`, `fullName`,
   * `commitSha` and optionally `htmlUrl`.
   */
  const fileDetail = async (repo, path) => {
    const file = await api("file", { repo: repo.repoId, file: path });
    const nameList = (names) =>
      names
        .map((n) => (n.imported === n.local ? n.local : `${n.imported} as ${n.local}`))
        .join(", ");
    return h(
      "div",
      { class: "inner" },
      h(
        "div",
        null,
        h("b", null, `Imports (${file.imports.length})`),
        h(
          "ul",
          null,
          file.imports.map((entry) =>
            h(
              "li",
              null,
              h(
                "a",
                { href: fileUrl(repo, path, entry.line), target: "_blank", rel: "noopener" },
                `L${entry.line}`,
              ),
              " ",
              h("span", { class: "mono" }, entry.module),
              ` ${entry.kind}`,
              entry.names.length > 0
                ? h("span", { class: "muted" }, ` { ${nameList(entry.names)} }`)
                : null,
            ),
          ),
        ),
      ),
      h(
        "div",
        null,
        h("b", null, `Symbols (${file.symbols.length})`),
        file.symbols.length === 0
          ? h("p", { class: "muted" }, "none (text-scanned or import-only)")
          : h(
              "ul",
              { class: "symbol-list" },
              file.symbols.map((symbol) =>
                h(
                  "li",
                  null,
                  h("span", { class: "mono" }, symbol.symbol),
                  h("span", { class: "muted" }, ` ${symbol.kind} × ${symbol.count}`),
                ),
              ),
            ),
      ),
      h(
        "div",
        null,
        h(
          "a",
          { href: fileUrl(repo, path), target: "_blank", rel: "noopener" },
          "Open on GitHub ↗",
        ),
      ),
    );
  };

  /** Makes a table row toggle a detail row (spanning `colspan` columns) below it. */
  const expandable = (tr, colspan, load) => {
    let open = null;
    const toggle = async () => {
      if (open) {
        open.remove();
        open = null;
        tr.setAttribute("aria-expanded", "false");
        return;
      }
      const detailRow = h(
        "tr",
        { class: "file-detail" },
        h("td", { colspan: String(colspan) }, h("span", { class: "muted" }, "Loading…")),
      );
      open = detailRow;
      tr.after(detailRow);
      tr.setAttribute("aria-expanded", "true");
      try {
        fill(detailRow.firstChild, await load());
      } catch (error) {
        fill(detailRow.firstChild, h("span", { class: "error" }, error.message));
      }
    };
    tr.classList.add("clickable");
    tr.setAttribute("tabindex", "0");
    tr.setAttribute("aria-expanded", "false");
    tr.addEventListener("click", (event) => {
      if (event.target.closest("a")) return; // links open, rows don't toggle
      toggle();
    });
    tr.addEventListener("keydown", (event) => event.key === "Enter" && toggle());
    return tr;
  };

  /** The Effect files of a repository; a row expands into its imports and symbols. */
  const effectFilesTable = (repo, rows) =>
    h(
      "table",
      null,
      h(
        "thead",
        null,
        h(
          "tr",
          null,
          h("th", null, "File"),
          h("th", null, "Role"),
          h("th", { class: "num" }, "LOC"),
          h("th", { class: "num" }, "Imports"),
          h("th", { class: "num" }, "Symbols"),
          h("th", null, "Parser"),
        ),
      ),
      h(
        "tbody",
        null,
        rows.map((row) =>
          expandable(
            h(
              "tr",
              null,
              h("td", { class: "wrap mono" }, row.file),
              h("td", null, roleName[row.role] || row.role),
              h("td", { class: "num" }, int(row.loc)),
              h("td", { class: "num" }, int(row.importCount)),
              h("td", { class: "num" }, int(row.symbolTotal)),
              h("td", null, row.parser === "oxc" ? "" : row.parser),
            ),
            6,
            () => fileDetail(repo, row.file),
          ),
        ),
      ),
    );

  async function symbolDrawer(symbol, kind, key) {
    const rows = await api("symbol", { ...filterParams(), symbol, symbolKind: kind });
    if (drawerKey !== key) return;
    const usages = rows.reduce((sum, row) => sum + row.usages, 0);
    showDrawer(
      symbol,
      h(
        "div",
        null,
        h(
          "div",
          { class: "facts" },
          h("span", null, h("b", null, kind === "all" ? "any position" : kind)),
          h("span", null, `${int(rows.length)} repositories`),
          h("span", null, `${int(usages)} usages`),
        ),
        rows.length === 0
          ? h(
              "p",
              { class: "empty" },
              "No analyzed repository uses this symbol under the current filters.",
            )
          : [
              sectionHead("Repositories", "click to open"),
              h(
                "div",
                { class: "table-wrap" },
                table({
                  columns: [
                    { label: "Repository", cell: (r) => r.fullName },
                    { label: "★", num: true, cell: (r) => compact(r.stars) },
                    { label: "Files", num: true, cell: (r) => int(r.files) },
                    { label: "Usages", num: true, cell: (r) => int(r.usages) },
                  ],
                  rows,
                  onRow: (row) =>
                    navigate({ symbol: null, symbolKind: "all", repo: String(row.repoId) }),
                  rowLabel: (row) => `Open ${row.fullName}`,
                }),
              ),
            ],
      ),
    );
  }

  // ------------------------------------------------------------------
  // Chrome: tabs, filters, theme, live status
  // ------------------------------------------------------------------

  function debounce(fn, wait) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), wait);
    };
  }

  const inputs = {
    q: document.getElementById("f-q"),
    status: document.getElementById("f-status"),
    minStars: document.getElementById("f-stars"),
    role: document.getElementById("f-role"),
    kind: document.getElementById("f-kind"),
  };

  const syncChrome = () => {
    for (const button of document.querySelectorAll(".tabs button")) {
      button.setAttribute("aria-selected", String(button.dataset.tab === state.tab));
    }
    for (const [key, input] of Object.entries(inputs)) {
      if (document.activeElement !== input) input.value = state.filters[key];
    }
    // Raw tables are not filtered: the filter row would only mislead there.
    document.getElementById("filters").hidden = state.tab === "data";
    document.title = `e20r · ${{ overview: "Overview", repos: "Repositories", symbols: "Symbols", files: "Files", data: "Data" }[state.tab]}`;
  };

  let lastViewKey = null;
  const onRoute = () => {
    readHash();
    syncChrome();
    const viewKey = hashFor({ repo: null, symbol: null, symbolKind: "all" });
    if (viewKey !== lastViewKey) {
      lastViewKey = viewKey;
      renderView();
    }
    renderDrawer();
  };

  for (const button of document.querySelectorAll(".tabs button")) {
    button.addEventListener("click", () => navigate({ tab: button.dataset.tab }));
  }

  const setFilter = (key, value) =>
    navigate({ filters: { ...state.filters, [key]: value } }, key === "q" || key === "minStars");
  inputs.q.addEventListener(
    "input",
    debounce(() => setFilter("q", inputs.q.value.trim()), 250),
  );
  inputs.minStars.addEventListener(
    "input",
    debounce(() => setFilter("minStars", inputs.minStars.value.trim()), 350),
  );
  for (const key of ["status", "role", "kind"])
    inputs[key].addEventListener("change", () => setFilter(key, inputs[key].value));
  document.getElementById("filters").addEventListener("submit", (event) => event.preventDefault());
  document
    .getElementById("f-reset")
    .addEventListener("click", () => navigate({ filters: { ...defaults } }));

  document.getElementById("drawer-close").addEventListener("click", closeDrawer);
  scrim.addEventListener("click", closeDrawer);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !drawer.hidden) closeDrawer();
  });

  window.addEventListener("popstate", onRoute);

  // Theme: system -> light -> dark, remembered per browser (a convenience only).
  const themeButton = document.getElementById("theme-toggle");
  const themes = ["system", "light", "dark"];
  const storedTheme = () => {
    try {
      return localStorage.getItem("e20r-theme") || "system";
    } catch {
      return "system";
    }
  };
  const applyTheme = (theme) => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    themeButton.textContent = { system: "◐ System", light: "○ Light", dark: "● Dark" }[theme];
    themeButton.title = `Theme: ${theme} (click to change)`;
  };
  themeButton.addEventListener("click", () => {
    const next = themes[(themes.indexOf(storedTheme()) + 1) % themes.length];
    try {
      localStorage.setItem("e20r-theme", next);
    } catch {
      // not persisted; still applied
    }
    applyTheme(next);
  });
  applyTheme(storedTheme());

  // Live: poll the database's last update; re-render when it moves.
  const status = document.getElementById("db-status");
  const live = document.getElementById("live-toggle");
  const updateStatus = () => {
    const meta = state.meta;
    if (!meta) return;
    const processed = meta.tables.find((entry) => entry.name === "repo_state")?.rows ?? 0;
    const recent = meta.lastUpdate && Date.now() - Date.parse(meta.lastUpdate) < 60_000;
    const stale = viewStale || drawerStale;
    fill(
      status,
      h("span", {
        class: `dot${recent ? " fresh" : ""}`,
        title: recent ? "written in the last minute" : "idle",
      }),
      `${int(processed)} repos · updated ${ago(meta.lastUpdate)}`,
      stale
        ? h(
            "button",
            {
              type: "button",
              class: "refresh",
              title: "The database changed since this view was loaded",
              onClick: () => {
                viewStale = false;
                if (drawerStale) {
                  drawerStale = false;
                  renderDrawer(true);
                } else {
                  renderView();
                }
                updateStatus();
              },
            },
            "New data · Refresh",
          )
        : null,
    );
  };

  /**
   * Views with interaction state (sorting, expanded rows, extra pages, an
   * open drawer) are never re-rendered under the user: they get a refresh
   * button instead. The Overview has none, so it refreshes itself.
   */
  let viewStale = false;
  const onDatabaseChange = () => {
    if (!drawer.hidden) drawerStale = true;
    else if (state.tab === "overview") renderView();
    else viewStale = true;
    updateStatus();
  };
  const poll = async (first = false) => {
    try {
      const meta = await api("meta");
      const changed = state.meta !== null && meta.lastUpdate !== state.meta.lastUpdate;
      state.meta = meta;
      updateStatus();
      if (changed && live.checked && !first) onDatabaseChange();
    } catch (error) {
      status.textContent = `database unavailable: ${error.message}`;
    }
  };

  poll(true).then(() => {
    if (!location.hash) history.replaceState(null, "", hashFor({}));
    onRoute();
  });
  setInterval(() => poll(), 10_000);
  setInterval(updateStatus, 5_000);
})();
