# Define Ranked Cohort Selection

Type: grilling
Status: resolved
Blocked by: 04

## Question

What reproducible protocol should enumerate public, non-fork, non-archived, TypeScript-primary GitHub candidates by a recorded ranking snapshot; shallow-clone and locally qualify them; include the full star tie group crossing configurable N; and account for failures, exclusions, optional broader populations, and optional stratified quotas?

## Answer

Build a bounded Ranking Snapshot with GitHub's repository metadata search endpoint, `GET /search/repositories`, never code search or the unfiltered public-repository listing endpoint. Search public, non-fork, non-archived, TypeScript-primary repositories and rank immutable snapshot observations by stars descending, forks descending, then canonical repository name ascending.

Use a configurable base target `N`, default 100. Evaluate candidates in deterministic rank order through the required signal-based selection protocol. A repository counts as selected as soon as all required selection probes pass; exhaustive descriptive probing belongs to subsequent analysis and does not gate cohort membership. Once the `N`th selected repository establishes cutoff star count `S`, finish every remaining candidate with exactly `S` snapshot stars and include every one that qualifies. Do not evaluate lower star groups.

Preserve one inclusion-flow record for every candidate encountered through the completed cutoff group. Keep selected/rejected/quarantined decision outcome separate from evaluation, acquisition, and Probe execution status; record ordered reason slugs and linked Probe Attempts. Evaluation may continue below a quarantined candidate for operational progress, but unresolved candidates above or within the final cutoff group prevent an unqualified claim that the published cohort is the top qualifying cohort unless recorded as an explicit protocol deviation.

Repository search is capped at 1,000 accessible results per query. Enumerate descending star ranges and recursively split ranges that exceed the cap, preserving every query, partition, page, count, response time, and incompleteness indicator. If any exact star group preceding or intersecting the Evaluated Frame exceeds the accessible cap, final publication requires a documented alternative complete enumeration source; forks and names must not silently discard inaccessible tie members.

The Ranking Snapshot is a bounded, non-atomic observation window. Record its start and end time and each response's retrieval time. Deduplicate by immutable GitHub repository ID, use the earliest successfully retrieved observation for ranking, and preserve later duplicates plus snapshot and acquisition names across transfers. Snapshot metadata governs ranking and population eligibility even if mutable fields later change. Normalize canonical names to ASCII lowercase and compare UTF-8 bytes for the final ordering key.

For every candidate in the Evaluated Frame, attempt to resolve and record the observed default branch and its head commit with timestamp and API provenance before cloning. The Analysis Checkout must use that exact commit when resolution succeeds. Unavailable repositories or commits retain the failed attempt and are quarantined; their inclusion-flow records do not invent a commit. Clone completion remains evidence acquisition, never selection.

Before publication, allow bounded operational retries and license review governed by the pinned Libre-License Evidence Policy. Reviews add evidence or versioned policy entries and trigger recomputation; they never override selection ad hoc. Publication pins a cohort revision containing the Ranking Snapshot, catalogs, policies, final decisions, unresolved deviations, and inclusion flow. Later changes create a new cohort revision.

Archived, fork, non-TypeScript-primary, alternate-license, and stratified populations are not mixed into the initial cohort. Future studies may define separately named cohort specifications. Effect version, host runtime, package manager, and repository size are post-selection analysis strata, not quotas.

The complete protocol is documented in [Ranked Cohort Selection Protocol](../../../docs/research/ranked-cohort-selection-protocol.md).
