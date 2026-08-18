# 05 — Expose Generic Unstable Repository Validation

**What to build:** Let an operator manually run Candidate Evaluator from the approved unsupported `e20r unstable validate repository` command using a complete protocol document.

**Blocked by:** 04 — Preserve Failure, Provenance, and Diagnostic Safety

**Status:** ready-for-agent

- [ ] Accept and decode a protocol input containing candidate snapshot metadata, exact commit, catalogs, selection policy, license policy, digests, verifier versions, and evidence scope.
- [ ] Delegate through Candidate Evaluator without duplicating Git, filesystem, policy, or Probe logic in the command handler.
- [ ] Write one structured Candidate Evaluation Result to stdout and progress or sanitized diagnostics to stderr.
- [ ] Prove stdout and stderr never expose credentials, authorization data, unsafe control characters, raw commands, or unmanaged absolute paths.
- [ ] Return documented non-zero exit behavior for invalid protocol input and evaluation failure.
- [ ] Mark the command hierarchy explicitly unstable and unsupported without changing the stable CLI surface.
- [ ] Test command behavior through the CLI boundary, including redaction and malformed protocol handling.
