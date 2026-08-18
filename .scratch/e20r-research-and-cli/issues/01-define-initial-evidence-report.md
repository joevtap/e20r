# Define the Initial Signal Ledger and Probing Protocol

Type: grilling
Status: resolved

## Question

What flat signal ledger, ordered probing protocol, and synthetic fixture matrix can progressively select a target cohort while preserving complete provenance and keeping qualification in Study Analysis?

## Answer

Replace the nested Repository Report as the canonical Evidence Collection output with a versioned, flat Signal Ledger. Pre-clone metadata observations are scoped to a Ranking Snapshot candidate; local observations are additionally scoped to the recorded repository revision. Every observation identifies its domain subject, signal slug, outcome, and normalized value when present. A present signal may aggregate many provenance locations. Attempted probes also preserve detector version, searched scope, exclusions, completeness, and execution outcome so absence remains distinguishable from incomplete or unrun work.

Use a pinned Signal Catalog and Probe Catalog. Every signal and probe has a stable human-readable slug and description. The catalogs define subject kinds, values, dependencies, scientific and selection roles, execution priority, supported existence/exhaustive modes, and outcome semantics. A run is complete relative to its pinned catalog version; catalog changes produce a new version. This ticket fixes the semantic records and initial entries; the durable storage schema remains for **Design Durable Local State and Checkout Lifecycle**.

Candidate evaluation is progressive and signal-bounded. Walk the Ranking Snapshot in order, run cheap metadata probes, shallow-clone candidates that remain eligible, then run local probes in this order: libre-license eligibility, direct `dependencies.effect` declaration, and verified Effect use in an eligible source file belonging to the same Package Boundary. **Shallow cloning is only an evidence-acquisition step; it never qualifies or selects a repository.** A repository enters the cohort only after all required signal rules pass. Clone failure quarantines the candidate, while local probes after cloning may still reject or quarantine it.

Existence mode stops only after enough verified evidence to decide a required rule. License verification still examines its complete configured scope because one disallowed item is decisive. Effect qualification searches declaration-bearing Package Boundaries until one boundary has both direct declaration and verified use; failure in the first boundary does not reject while another candidate boundary remains. Confirmed absence rejects immediately and records later probes as `not-probed`; failed or indeterminate work quarantines the candidate and remains retryable. Missing or unresolved license evidence is quarantined, while confirmed non-libre evidence rejects. Continue down the Ranking Snapshot until the configurable cohort rule from **Define Ranked Cohort Selection** is satisfied.

After required selection signals pass, exhaustive probes support analysis but do not gate cohort membership. Exhaustive probing records all provenance-bearing evidence for revision, Package Boundaries, Effect declarations and imports, package-manager and workspace signals, host runtimes, eligible and excluded source files, license evidence, and incomplete work. Failed or incomplete exhaustive collection remains missing-data and validity evidence without invalidating verified selection Signals.

Text scanners such as ripgrep generate candidate occurrences only. A signal-specific structural detector must verify a candidate before the signal becomes present. Package Boundaries and source files remain domain subjects referenced by flat observations; qualification is a rule over signals, never a scanner-emitted `qualified` signal.

Qualifying source use includes structurally verified imports, exports, and dynamic imports of `effect`, `effect/*`, or `@effect/*`, including type-only imports. It excludes comments and plain strings. Only tracked `.ts`, `.tsx`, `.mts`, and `.cts` files owned by the declaration-bearing Package Boundary through nearest-valid-manifest ownership may qualify; declaration files, generated output, vendored code, fixtures, examples, benchmarks, and tests remain descriptive evidence only.

The semantic records, ordered initial catalogs, and synthetic fixture matrix are defined in [Initial Signal and Probe Catalog](../../../docs/research/initial-signal-and-probe-catalog.md). Exact target size, star-tie completion, optional strata, and ranking accounting remain owned by **Define Ranked Cohort Selection**.
