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
