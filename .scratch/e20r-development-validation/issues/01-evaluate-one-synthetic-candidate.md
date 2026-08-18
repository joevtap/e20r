# 01 — Evaluate One Synthetic Candidate End to End

**What to build:** Make one temporary, exact-commit synthetic Git repository pass through the complete `CandidateEvaluator` seam and return a selected Candidate Evaluation Result using the pinned evaluation protocol.

**Blocked by:** None — can start immediately

**Status:** ready-for-agent

- [ ] Add the aligned Effect-aware test toolchain, compatible Vitest runtime, and runnable normal and focused test commands.
- [ ] Define schema-backed Candidate at Commit, Evaluation Protocol, Signal Observation, provenance, Probe Attempt, Cohort Selection Decision, Candidate Evaluation Result, and sanitized diagnostic contracts.
- [ ] Validate protocol/catalog dependencies and required Probe ordering before evaluation begins.
- [ ] Acquire a temporary repository at an exact commit through an observable shallow-clone attempt whenever Git supports it, record the acquisition strategy, use tracked files as the evidence universe, and clean the checkout after success, failure, or interruption.
- [ ] Evaluate one MIT-licensed single-package fixture with a direct Effect declaration and qualifying same-boundary source use to a selected decision.
- [ ] Preserve Signal/Probe Catalog `3-draft` and Host-Runtime Catalog `3-draft` identities on observations and attempts without adding progression-only interface metadata to Candidate Evaluation Result.
- [ ] Verify behavior end to end through `CandidateEvaluator` rather than internal scanner call structure.
