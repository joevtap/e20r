# Implement the e20r Development Validation Progression

Status: ready-for-agent

## Problem Statement

e20r has a decision-complete semantic model for Signals, Probes, provenance, qualification, and ranked cohort selection, but those decisions have not yet survived real repository evidence. Designing durable SQLite state now would risk encoding an evidence shape that changes as soon as e20r encounters a real package, workspace, catalog declaration, or multi-runtime repository.

The project needs a development-only implementation slice that proves one stable `CandidateEvaluator` interface against synthetic repositories, a pinned small real repository, and pinned OpenCode. The progression must produce evidence for the next Wayfinder decision without becoming a shipped end-user workflow.

## Solution

Implement one high-level `CandidateEvaluator` module that accepts a candidate and a validated Evaluation Protocol, acquires the exact repository commit, runs the protocol's pinned Probe Catalog, and returns a flat Candidate Evaluation Result containing Signal Observations, occurrence provenance, Probe Attempts, selection decisions, completeness, exclusions, and sanitized typed diagnostics.

Validate that interface in three sequential development stages:

1. Deterministic synthetic Git repositories.
2. `niklaserik/effect-mcp` at commit `5c6a0c76ca408a7d96dc98eb442f4b68aa659389`.
3. `anomalyco/opencode` at commit `9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a`.

Expose generic manual validation through the specifically approved unsupported `e20r unstable validate repository` command. This is the sole product-facing exception in the evidence task and does not settle the later stable CLI. Keep the pinned progression in a separate development-only task-runner command so the subjects and progression gate do not become part of e20r's public product workflow.

## User Stories

1. As an e20r developer, I want one Candidate Evaluator interface, so that synthetic and real repositories exercise the same behavior.
2. As an e20r developer, I want repository inputs pinned to exact commits, so that validation is reproducible.
3. As an e20r developer, I want shallow checkout acquisition to remain separate from qualification, so that cloning never implies selection.
4. As an e20r developer, I want every Signal and Probe identified by its pinned catalog slug and version, so that evidence meaning cannot drift silently.
5. As an e20r developer, I want present Signals to aggregate multiple provenance locations, so that repeated evidence is complete without duplicate observations.
6. As an e20r developer, I want absent, indeterminate, failed, and not-probed work distinguished, so that missing evidence is not misclassified.
7. As an e20r developer, I want required Probes ordered for early rejection, so that expensive source scanning is skipped when license or dependency evidence already disqualifies a candidate.
8. As an e20r developer, I want license verification to inspect its complete configured scope, so that a permissive root license cannot hide non-libre nested terms.
9. As an e20r developer, I want Package Boundaries discovered repository-wide, so that out-of-workspace manifests remain observable.
10. As an e20r developer, I want source files assigned to their nearest valid Package Boundary, so that nested packages cannot be falsely joined.
11. As an e20r developer, I want malformed manifests and unreadable files recorded as scoped failures, so that collection can remain auditable.
12. As an e20r developer, I want Effect declarations preserved verbatim, so that semver ranges and `catalog:` references are not prematurely resolved.
13. As an e20r developer, I want structurally verified Effect imports, exports, and dynamic imports, so that textual false positives cannot qualify repositories.
14. As an e20r developer, I want qualifying source restricted to tracked production TypeScript, so that tests, examples, fixtures, generated output, declarations, benchmarks, and vendored code cannot establish qualification.
15. As an e20r developer, I want direct declaration and verified use joined within one Package Boundary, so that evidence from unrelated packages cannot qualify a repository.
16. As an e20r developer, I want selection probing separate from exhaustive analysis probing, so that descriptive missingness does not change cohort membership.
17. As an e20r developer, I want package-manager evidence independent from workspace selection, so that shared workspace syntax is not mislabeled as Bun, npm, or Yarn ownership.
18. As an e20r developer, I want host-runtime Signals emitted from versioned rules, so that runtime evidence remains observation rather than classification.
19. As an e20r developer, I want synthetic fixtures to exercise early stopping, quarantine, same-boundary joins, multiple provenance, and failures, so that the evaluator is deterministic before network validation.
20. As an e20r developer, I want the pinned `effect-mcp` stage to verify one real Package Boundary, all three Effect-using source files, pnpm evidence, MIT evidence, and affirmative Node invocation, so that real-world noise is introduced gradually.
21. As an e20r developer, I want the pinned OpenCode stage to verify many boundaries, shared workspace selection, out-of-workspace manifests, Bun package-manager evidence, catalog declarations, Node.js/Bun runtime evidence, and a complete Host Runtime Probe with no Deno observations, so that the evidence interface survives composition.
22. As an e20r developer, I want stage checks to be machine-readable, so that a stage cannot pass by clicking or declaring success without evidence.
23. As an e20r developer, I want unexplained required-Probe failures to block advancement, so that incomplete qualification cannot be accepted accidentally.
24. As a human reviewer, I want every accepted limitation to contain scope and rationale and require separate approval, so that limitations cannot approve themselves.
25. As an e20r developer, I want evidence-interface drift to block the progression, so that SQLite is designed only after the same shape survives all subjects.
26. As an e20r developer, I want successful OpenCode validation to unlock durable-state design, so that the Wayfinder map can resume with observed evidence.
27. As an e20r operator, I want an unsupported generic repository-validation command, so that I can manually inspect Candidate Evaluator behavior on arbitrary pinned repositories.
28. As an e20r operator, I want validation output as structured data with progress separated from results, so that manual and automated inspection remain composable.
29. As an e20r maintainer, I want the pinned progression excluded from the stable CLI, so that development scaffolding does not become a product promise.
30. As an e20r maintainer, I want temporary checkouts cleaned through scoped resource management, so that repeated validation does not leave unmanaged clones.
31. As an e20r maintainer, I want typed serializable errors at filesystem, Git, manifest, license, and source boundaries, so that failures can later be persisted without redesign.
32. As an e20r maintainer, I want the progression to emit a reviewable evidence summary, so that the Wayfinder task can be resolved with facts rather than implementation claims.

