# Effect Adoption Analysis

This context defines the units used to study Effect adoption in open-source TypeScript repositories and to describe the evidence collected by e20r.

## Language

**Sampled Repository**:
A repository selected as one observation in the ranked study cohort. Packages and source files within it provide nested evidence rather than independent repository observations.
_Avoid_: Effect project, project

**Package Boundary**:
A directory represented by a package manifest whose dependency declarations and source evidence are evaluated together, including package boundaries nested within a monorepo.
_Avoid_: Workspace, subproject

**Workspace Selection Evidence**:
An observed match between a package boundary and a recognized workspace declaration. It identifies the declaring root, mechanism, and matched pattern without asserting that the configuration was active.
_Avoid_: Workspace membership, package boundary

**Workspace Membership**:
A Study Analysis conclusion that a package boundary belongs to an active workspace configuration. Membership is derived independently and is not required for the package boundary's Effect evidence to qualify its repository.
_Avoid_: Workspace selection evidence, package boundary, monorepo package

**Qualified Repository**:
A candidate repository that passes every pinned population, libre-license, and Effect-adoption selection rule, including a Package Boundary with Effect declared directly in `dependencies` and verified Effect usage in eligible source files owned by that boundary.
_Avoid_: Effect repository, Effect user

**Ranking Snapshot**:
A bounded, non-atomic observation of candidate repository metadata and default-branch commits, ranked by observed stars descending, forks descending, then canonical repository name ascending, with retrieval provenance for every observation.
_Avoid_: Current ranking, top repositories

**Evaluated Frame**:
The Ranking Snapshot candidates examined through the completed cutoff star group when constructing one cohort revision, including selected, rejected, quarantined, and unevaluated candidates needed for inclusion-flow accounting.
_Avoid_: Selected cohort, ranking snapshot

**Selected Cohort**:
The Qualified Repositories included by one versioned cohort-selection policy, comprising the configured base target and every additional qualifier in the cutoff star group.
_Avoid_: Evaluated frame, all candidates, current top repositories

**Signal**:
A cataloged kind of repository evidence with a stable human-readable slug and description, observed for a specific domain subject and normalized value.
_Avoid_: Probe, match, classification

**Signal Observation**:
The outcome of observing one Signal for a domain subject, scoped to either a Ranking Snapshot candidate or a recorded repository revision, including its value and provenance locations when present.
_Avoid_: Signal definition, probe result, finding

**Probe**:
A cataloged evidence-gathering operation that searches a declared scope and emits Signal Observations. A Probe may use textual matches as candidates, but only verified evidence establishes a present Signal.
_Avoid_: Signal, study analysis

**Cohort Selection Decision**:
A Study Analysis record that applies a versioned selection policy to Signal Observations and Probe outcomes for one candidate, producing a provisional or final selected, rejected, or quarantined outcome with explicit reasons.
_Avoid_: Signal, probe result

**Repository Report**:
A derived human-readable view of Signal Observations and Probe outcomes for one sampled repository. It is not the canonical Evidence Collection representation.
_Avoid_: Signal ledger, analysis result, classification

**Analysis Checkout**:
A runtime-managed clone of a candidate or Sampled Repository at a recorded revision, used for local probing and analysis outside the development-only `.repos/` reference directory. Creating it does not imply that the candidate qualifies or has been selected.
_Avoid_: Reference repository, fixture repository

**Analysis Fixture**:
A synthetic, single-package repository used to establish deterministic analyzer behavior before testing real repositories and monorepos. It is test evidence, not a member of the study cohort.
_Avoid_: Sampled repository, example project

**Declared Effect Specifier**:
The dependency value written for `effect` in a package boundary's `dependencies`, preserved verbatim whether it is a semver range, exact version, catalog reference, or workspace protocol.
_Avoid_: Effect version, resolved version

**Host Runtime**:
A JavaScript execution environment evidenced within a sampled repository, such as Node.js, Bun, Deno, a browser, or an edge platform. A repository may use more than one.
_Avoid_: Runtime, Effect runtime

**Evidence Collection**:
The deterministic probing process that emits provenance-bearing Signal Observations without assigning study-level categories or drawing findings.
_Avoid_: Analysis, classification

**Study Analysis**:
The later derivation of classifications, metrics, comparisons, and findings from collected repository evidence.
_Avoid_: Repository scan, evidence collection

**Effect-Using Source File**:
A source file containing verified use of an Effect package import, associated with its nearest package boundary.
_Avoid_: Matching file, Effect file

**Effect Usage Occurrence**:
A statically identified instance of an Effect feature or coding pattern within an Effect-using source file.
_Avoid_: Match, hit
