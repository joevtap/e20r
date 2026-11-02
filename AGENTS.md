## Running e20r

Both harness entrypoints, `AGENTS.md` and `CLAUDE.md` (a symlink to this
file), use the same [operating guide](docs/operations.md). Read it before
running a crawl, processing repositories, or writing run instructions.

Follow its before/during/after procedure: measure current host capacity,
isolate the persistent cache from research data and disposable worktrees,
use the pnpm-selected Node runtime, verify effective configuration, monitor
the complete process tree and disk growth, and check persisted progress
after interruption. Keep at least 2 GiB MemAvailable and 10 GiB free disk;
stop on a reserve breach or sustained swap growth. Use enforceable process
limits where supported. Concurrency 4 is a code default, not a capacity
guarantee; use 2 or 1 when measured headroom calls for it.

Do not start a full run merely to validate documentation. Use static,
build/help or isolated bounded probes within the assigned scope. Never
print or source credential files. When authorized to reuse a token, create
a private credential-only runtime `.env` programmatically, keep it out of
logs and Git, and remove it at shutdown. Shell environment settings do not
override the current `fromDotEnv()` provider. Preserve cache/results for
resume, record their final sizes and stop owned child processes before
reporting completion.

## Local repositories

Local clones are used as reference material by coding agents under `.repos/`. These are development references, not repositories analyzed by this application.

### Effect

`.repos/effect/` is a local clone of the upstream `Effect-TS/effect` repository. When working with Effect v4, use its source, tests, `ai-docs/`, and `LLMS.md` to verify current APIs and established patterns instead of inferring them from older Effect versions. Treat the clone as read-only reference material; make project changes in this repository.
