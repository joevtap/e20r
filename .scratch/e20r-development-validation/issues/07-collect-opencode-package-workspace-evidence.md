# 07 — Collect OpenCode Package and Workspace Evidence

**What to build:** Evaluate pinned OpenCode through repository-wide Package Boundary, workspace-selection, package-manager, and catalog-declaration behavior while preserving the established result interface.

**Blocked by:** 06 — Validate the Pinned effect-mcp Leaf

**Status:** ready-for-agent

- [ ] Acquire exact commit `9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a` through a shallow attempt whenever supported, record the strategy, and never use a later branch head.
- [ ] Independently run required metadata, license, declaration, and same-boundary source-use selection Probes.
- [ ] Discover every valid tracked Package Boundary repository-wide and retain malformed-manifest failures.
- [ ] Emit `package-json-workspaces` selection observations independently from package-manager evidence.
- [ ] Demonstrate at least one valid out-of-workspace Package Boundary with no Workspace Selection observation.
- [ ] Emit Bun package-manager evidence independently from Workspace Selection Evidence.
- [ ] Preserve at least one direct Effect declaration value `catalog:` verbatim without lockfile resolution.
- [ ] Preserve nearest-valid-boundary ownership across nested packages and prevent cross-boundary qualification joins.
- [ ] Demonstrate Candidate Evaluation Result schema compatibility with synthetic and leaf evaluations.
