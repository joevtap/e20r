# Initial Signal and Probe Catalog

This planning artifact defines the first version of e20r's flat evidence representation and ordered probing protocol. Implementations may optimize detection internally, but a study run pins the catalog version and preserves the resulting observations and probe outcomes.

Catalog version: `3-draft`

This document fixes semantic records rather than a database or serialization schema. **Design Durable Local State and Checkout Lifecycle** owns the durable physical schema.

## Selection boundary

Candidate evaluation begins with the Ranking Snapshot and ends only when required signal rules accept, reject, or quarantine the candidate.

A shallow clone is an acquisition step within that evaluation. Clone completion does not mean the repository qualifies and does not place it in the selected cohort. Local license, Effect-declaration, and verified-usage probes all run after cloning and may reject or quarantine the candidate. Clone failure itself quarantines the candidate because required local evidence could not be collected.

The selector walks candidates in Ranking Snapshot order until the configurable cohort rule passes. Rejected and quarantined candidates do not count toward its base target. Exact target size, completion of a star-tie group crossing that target, optional strata, and inclusion-flow accounting remain decisions for **Define Ranked Cohort Selection**.

## Catalog records

Every Signal Definition contains:

- A stable human-readable `slug` and `description`.
- Its subject kind and normalized value shape.
- Its scientific role and whether a selection rule consumes it.
- The catalog version in which its meaning is fixed.

Every Probe Definition contains:

- A stable human-readable `slug` and `description`.
- Its explicit execution priority and prerequisites.
- Supported `existence` and `exhaustive` modes.
- Detector identity and version.
- Searched scope and exclusions.
- Signal slugs it may emit.

Signal slugs name evidence, while Probe slugs name evidence-gathering operations. A Probe may emit several Signals, and a Signal may be supported by several provenance locations.

## Initial signals

| Signal slug | Description | Subject | Normalized value | Scientific and selection role |
| --- | --- | --- | --- | --- |
| `repository-is-public` | GitHub reports that the candidate repository is publicly visible. | Repository | Boolean `true` | Population eligibility; required. |
| `repository-is-not-fork` | GitHub reports that the candidate repository is not a fork. | Repository | Boolean `true` | Population eligibility; required. |
| `repository-is-not-archived` | GitHub reports that the candidate repository is not archived. | Repository | Boolean `true` | Population eligibility; required. |
| `repository-is-typescript-primary` | GitHub reports TypeScript as the candidate repository's primary language. | Repository | Boolean `true` | Population eligibility; required. |
| `repository-revision` | Identifies the exact checked-out Git revision against which local Signals were observed. | Repository | Full Git object ID string | Reproducibility prerequisite, not qualification. |
| `license-evidence` | Records one applicable local license expression, file, manifest declaration, conflict, or manual-review result. | Repository or Package Boundary | Evidence kind, package scope, verbatim evidence or content-addressed preserved body, normalized SPDX expression when available, content hash, and review outcome | Input to required libre-license policy decision; occurrence provenance records path and source kind. |
| `package-boundary-is-valid` | A tracked, parseable package manifest establishes a Package Boundary. | Package Boundary | Manifest-relative path | Supports qualification joins and descriptive analysis. |
| `effect-is-direct-dependency` | A Package Boundary declares `effect` directly in `dependencies`. | Package Boundary | Verbatim Declared Effect Specifier | Required in at least one boundary. |
| `source-file-uses-effect` | An eligible source file structurally imports, exports from, or dynamically imports `effect`, `effect/*`, or `@effect/*`; type-only imports count while comments and plain strings do not. | Source file | Verbatim qualifying package specifier and syntax kind | Required in the same Package Boundary as the direct declaration. |
| `package-manager` | Records explicit package-manager evidence. | Repository or Package Boundary | Normalized manager slug and optional declared version | Descriptive. |
| `workspace-selection` | A recognized workspace declaration selects a valid Package Boundary. | Package Boundary | Declaring root, mechanism, pattern, and package path | Descriptive. |
| `host-runtime` | Records one deterministic Node.js, Bun, or Deno observation from Host-Runtime Evidence Catalog `3-draft`. | Repository, Package Boundary, or source file | Catalog and rule version, rule ID, named runtime, strength, normalized observed value, and evidence boundary | Descriptive; occurrence provenance records exact locations. |
| `source-file-is-eligible` | A tracked source file is included in the exhaustive source inventory. | Source file | Boolean `true` | Defines analysis denominator. |
| `source-file-is-excluded` | A tracked source file is excluded from analysis. | Source file | Normalized exclusion-reason slug | Defines analysis denominator and exclusions. |

