# 04 — Preserve Failure, Provenance, and Diagnostic Safety

**What to build:** Make Candidate Evaluator return complete provenance and distinct failure semantics without leaking unsafe foreign diagnostics.

**Blocked by:** 03 — Enforce Package-Boundary Source Qualification

**Status:** ready-for-agent

- [ ] Aggregate multiple occurrence provenances on one present Signal without duplicating its normalized observation.
- [ ] Distinguish absent, indeterminate, failed, incomplete, and `not-probed` states in externally visible attempts and observations.
- [ ] Record malformed manifests, unreadable paths, unsupported syntax, and operational failures without converting them to absence.
- [ ] Keep failures with identifiable Probe Attempts in auditable result data and reserve the Effect error channel for failures that prevent a trustworthy result.
- [ ] Encode only sanitized diagnostic kind, operation, safe message, and safe context; keep raw foreign causes internal.
- [ ] Prove Candidate Evaluation Result objects and encoded diagnostics cannot expose credentials, authorization data, unsafe control characters, raw commands, or unmanaged absolute paths.
- [ ] Verify scoped checkout cleanup on success, typed failure, and interruption.