## Implementation Decisions

- `CandidateEvaluator` is the primary module and test seam. Its sole operation accepts a Candidate at Commit and a validated Evaluation Protocol, then returns one Candidate Evaluation Result. Callers cannot submit an arbitrary Probe order.
- A Candidate at Commit contains immutable GitHub repository ID when available, snapshot and current canonical names, remote URL, snapshot population metadata, observed default branch, exact target commit, and metadata provenance. Development subjects obtain this data from pinned checked-in protocol input rather than mutable hidden globals.
- An Evaluation Protocol contains schema and protocol version, Signal and Probe Catalog versions and digests, selection-policy version and digest, complete Libre-License Policy plus digest, pinned SPDX-list version, license-verifier version, configured evidence scope, Probe mode, and sanitized diagnostic policy. Construction validates catalog dependencies, mandatory Probes, ordering, and policy compatibility once before evaluation.
- The Candidate Evaluation Result contains only repository evidence: flat Signal Observations, occurrence provenance arrays, Probe Attempts, the derived Cohort Selection Decision, completeness by Probe and scope, exclusion reasons, and sanitized diagnostics.
- A separate Progression Result contains stage/check outcomes, links to Candidate Evaluation Results, schema-interface digest, limitations, human approvals, and SQLite-unlock state. Development progression concerns never appear in Candidate Evaluation Result.
- Pre-clone metadata observations are scoped to the candidate snapshot identity. Local observations are additionally scoped to the exact checked-out revision and repository-relative subject.
- Signal, Probe, provenance, attempt, decision, progression, limitation, and diagnostic records are defined with Effect Schema. Expected boundary failures use schema-backed tagged errors.
- Failures that occur after a Probe Attempt can be identified become auditable failed attempts and failed Signal Observations. Failures that prevent a valid Candidate Evaluation Result, such as invalid protocol input or inability to establish candidate identity, use the Effect error channel.
- Encoded diagnostics contain stable kind, operation, safe message, and sanitized context only. Raw foreign causes remain internal and are never serialized, logged, or attached to progression artifacts.
- Candidate evaluation is an Effect business operation. Filesystem, Git process execution, time, and network behavior are dependencies supplied through Effect services and composed layers at entry boundaries.
- Live layers use Node platform services. Test layers and temporary repositories are provided at the test boundary; business logic does not provide its own layers locally.
- Exact-commit acquisition uses a shallow checkout whenever Git can obtain the pinned commit without full history. Checkout lifecycle is scoped and ephemeral for this slice; durable caching and pruning remain deferred.
- Tracked Git files define the reproducible discovery universe. Untracked checkout residue and installed dependencies are not evidence.
- The implementation pins Signal/Probe Catalog `3-draft` and Host-Runtime Evidence Catalog `3-draft`. A semantic catalog change requires a version change and progression rerun.
- Required selection order is snapshot metadata, exact-commit acquisition, complete local license verification, direct `dependencies.effect`, then verified same-boundary source use.
- License verification implements the pinned Libre-License Evidence Policy, including complete configured scope, conservative expression aggregation, quarantine, exclusions, and auditable evidence.
- Package Boundary discovery and nearest-valid-manifest source ownership follow the settled Wayfinder decision. Workspace selection is emitted through the shared `package-json-workspaces` mechanism independently from package-manager Signals.
- Qualifying Effect use includes structurally verified imports, exports, and dynamic imports of `effect`, `effect/*`, and `@effect/*`, including type-only imports. Comments and plain strings do not count.
- Qualifying source candidates are tracked `.ts`, `.tsx`, `.mts`, and `.cts` production files. Declaration files, generated output, vendored code, fixtures, examples, benchmarks, and tests are excluded by stable reason slug.
- Text search may generate candidates for speed, but structural parsing is required before a Signal becomes present.
- Existence probing may stop after an existential qualification join is established. It must continue across declaration-bearing boundaries until one qualifies or every candidate boundary is exhausted.
- Exhaustive analysis probing records all supported descriptive evidence but does not gate selection. Its failures remain missing-data and validity evidence.
- Host Runtime collection is limited to Node.js, Bun, and Deno rules in Host-Runtime Evidence Catalog `3-draft`. The progression requires `node.script.invocation` for the leaf, `node.manifest.export_condition` and `bun.script.invocation` for OpenCode, and a complete Host Runtime Probe whose present observations contain no Deno rule. It emits observations and never a final runtime classification.
- Stage definitions are data. Each required check has a stable slug, executable predicate over evidence, expected subjects/values/cardinalities, required catalog/rule IDs, failure semantics, and linked evidence. Each result records pending, passed, failed, documented-limitation, or accepted-limitation status.
- Interface stability is checked with a deterministic digest of the encoded Candidate Evaluation Result schema and pinned Signal/Probe semantic definitions. Every stage must report the same digest.
- A limitation requires check identity, scope, rationale, downstream impact, approver, and approval time. A failed check cannot be converted into an accepted limitation implicitly.
- The progression runner is development-only and invoked through the project task runner. It contains pinned subjects and commits and is not reachable from the stable or unstable distributed command tree.
- The distributed CLI adds `e20r unstable validate repository --protocol <file>`. The validated protocol file contains candidate metadata, exact commit, catalogs, and policies required by Candidate Evaluator. The command is explicitly unsupported and may change; its handler delegates directly to Candidate Evaluator.
- The generic unstable command writes one structured result to stdout and progress or diagnostics to stderr. It must not log credentials, authorization headers, or unsanitized remote strings.
- The existing CLI entry remains the sole runtime boundary. Layer construction and command composition stay at that edge; command handlers do not own Git, filesystem, scanning, or policy logic.
- The development runner is named `pnpm validate:progression`. It overwrites one schema-versioned `progression-result.json` in the validation feature's tracker results directory, while preserving superseded reviewed results through Git history.
- The runner always writes a partial artifact once configuration has decoded. Exit code 0 means every stage passed or has separately accepted limitations; exit code 1 means evidence checks failed or remain unaccepted; exit code 2 means configuration failed before a trustworthy artifact could be produced.
- The progression artifact records protocol and catalog versions/digests, subject commits, schema-interface digest, check predicates and outcomes, linked evidence summaries, accepted limitations, and sanitized failures.
- No SQLite or durable cache is introduced in this slice. The observed result shape becomes input to the later durable-state Wayfinder decision.

