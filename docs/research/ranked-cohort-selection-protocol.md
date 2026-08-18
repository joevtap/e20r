# Ranked Cohort Selection Protocol

This protocol constructs a reproducible popularity-ranked cohort of open-source TypeScript repositories that satisfy e20r's required Effect-adoption signals.

## Population and endpoint

Use GitHub REST API version `2026-03-10` and `GET /search/repositories`. This is repository metadata search, not `GET /search/code` and not the unfiltered `GET /repositories` listing.

The initial population is public, non-fork, non-archived repositories whose GitHub primary language is TypeScript. Preserve the exact query, sort and order, API version, authentication visibility, retrieval times, pages, and raw response completeness indicators.

Alternative populations, including archived repositories, forks, non-TypeScript-primary repositories, and different license policies, require separately named cohort specifications and Ranking Snapshots.

## Ranking Snapshot

The Ranking Snapshot is a bounded observation window rather than an atomic view of GitHub. Record:

- Snapshot start and end time.
- Every request and response retrieval time.
- Immutable GitHub repository ID.
- Snapshot `owner/name`, stars, forks, primary language, visibility, fork flag, archive flag, and default branch.
- Default-branch head commit when resolution succeeds, plus every resolution attempt, observation time, API provenance, and failure for each candidate in the Evaluated Frame.
- Search partition, page, deterministic rank, and duplicate-resolution history.
- Snapshot-level incompleteness and protocol deviations.

Rank snapshot observations by stars descending, forks descending, then normalized canonical `owner/name` ascending. Normalize GitHub owner and repository names to ASCII lowercase and compare UTF-8 bytes; use immutable repository ID ascending only if normalized names are identical. Deduplicate by immutable repository ID using its earliest successfully retrieved snapshot observation for ranking, while preserving every later duplicate observation and discrepancy as history. Preserve a later acquisition name separately when a repository was renamed or transferred. Mutable acquisition-time metadata is validity context and never reorders the frozen snapshot.

The Analysis Checkout must acquire the exact recorded default-branch head commit. Clone completion does not qualify or select the candidate. A missing repository, inaccessible commit, or failed acquisition quarantines it.

## Search partitioning

GitHub repository search exposes at most 1,000 results per query. Begin with descending star ranges and recursively split any range whose accessible count exceeds 1,000. Preserve query text, range, pages, `total_count`, `incomplete_results`, and retrieval times.

An incomplete partition that could alter ordering or the cutoff prevents publication of an unqualified top-cohort claim. If any exact star group preceding or intersecting the Evaluated Frame exceeds 1,000 accessible results, use a documented alternative source that completely enumerates that group or stop. Do not use secondary tie-breakers to discard inaccessible equal-star candidates.

## Selection and stopping

The base target `N` is configurable and defaults to 100.

Process candidates in deterministic rank order through the pinned required selection Probes:

1. Snapshot population signals.
2. Exact-commit shallow checkout acquisition.
3. Complete local libre-license verification.
4. Direct `dependencies.effect` declaration.
5. Verified qualifying Effect use in the same Package Boundary.

A candidate counts toward `N` when every required selection rule passes. Exhaustive descriptive probing runs for analysis and does not gate cohort membership.

When the `N`th selected candidate establishes cutoff star count `S`, finish every remaining candidate with exactly `S` snapshot stars. Include every qualifier, so the Selected Cohort may exceed `N`. Stop before candidates with fewer than `S` stars.

## Quarantine and publication

Evaluation may continue while a higher-ranked candidate is quarantined. The cutoff remains provisional and is recomputed if that quarantine resolves.

Before publication, unresolved candidates above or within the final cutoff group prevent an unqualified claim that the cohort is the top qualifying cohort. Either resolve them through bounded retries and policy-governed review or publish an explicit protocol deviation describing the resulting uncertainty.

License review follows the pinned Libre-License Evidence Policy. It may add reviewed evidence or a versioned policy entry, then recompute selection. It may not directly override a candidate outcome.

Publication creates an immutable cohort revision pinning the Ranking Snapshot, Signal and Probe Catalogs, selection and license policies, final Cohort Selection Decisions, unresolved deviations, and inclusion flow. Later retry or review results create a new cohort revision.

## Inclusion-flow accounting

Preserve one record for every candidate encountered through the completed cutoff group:

- Deterministic rank and snapshot metadata.
- Snapshot and acquisition identities, commit-resolution attempts, and exact commit when resolved.
- Cohort Selection Decision outcome: selected, rejected, or quarantined.
- Evaluation status: pending, in-progress, complete, or not-evaluated.
- Acquisition status and Probe execution states, including failure and `not-probed`.
- Ordered reason slugs.
- Linked Probe Attempts and Cohort Selection Decisions.
- Retry and superseded-decision history.

Report counts for each state and reason. Do not merge quarantine with confirmed rejection or treat unattempted work as absence.

## Strata

Effect version, host runtime, package manager, repository size, and similar properties are derived analysis strata after selection. The initial cohort reserves no quotas for them. A quota-based comparative sample requires a separately named stratified cohort and must not be presented as the popularity-ranked cohort.
