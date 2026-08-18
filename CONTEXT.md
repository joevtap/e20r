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
A sampled repository that contains at least one package boundary with Effect declared directly in `dependencies` and verified Effect usage in eligible source files.
_Avoid_: Effect repository, Effect user

**Ranking Snapshot**:
The candidate ordering observed at a recorded time, ranked by stars descending, forks descending, then canonical repository name ascending.
_Avoid_: Current ranking, top repositories

**Repository Report**:
The collected evidence for one sampled repository, containing dependency specifiers, package-manager signals, host-runtime signals, source-file inventories, and their provenance. Scientific classifications and aggregate findings are derived later.
_Avoid_: Analysis result, classification

**Analysis Checkout**:
A runtime-managed clone of a sampled repository at a recorded revision, stored outside the development-only `.repos/` reference directory.
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
The deterministic repository pass that records observed values, files, signals, and provenance without assigning study-level categories or drawing findings.
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