Libre-license eligibility and repository qualification are versioned Selection Decisions over Signals, not Signals emitted by Probes. Operational acquisition, completeness, and `not-probed` state are Probe Attempt records rather than scientific Signals.

## Signal observations

One Signal Observation is identified by:

- Ranking Snapshot.
- Canonical repository.
- Recorded revision for local observations; pre-clone metadata observations are scoped to the Ranking Snapshot candidate record instead.
- Subject kind and stable repository-relative subject path.
- Signal slug.
- Normalized value when the outcome is `present`; non-present outcomes identify the attempted Signal without inventing a value.

Its outcome is `present`, `absent`, `indeterminate`, or `failed`. A present observation carries one or more occurrence provenances; repeated verified occurrences append provenance rather than duplicate the observation.

A Probe Attempt is the authoritative execution record. It stores Probe slug and version, candidate and optional revision, mode, observation time, searched scope, exclusions, completeness, execution state, diagnostics, and links to emitted Signal Observations. A failed attempt must emit one linked `failed` observation for each Signal and narrowest-known subject it could not determine; diagnostics live only on the linked attempt. When early rejection prevents later work, the selection trace records those Probes as `not-probed`; it does not invent absent Signals.

## Cohort selection decisions

A Cohort Selection Decision is a Study Analysis record derived from the Signal Ledger and Probe Attempts. It records the Ranking Snapshot and candidate, policy slug and version, `provisional` or `final` stage, `selected`, `rejected`, or `quarantined` outcome, referenced input observations and attempts, ordered reason slugs, and decision time. Evidence Collection never emits qualification or license-eligibility Signals.

Provisional selection means all required selection rules passed. Final selection means the candidate remains included after the cutoff star group and unresolved-ranking checks from **Define Ranked Cohort Selection** complete. Exhaustive descriptive Evidence Collection belongs to analysis and does not gate either decision; failures remain missing-data and validity records.

## Ordered existence probes

All initial detectors have detector version `1` within catalog `3-draft`.

| Priority | Probe slug | Description | Modes | Prerequisite; scope and exclusions | Emitted Signals and decision effect |
| --- | --- | --- | --- | --- | --- |
| 10 | `screen-public-repository` | Confirm from snapshot metadata that the candidate is public. | Existence, exhaustive | Ranking Snapshot candidate; metadata fields only | `repository-is-public`; absence rejects. |
| 20 | `screen-non-fork-repository` | Confirm that the candidate is not a GitHub fork. | Existence, exhaustive | Public screen passed; metadata fields only | `repository-is-not-fork`; absence rejects. |
| 30 | `screen-active-repository` | Confirm that the candidate is not archived. | Existence, exhaustive | Non-fork screen passed; metadata fields only | `repository-is-not-archived`; absence rejects. |
| 40 | `screen-typescript-primary` | Confirm that GitHub records TypeScript as the primary language. | Existence, exhaustive | Active screen passed; metadata fields only | `repository-is-typescript-primary`; absence rejects. |
| 50 | `acquire-shallow-checkout` | Acquire and identify the recorded revision for local probing. | Acquisition | Metadata screens passed; configured Analysis Checkout, excluding submodule contents | `repository-revision`; failure quarantines and success does not select. |
| 60 | `verify-libre-license` | Exhaustively evaluate all applicable local license evidence in the configured scope, even during selection. | Exhaustive only | Checkout acquired; all applicable tracked license files and manifests under the pinned policy exclusions | `license-evidence`; policy rejects confirmed non-libre evidence and quarantines missing or unresolved evidence. |
| 70 | `find-direct-effect-declaration` | Find valid Package Boundaries with `effect` directly in `dependencies`. | Existence, exhaustive | License decision passed; tracked manifests excluding ineligible paths | `package-boundary-is-valid`, `effect-is-direct-dependency`; joined absence rejects. |
| 80 | `verify-effect-source-use` | Verify Effect use in declaration-bearing Package Boundaries, continuing until one joins or all fail. | Existence, exhaustive | At least one direct declaration; qualifying tracked source files whose nearest valid Package Boundary is that declaration-bearing boundary | `source-file-uses-effect`; joined absence rejects. |

