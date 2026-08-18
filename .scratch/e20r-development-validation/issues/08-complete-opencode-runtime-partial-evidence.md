# 08 — Complete OpenCode Runtime and Partial-Evidence Validation

**What to build:** Complete pinned OpenCode validation with Node.js, Bun, and Deno Host Runtime semantics plus exclusions and partial-Probe evidence, without collecting browser, Electron, or edge classifications.

**Blocked by:** 07 — Collect OpenCode Package and Workspace Evidence

**Status:** ready-for-agent

- [ ] Run the complete Host Runtime Probe using Host-Runtime Evidence Catalog `3-draft`.
- [ ] Emit affirmative `bun.script.invocation` observations at their owning Package Boundaries.
- [ ] Emit affirmative `node.manifest.export_condition` evidence at its owning Package Boundary.
- [ ] Complete runtime probing with no present Deno-rule observation and without `not-probed`, indeterminate, or failed completion state.
- [ ] Keep weak Node-compatible API and Deno tooling observations from affirming a Host Runtime.
- [ ] Do not collect or classify browser, Electron, or edge platform evidence.
- [ ] Preserve explicit source exclusions, searched scopes, and at least one auditable partial-Probe scenario without converting incompleteness to absence.
- [ ] Preserve same-boundary attribution and Candidate Evaluation Result schema compatibility.
- [ ] Produce a machine-checkable OpenCode stage result with linked Signal Observations and Probe Attempts.
