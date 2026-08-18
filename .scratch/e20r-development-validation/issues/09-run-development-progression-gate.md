# 09 — Run the Development Progression Gate

**What to build:** Compose synthetic, effect-mcp, and OpenCode evidence into a development-only progression runner whose executable checks determine whether durable-state design is unlocked.

**Blocked by:** 08 — Complete OpenCode Runtime and Partial-Evidence Validation

**Status:** ready-for-agent

- [ ] Add the `validate:progression` project task without exposing pinned subjects through the distributed CLI.
- [ ] Implement every stable stage-check slug and predicate from the approved spec with direct links to supporting evidence.
- [ ] Compute and compare a deterministic Candidate Evaluation Result schema and Signal/Probe semantic digest across all stages.
- [ ] Make every stage interface-digest check non-waivable; any digest drift blocks progression regardless of limitation approval.
- [ ] Keep Progression Result and limitation approval state separate from Candidate Evaluation Result.
- [ ] Require limitation scope, rationale, downstream impact, approver, and approval time before human acceptance can satisfy a waivable check.
- [ ] Prevent accepted limitations from clearing any separate unexplained failed required check.
- [ ] Write a schema-versioned partial result after valid configuration even when checks fail.
- [ ] Prove partial and final progression artifacts contain only sanitized diagnostics and never raw foreign causes or secret-bearing context.
- [ ] Use exit code 0 only when all checks pass or hold approved waivable limitations, 1 for failed or unaccepted checks, and 2 for pre-artifact configuration failure.
- [ ] Overwrite the active progression artifact deterministically while relying on Git history for superseded reviewed results.
- [ ] Unlock durable-state design only after OpenCode is accepted; do not execute or model SQLite design as an evidence stage.