## Testing Decisions

- Test external behavior through `CandidateEvaluator`; avoid tests that reach through it to individual scanners unless a parser has an independently meaningful pure contract.
- Add `@effect/vitest` at the exact installed Effect package version, a compatible Vitest 4 release, a `test` script that runs the suite once, and a focused-test script that forwards a file or name filter. Add test configuration only if defaults cannot express the setup.
- Prefer `it.effect` for evaluator behavior and layered test groups for shared service setup. Do not use plain async tests with manual Effect runtime execution.
- Build deterministic temporary local Git repositories at exact commits. These tests exercise acquisition, tracked-file inventory, cleanup, Package Boundary ownership, Probe ordering, and result assembly through the same seam.
- Cover the complete synthetic fixture matrix from Signal/Probe Catalog `3-draft`: missing and non-libre license, nested non-libre terms, missing declaration, missing use, cross-boundary false join, qualifying second boundary, nested ownership, excluded test-only use, multiple provenance, operational failure, early stopping, and exhaustive incompleteness.
- Assert externally visible Signal slugs, values, subjects, outcomes, provenance, Probe Attempt states, reason slugs, and selection decisions. Do not assert internal call structure beyond required ordering and early-stop behavior observable in attempts.
- Verify checkout cleanup on success, typed failure, and interruption.
- Verify malformed manifests, unreadable paths, unsupported workspace syntax, and parser failures remain distinguishable from confirmed absence.
- Verify package-manager and workspace observations remain independent.
- Verify host-runtime rules by their catalog IDs and exact provenance, including `node.script.invocation`.
- Verify accepted limitations require scope, rationale, and separate approval and cannot clear unexplained required-Probe failures.
- Verify interface-version mismatch blocks progression and successful OpenCode completion unlocks, but does not execute, durable-state design.
- Verify sanitized diagnostics never expose credentials embedded in URLs, authorization data, unsafe remote control characters, unmanaged absolute paths, or raw command invocations through stdout, stderr, result objects, or artifacts.
- Keep live `effect-mcp` and OpenCode validation outside the normal deterministic unit suite. Run it explicitly through the development task-runner command with network and Git access.
- Validate pinned real-subject expectations against exact commits and fail visibly if a commit is unavailable. Never fall forward to a branch head.
- Run typecheck, focused tests, lint, and formatting checks for every implementation ticket.

