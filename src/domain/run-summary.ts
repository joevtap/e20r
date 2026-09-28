import { Schema } from "effect";

/**
 * A snapshot of the pipeline population at the end of one run: how many
 * repositories were analyzed, how many of them are Effect adopters, and how
 * deep the adoption goes. This is population-level information, so it lives
 * in its own record instead of being duplicated onto per-repository signals.
 *
 * The counts describe the population this tool can see — the top-N TypeScript
 * repositories of the GitHub crawl, not GitHub at large — which is what
 * `context` records. Records are appended to `run-summary.jsonl`, one per
 * run, so the ratio is preserved per run and can be trended over time.
 */
export const RunSummarySchema = Schema.Struct({
  recordedAt: Schema.DateTimeUtcFromString,

  /** The clone-and-select population: every repository with a recorded clone. */
  population: Schema.Struct({
    analyzedRepos: Schema.Finite,
    cloneFailures: Schema.Finite,
    adopters: Schema.Finite,
    /** adopters / analyzedRepos; 0 when nothing was analyzed. */
    adopterRatio: Schema.Finite,
  }),

  /** The deep-analysis population: the adopters that got usage analysis. */
  deepAnalysis: Schema.Struct({
    analyzedAdopters: Schema.Finite,
    /** Adopters whose source tree actually imports Effect. */
    adoptersWithCodeUsage: Schema.Finite,
    /** adoptersWithCodeUsage / analyzedAdopters; 0 when nothing was analyzed. */
    codeUsageRatio: Schema.Finite,
  }),

  /** What the population even means: how the repositories were selected. */
  context: Schema.Struct({
    repoSearchBudget: Schema.Finite,
    fromCache: Schema.Boolean,
    fresh: Schema.Boolean,
    ephemeral: Schema.Boolean,
  }),
});

export type RunSummary = Schema.Schema.Type<typeof RunSummarySchema>;