Selection is a rule over the resulting Signals. The Effect rule is existential: at least one Package Boundary must have both a direct declaration and verified source use. No Probe emits `qualified` or `libre-license-eligible` as a Signal.

For qualification, source candidates are tracked `.ts`, `.tsx`, `.mts`, and `.cts` files. Declaration files, generated output, vendored code, fixtures, examples, benchmarks, and tests are excluded by normalized reason. Exhaustive probing may record Effect Signals in excluded files descriptively, but those Signals cannot satisfy the qualification rule.

## Exhaustive probes

After required selection signals pass, exhaustive analysis probing records:

- The exact repository revision.
- All valid Package Boundaries and package-boundary discovery failures.
- Every direct Effect declaration and its verbatim specifier.
- Every verified Effect import and occurrence provenance.
- Package-manager Signals.
- Workspace Selection Evidence.
- Host-runtime Signals from the pinned host-runtime catalog.
- Eligible and excluded source-file evidence and exclusion reasons.
- All applicable local license evidence.
- Probe failures, searched scopes, exclusions, and completeness.

| Priority | Probe slug | Description | Prerequisite; scope and exclusions | Emitted Signals |
| --- | --- | --- | --- | --- |
| 100 | `inventory-package-boundaries` | Enumerate every valid tracked package manifest and discovery failure. | Required selection passed; tracked repository paths under catalog exclusions | `package-boundary-is-valid` |
| 110 | `collect-effect-declarations` | Record every direct Effect declaration and verbatim specifier. | Boundary inventory; valid manifests | `effect-is-direct-dependency` |
| 120 | `collect-effect-source-use` | Record every structurally verified Effect import in eligible tracked source files. | Boundary inventory; source eligibility rules | `source-file-uses-effect` |
| 130 | `collect-package-manager-signals` | Record explicit package-manager declarations and artifacts. | Checkout; tracked manifests and recognized lockfile paths | `package-manager` |
| 140 | `collect-workspace-selection-signals` | Evaluate recognized workspace declarations against valid boundaries. | Boundary inventory; supported workspace mechanisms only | `workspace-selection` |
| 150 | `collect-host-runtime-signals` | Apply the pinned Host-Runtime Evidence Catalog. | Boundary and eligible-source inventories; catalog-specific exclusions | `host-runtime` |
| 160 | `inventory-source-files` | Record every eligible or explicitly excluded tracked source file. | Boundary inventory; tracked source candidates | `source-file-is-eligible`, `source-file-is-excluded` |

These Probes run in exhaustive mode with detector version `1`. The complete license evidence from priority 60 is reused rather than rescanned.

Text tools such as ripgrep may cheaply generate candidate occurrences. Candidates become present Signal Observations only after the responsible detector structurally verifies them.

If exhaustive probing fails or remains incomplete, preserve the failure and affected analysis scope without rewriting valid Signals or changing cohort membership.

## Synthetic fixture matrix

| Fixture | Behavior established |
| --- | --- |
| Missing license | License Probe quarantines before Effect Probes; later Probes are `not-probed`. |
| Confirmed non-libre license | Candidate is rejected before Effect Probes. |
| Permissive root with non-libre nested package | Complete-scope license probing finds the later disallowed evidence and rejects. |
| Libre without Effect declaration | License passes, declaration is absent, and usage is not probed. |
| Declaration without verified use | Declaration passes but same-boundary usage is absent, so the candidate is rejected. |
| Cross-boundary false positive | A declaration in one Package Boundary and usage in another do not jointly satisfy selection. |
| Nested-boundary ownership | A nested package's source is not attributed to a declaration in its ancestor Package Boundary. |
| Qualifying second boundary | Failed usage verification in the first declaration-bearing boundary does not reject before a later boundary satisfies both signals. |
| Test-only Effect use | Effect use found only in excluded tests is recorded descriptively but cannot qualify the repository. |
| Multiple verified occurrences | One present Signal/value aggregates multiple provenance locations. |
| Probe failure | Operational failure quarantines without converting incomplete work into absence. |
| Qualified existence pass | The first verified occurrence satisfies each required existence Probe and provisionally selects the repository. |
| Exhaustive incompleteness | Descriptive probing failure is retained as missing-data and validity evidence without invalidating verified selection Signals or cohort membership. |
| Complete selected repository | Exhaustive Probes preserve all descriptive evidence and provenance in flat observations. |
