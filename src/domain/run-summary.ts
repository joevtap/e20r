/**
 * A snapshot of the pipeline population at the end of one run: how many
 * repositories were probed, how many of them are Effect adopters, and how
 * deep the adoption goes. Stored as the `counts` of the run's row in `runs`,
 * so the ratios are preserved per run and can be trended over time (the
 * viewer's "Ratios over runs").
 *
 * The counts describe the population this tool can see — the top-N
 * TypeScript repositories of the GitHub crawl, not GitHub at large.
 */
export interface RunSummary {
  /** The selection population: every repository with a recorded state. */
  readonly population: {
    readonly analyzedRepos: number;
    readonly cloneFailures: number;
    readonly adopters: number;
    /** Adopters kept out of the deep analysis (Effect itself, copies, configured). */
    readonly excludedAdopters: number;
    /** adopters / analyzedRepos; 0 when nothing was probed. */
    readonly adopterRatio: number;
  };

  /** The deep-analysis population: the adopters that got usage analysis. */
  readonly deepAnalysis: {
    readonly analyzedAdopters: number;
    /** Adopters whose source tree actually imports Effect. */
    readonly adoptersWithCodeUsage: number;
    /** adoptersWithCodeUsage / analyzedAdopters; 0 when nothing was analyzed. */
    readonly codeUsageRatio: number;
  };
}

export interface RunSummaryCounts {
  readonly probed: number;
  readonly failed: number;
  readonly adopters: number;
  readonly excluded: number;
  readonly analyzed: number;
  readonly analyzedWithCodeUsage: number;
}

const ratio = (numerator: number, denominator: number): number =>
  denominator === 0 ? 0 : numerator / denominator;

/**
 * Builds the population summary of one run from the counts of the recorded
 * state. Ratios are derived here so they can never disagree with the counts.
 */
export const makeRunSummary = (counts: RunSummaryCounts): RunSummary => ({
  population: {
    analyzedRepos: counts.probed,
    cloneFailures: counts.failed,
    adopters: counts.adopters,
    excludedAdopters: counts.excluded,
    adopterRatio: ratio(counts.adopters, counts.probed),
  },
  deepAnalysis: {
    analyzedAdopters: counts.analyzed,
    adoptersWithCodeUsage: counts.analyzedWithCodeUsage,
    codeUsageRatio: ratio(counts.analyzedWithCodeUsage, counts.analyzed),
  },
});
