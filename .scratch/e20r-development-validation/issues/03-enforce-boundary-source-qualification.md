# 03 — Enforce Package-Boundary Source Qualification

**What to build:** Make synthetic candidates qualify only when one valid Package Boundary owns both a direct Effect declaration and structurally verified production source use.

**Blocked by:** 02 — Enforce License Selection and Probe Ordering

**Status:** ready-for-agent

- [ ] Discover valid tracked Package Boundaries repository-wide and assign source files to their nearest valid ancestor boundary.
- [ ] Preserve direct `dependencies.effect` values verbatim and never qualify peer-only, development-only, or unrelated declarations.
- [ ] Reject a candidate with no direct Effect declaration and record the source-use Probe as `not-probed` rather than absent.
- [ ] Structurally verify imports, exports, dynamic imports, and type-only imports of `effect`, `effect/*`, and `@effect/*` without accepting comments or plain strings.
- [ ] Exclude declarations, generated output, vendored code, fixtures, examples, benchmarks, and tests from qualification with stable reason slugs.
- [ ] Reject cross-boundary false joins while allowing a later declaration-bearing boundary to qualify after an earlier boundary lacks source use.
- [ ] Preserve unassociated source evidence and malformed nested-manifest failures without hiding files from the nearest valid ancestor.
- [ ] Prove nested ownership, test-only use, and qualifying-second-boundary behavior through Candidate Evaluator.
