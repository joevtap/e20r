# Validate the Real-Repository Progression

Type: prototype
Status: resolved
Blocked by: 01, 02, 03

## Question

Which real leaf repository should follow the synthetic fixture, what evidence must it validate, and what bounded subset of package-boundary, workspace, catalog, package-manager, and multi-runtime behavior must the subsequent OpenCode prototype support before the evidence model is trusted?

## Answer

Use a strictly sequential three-stage evidence progression, after which durable-state design unlocks:

1. Synthetic single-package fixtures.
2. [`niklaserik/effect-mcp`](https://github.com/niklaserik/effect-mcp) at commit `5c6a0c76ca408a7d96dc98eb442f4b68aa659389`.
3. [`anomalyco/opencode`](https://github.com/anomalyco/opencode) at commit `9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a`.

Passing OpenCode unlocks **Design Durable Local State and Checkout Lifecycle**; SQLite design is not itself an evidence stage.

This progression is development-only validation scaffolding. It is not a final-tool workflow, command surface, runtime dependency, or bundled subject set. The shipped tool uses the validated Signal and Probe interfaces without exposing these stages to users.

Every stage emits the same Signal Ledger and Probe Attempt interface. Later repositories may add observations and provenance combinations but must not change signal identities, normalized values, subject keys, outcome semantics, provenance multiplicity, exclusion reasons, or stage-completeness rules. Detector internals may evolve.

The synthetic stage validates selection ordering, early stopping, same-boundary qualification, quarantine, multiple provenances, and stable Signal and Probe slugs.

The first real leaf is `niklaserik/effect-mcp`, a public, non-fork, non-archived, TypeScript-primary MIT repository with one Package Boundary, three TypeScript files, direct `effect` dependency `^3.14.11`, qualifying production imports, pnpm evidence, and affirmative Node script-invocation evidence. It must independently rerun the complete required selection protocol at its pinned commit, then emit the exact revision, complete local license evidence, Package Boundary, verbatim declaration, all qualifying import provenances, eligible and excluded files, package-manager and host-runtime signals, and complete Probe Attempts without unexplained required-Probe failures. It need not exercise workspaces, catalogs, or multiple host runtimes. See [effect-mcp as the First Real Leaf](../../../docs/research/effect-mcp-first-real-leaf.md).

The OpenCode stage must independently rerun required selection and validate only the first composition jump: repository-wide Package Boundaries, shared `package-json-workspaces` selection evidence versus out-of-workspace manifests, independent Bun package-manager evidence, verbatim `catalog:` declarations, same-boundary attribution across many packages, Bun/Node/browser/Electron host-runtime signals, explicit exclusions, and partial-Probe evidence. It does not need pnpm workspaces, Yarn-specific behavior, Deno, exhaustive edge-provider support, feature-pattern extraction, or lockfile resolution.

Preserve the leaf's Effect v3 `^3.14.11` and OpenCode's v4-beta `catalog:` specifiers verbatim. Version classification remains Study Analysis.

A stage advances only when every declared required check passes or a limitation has been documented with scope and rationale and then explicitly accepted by a human. Recording a limitation never approves itself. Unexplained required-Probe failure or evidence-interface drift blocks advancement.

The decision was validated in the throwaway [Real-Repository Progression prototype](../prototypes/real-repository-progression.html).