### Executable Stage Checks

| Check slug | Predicate and evidence requirement | Failure semantics |
| --- | --- | --- |
| `synthetic.required-ordering` | Probe Attempts show metadata, acquisition, complete license, declaration, and use prerequisites in catalog order, with later required Probes `not-probed` after decisive rejection. | Block on mismatch. |
| `synthetic.same-boundary-join` | Selection succeeds only when one Package Boundary has both direct declaration and qualifying source use; cross-boundary and nested-boundary fixtures reject. | Block on false join or false rejection. |
| `synthetic.outcome-semantics` | Fixture matrix produces distinct absent, indeterminate, failed, quarantined, and `not-probed` records plus multiple provenance on one present Signal. | Block on collapsed state. |
| `synthetic.interface-digest` | Candidate Evaluation Result schema and Signal/Probe semantic digest equals the progression baseline digest. | Block on drift. |
| `leaf.selection` | Pinned `effect-mcp` decision is selected with complete required Probe Attempts and no unexplained required-Probe failure. | Block unless a scoped limitation is separately approved. |
| `leaf.boundary-and-declaration` | Exactly one valid root Package Boundary emits direct Effect specifier `^3.14.11`. | Block on mismatch. |
| `leaf.source-provenance` | `source-file-uses-effect` observations cover exactly the three pinned tracked TypeScript source paths documented by reconnaissance, with occurrence provenance. | Block on missing or extra qualifying subject. |
| `leaf.tooling-and-runtime` | Package-manager observation is pnpm and host-runtime observation includes rule `node.script.invocation` for the application start script. | Block on missing rule evidence. |
| `leaf.interface-digest` | Encoded interface digest equals the synthetic baseline. | Block on drift. |
| `opencode.selection` | Pinned OpenCode decision passes all required selection rules with no unexplained required-Probe failure. | Block unless a scoped limitation is separately approved. |
| `opencode.boundaries` | More than one valid Package Boundary is observed, and at least one valid boundary is outside every Workspace Selection observation. | Block if repository-wide discovery or outsider evidence is absent. |
| `opencode.workspace-and-manager` | Workspace Selection uses `package-json-workspaces`; Bun appears independently as package-manager evidence. | Block if coupled or missing. |
| `opencode.catalog-declarations` | At least one direct Effect declaration preserves normalized value `catalog:` verbatim. | Block on resolution or loss. |
| `opencode.host-runtimes` | The complete Host Runtime Probe includes `bun.script.invocation` and `node.manifest.export_condition` at their owning subjects, has no present Deno-rule observation, and is neither `not-probed`, indeterminate, nor failed. | Block on missing Node.js/Bun evidence, any unexpected Deno evidence, or incomplete probing. |
| `opencode.partial-evidence` | At least one synthetic injected or naturally encountered partial-Probe case remains auditable without converting incompleteness to absence. | Block if partial state is lost. |
| `opencode.interface-digest` | Encoded interface digest equals the synthetic baseline. | Block on drift. |
| `progression.unlock` | All stage checks passed or hold limitations with scope, rationale, downstream impact, approver, and approval time; no failed required check remains. | Keep SQLite design locked otherwise. |

## Out of Scope

- Durable SQLite persistence, migrations, caching, invalidation, pruning, and resume state.
- Ranked GitHub cohort discovery and top-100 execution.
- Stable end-user collection, analysis, and reporting commands.
- Shipping the three-stage progression or its pinned repositories as product behavior.
- Bundling or copying `effect-mcp` or OpenCode into e20r.
- Lockfile resolution of installed Effect versions.
- Effect major-version classification and all aggregate Study Analysis.
- Feature and coding-pattern extraction.
- pnpm workspace and Yarn-specific support.
- Browser, Electron, and edge platform evidence or classification.
- Monorepo-engine interpretation.
- Historical or longitudinal repository analysis.
- Broad performance optimization beyond bounded candidate generation with structural verification.

## Further Notes

- This spec implements the evidence-producing Wayfinder task **Execute the Development Validation Progression**. It does not close the wider e20r research and CLI map.
- The pinned real repositories are development subjects. Their reconnaissance documents define expectations, but only evaluator output counts as progression evidence.
- The progression prototype is a decision artifact, not implementation code. Production behavior must be driven by evidence-backed check records rather than its UI controls.
- After completion, attach the progression result to the Wayfinder task and resume **Design Durable Local State and Checkout Lifecycle** using the observed cardinalities, failure shapes, provenance multiplicity, and checkout behavior.
