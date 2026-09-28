/**
 * Record type registry.
 *
 * Every kind of JSONL record the viewer understands is registered here:
 * how to recognize it (`test`) and how to render it (`columns`, `renderDetail`).
 * Unknown records still load and show as raw JSON rows.
 *
 * To add another record type, copy a `register(...)` block below and see
 * README.md ("Adding a record type").
 */
(function () {
  "use strict";

  const Viz = (window.Viz = window.Viz || {});

  const registry = new Map();

  /**
   * @param {string} key stable id used by filters and by the other modules
   * @param {{
   *   label: string,
   *   test: (record: object) => boolean,
   *   columns: Array<{key: string, label: string, get: (record: object) => string, sort?: (record: object) => (string|number)}>,
   *   renderDetail?: (record: object) => string
   * }} definition
   */
  Viz.registerRecordType = function registerRecordType(key, definition) {
    registry.set(key, definition);
  };

  Viz.recordTypes = registry;

  /** First matching record type key, or "unknown". */
  Viz.detectRecordType = function detectRecordType(record) {
    for (const [key, definition] of registry) {
      if (definition.test(record)) return key;
    }
    return "unknown";
  };

  const shortCommit = (commit) => (typeof commit === "string" ? commit.slice(0, 10) : "");
  const asText = (value) => (value === undefined || value === null ? "" : String(value));
  const isoDate = (value) =>
    typeof value === "string" ? value.replace("T", " ").replace(/\.\d+Z$/, "Z") : "";

  /** First signal with the given `_tag` of a record, or undefined. */
  const signalOf = (record, tag) => (record.signals || []).find((signal) => signal._tag === tag);
  Viz.signalOf = signalOf;

  /** Numeric value out of a signal field chain, "" when absent. */
  const signalNumber = (record, tag, pick) => {
    const signal = signalOf(record, tag);
    const value = signal ? pick(signal) : undefined;
    return value === undefined || value === null ? "" : String(value);
  };
  const signalSort = (record, tag, pick) => {
    const signal = signalOf(record, tag);
    const value = signal ? pick(signal) : undefined;
    return value === undefined || value === null ? -1 : Number(value);
  };

  /** A 0..1 ratio rendered as "12.3%", "" when absent. */
  const percent = (value) =>
    value === undefined || value === null || value === ""
      ? ""
      : `${(Number(value) * 100).toFixed(1)}%`;

  // ---------------------------------------------------------------------
  // clone-state.jsonl: RepoCloneState (src/domain/clone-state.ts)
  // ---------------------------------------------------------------------
  Viz.registerRecordType("clone-state", {
    label: "clone state",
    test: (record) => typeof record.cloneStatus === "string" && "repoId" in record,
    columns: [
      { key: "repoId", label: "id", get: (r) => asText(r.repoId), sort: (r) => Number(r.repoId) },
      {
        key: "fullName",
        label: "repository",
        get: (r) => asText(r.fullName),
        sort: (r) => asText(r.fullName),
      },
      {
        key: "cloneStatus",
        label: "status",
        get: (r) => (r.cloneStatus === "cloned" ? "cloned" : `failed: ${asText(r.cloneError)}`),
        sort: (r) => asText(r.cloneStatus),
      },
      {
        key: "commit",
        label: "commit",
        get: (r) => shortCommit(r.commit),
        sort: (r) => asText(r.commit),
      },
      {
        key: "adopter",
        label: "adopter",
        get: (r) => (r.adopter ? "yes" : "no"),
        sort: (r) => (r.adopter ? 1 : 0),
      },
      {
        key: "signals",
        label: "signals",
        get: (r) =>
          Array.isArray(r.signals)
            ? r.signals.map((signal) => Viz.summarizeSignal(signal)).join(", ")
            : "",
      },
      {
        key: "recordedAt",
        label: "recorded",
        get: (r) => isoDate(r.recordedAt),
        sort: (r) => asText(r.recordedAt),
      },
    ],
  });

  // ---------------------------------------------------------------------
  // analysis-state.jsonl: AnalysisState (src/domain/analysis-state.ts).
  // Registered before effect-repo: its fields are the most specific.
  // ---------------------------------------------------------------------
  Viz.registerRecordType("deep-analysis", {
    label: "deep analysis",
    test: (record) => "analysisStatus" in record && "repoId" in record,
    columns: [
      { key: "repoId", label: "id", get: (r) => asText(r.repoId), sort: (r) => Number(r.repoId) },
      {
        key: "fullName",
        label: "repository",
        get: (r) => asText(r.fullName),
        sort: (r) => asText(r.fullName),
      },
      {
        key: "commit",
        label: "commit",
        get: (r) => shortCommit(r.commit),
        sort: (r) => asText(r.commit),
      },
      {
        key: "analysisStatus",
        label: "status",
        get: (r) =>
          r.analysisStatus === "analyzed" ? "analyzed" : `failed: ${asText(r.analysisError)}`,
        sort: (r) => asText(r.analysisStatus),
      },
      {
        key: "tsSource",
        label: "ts src",
        get: (r) => signalNumber(r, "ts-file-count", (s) => s.byRole && s.byRole.source),
        sort: (r) => signalSort(r, "ts-file-count", (s) => s.byRole && s.byRole.source),
      },
      {
        key: "tsTest",
        label: "ts test",
        get: (r) => signalNumber(r, "ts-file-count", (s) => s.byRole && s.byRole.test),
        sort: (r) => signalSort(r, "ts-file-count", (s) => s.byRole && s.byRole.test),
      },
      {
        key: "effectFiles",
        label: "effect files",
        get: (r) => signalNumber(r, "files-using-effect-count", (s) => s.count),
        sort: (r) => signalSort(r, "files-using-effect-count", (s) => s.count),
      },
      {
        key: "effectImports",
        label: "effect imports",
        get: (r) => signalNumber(r, "effect-imports-per-file", (s) => s.importCount),
        sort: (r) => signalSort(r, "effect-imports-per-file", (s) => s.importCount),
      },
      {
        key: "packages",
        label: "packages",
        get: (r) => {
          const signal = signalOf(r, "effect-packages-used");
          return signal && Array.isArray(signal.packages) ? signal.packages.join(", ") : "";
        },
      },
      {
        key: "recordedAt",
        label: "recorded",
        get: (r) => isoDate(r.recordedAt),
        sort: (r) => asText(r.recordedAt),
      },
    ],
  });

  // ---------------------------------------------------------------------
  // run-summary.jsonl: RunSummary (src/domain/run-summary.ts) — one
  // population snapshot per run ("out of the analysed repos, the adopters").
  // ---------------------------------------------------------------------
  Viz.registerRecordType("run-summary", {
    label: "run summary",
    test: (record) => "population" in record && "deepAnalysis" in record,
    columns: [
      {
        key: "recordedAt",
        label: "run",
        get: (r) => isoDate(r.recordedAt),
        sort: (r) => asText(r.recordedAt),
      },
      {
        key: "analyzedRepos",
        label: "analysed",
        get: (r) => asText(r.population && r.population.analyzedRepos),
        sort: (r) => Number(r.population && r.population.analyzedRepos),
      },
      {
        key: "cloneFailures",
        label: "clone failures",
        get: (r) => asText(r.population && r.population.cloneFailures),
        sort: (r) => Number(r.population && r.population.cloneFailures),
      },
      {
        key: "adopters",
        label: "adopters",
        get: (r) => asText(r.population && r.population.adopters),
        sort: (r) => Number(r.population && r.population.adopters),
      },
      {
        key: "adopterRatio",
        label: "adopter %",
        get: (r) => percent(r.population && r.population.adopterRatio),
        sort: (r) => Number(r.population && r.population.adopterRatio),
      },
      {
        key: "analyzedAdopters",
        label: "analysed adopters",
        get: (r) => asText(r.deepAnalysis && r.deepAnalysis.analyzedAdopters),
        sort: (r) => Number(r.deepAnalysis && r.deepAnalysis.analyzedAdopters),
      },
      {
        key: "codeUsage",
        label: "with code usage",
        get: (r) => asText(r.deepAnalysis && r.deepAnalysis.adoptersWithCodeUsage),
        sort: (r) => Number(r.deepAnalysis && r.deepAnalysis.adoptersWithCodeUsage),
      },
      {
        key: "codeUsageRatio",
        label: "code usage %",
        get: (r) => percent(r.deepAnalysis && r.deepAnalysis.codeUsageRatio),
        sort: (r) => Number(r.deepAnalysis && r.deepAnalysis.codeUsageRatio),
      },
    ],
  });

  // ---------------------------------------------------------------------
  // effect-repos.jsonl: EffectRepoState (src/domain/effect-repo.ts)
  // ---------------------------------------------------------------------
  Viz.registerRecordType("effect-repo", {
    label: "effect repo (analysis input)",
    test: (record) =>
      typeof record.defaultBranch === "string" &&
      typeof record.commit === "string" &&
      !("cloneStatus" in record),
    columns: [
      { key: "repoId", label: "id", get: (r) => asText(r.repoId), sort: (r) => Number(r.repoId) },
      {
        key: "fullName",
        label: "repository",
        get: (r) => asText(r.fullName),
        sort: (r) => asText(r.fullName),
      },
      {
        key: "defaultBranch",
        label: "branch",
        get: (r) => asText(r.defaultBranch),
        sort: (r) => asText(r.defaultBranch),
      },
      {
        key: "commit",
        label: "commit",
        get: (r) => shortCommit(r.commit),
        sort: (r) => asText(r.commit),
      },
      {
        key: "recordedAt",
        label: "recorded",
        get: (r) => isoDate(r.recordedAt),
        sort: (r) => asText(r.recordedAt),
      },
    ],
  });

  // ---------------------------------------------------------------------
  // repos.jsonl: GithubRepo crawl cache (src/domain/github.ts) — the few
  // fields worth showing; the full record is in the detail panel.
  // ---------------------------------------------------------------------
  Viz.registerRecordType("github-repo", {
    label: "crawled repository",
    test: (record) =>
      typeof record.stargazersCount === "number" && typeof record.fullName === "string",
    columns: [
      { key: "id", label: "id", get: (r) => asText(r.id), sort: (r) => Number(r.id) },
      {
        key: "fullName",
        label: "repository",
        get: (r) => asText(r.fullName),
        sort: (r) => asText(r.fullName),
      },
      {
        key: "stargazersCount",
        label: "stars",
        get: (r) => asText(r.stargazersCount),
        sort: (r) => Number(r.stargazersCount),
      },
      {
        key: "language",
        label: "language",
        get: (r) => asText(r.language),
        sort: (r) => asText(r.language),
      },
      {
        key: "pushedAt",
        label: "pushed",
        get: (r) => isoDate(r.pushedAt),
        sort: (r) => asText(r.pushedAt),
      },
    ],
  });

  // ---------------------------------------------------------------------
  // Unknown records: raw JSON, one row per record. This is the fallback
  // for records added to the pipeline before the viewer knows about them.
  // ---------------------------------------------------------------------
  Viz.registerRecordType("unknown", {
    label: "unknown record",
    test: () => false, // never matches during detection; used as the fallback key
    columns: [{ key: "raw", label: "raw JSON", get: (r) => JSON.stringify(r).slice(0, 160) }],
  });
})();
