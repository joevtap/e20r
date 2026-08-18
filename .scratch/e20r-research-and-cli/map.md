# Chart the e20r Research Protocol and CLI

Label: wayfinder:map

## Destination

A decision-complete MSR research protocol for studying Effect adoption in open-source software and an aligned e20r CLI specification, ready to split into implementation tickets and execute incrementally.

## Notes

- Planning only: this map decides the protocol and product route; implementation belongs to the subsequent handoff.
- Consult `CONTEXT.md` for canonical evidence and study vocabulary.
- Use `effect-ts`, `grilling`, and `domain-modeling` when resolving design tickets; use `prototype` for concrete report or workflow artifacts.
- Repository collection records evidence and provenance. Study analysis derives classifications and findings later.
- Begin with synthetic single-package fixtures, then a real leaf repository, then `anomalyco/opencode`, then introduce SQLite-backed batch execution.
- `.repos/` is development-only reference material, never e20r's runtime Analysis Checkout location.
- Prior retained decisions cover clone depth, clone-backed local probing, GitHub API operating constraints, SQLite as eventual durable working state, and independently invocable pipeline commands. Clone completion never implies selection.
- `docs/research/opencode-first-e20r-subject.md` records the bounded OpenCode reconnaissance.

## Decisions so far

<!-- Closed ticket resolutions are indexed here by name. -->

- [Define the Initial Signal Ledger and Probing Protocol](issues/01-define-initial-evidence-report.md) - progressively select candidates with ordered existence probes, then exhaustively collect a flat provenance-bearing signal ledger; cloning acquires evidence but never marks selection.

- [Define Package-Boundary and Workspace Discovery](issues/02-define-package-boundary-discovery.md) - discover valid manifests repository-wide, assign sources to their nearest valid boundary, and record bounded workspace-selection evidence separately from derived membership and qualification.

- [Catalog Host-Runtime Evidence](issues/03-catalog-host-runtime-evidence.md) - collect explicit, provenance-rich host and provider signals independently; shared APIs and tooling remain weak, and runtime classification happens later.

- [Define the Libre-License Evidence Policy](issues/04-define-libre-license-policy.md) - all applicable local license evidence must be allowlisted; any confirmed non-libre term rejects, while unresolved evidence is quarantined.

- [Define Ranked Cohort Selection](issues/05-define-ranked-cohort-selection.md) - rank a bounded repository-metadata snapshot, select default N=100 through required signals, complete the cutoff star group, and preserve exact commits and full inclusion-flow accounting.

## Not yet specified

- The Effect feature and coding-pattern taxonomy, extraction method, and prevalence measures. This becomes specifiable after representative v3, v4 beta, and v4 stable source evidence exists.
- Selection criteria and detailed traversal method for the later two-or-three-repository longitudinal adoption study. This becomes specifiable after cross-sectional evidence reveals suitable cases.
- Stable end-user report commands and Effect AI query tools. These become specifiable after repeated Study Analysis queries expose durable concepts.
- Exact support order for host runtimes beyond the initial Node.js fixture.

## Out of scope

- Implementing the collector, persistence layer, batch pipeline, or study while this planning map is active.
- Exact lockfile resolution of installed Effect versions in the initial study; preserve declared Effect specifiers verbatim instead.
- Treating `.repos/` as runtime storage.
- Building the later Effect AI results agent as part of the initial CLI specification.
- Collecting or interpreting Turborepo, Nx, Lerna, Rush, or other monorepo-engine configuration.
- Workspace-mechanism expansion beyond `package.json#workspaces`, `pnpm-workspace.yaml`, Yarn-specific edge cases, and nested or multiple workspace roots.
