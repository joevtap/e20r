## Agent skills

### Issue tracker

Issues are tracked as local Markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Triage uses the five default canonical role names. See `docs/agents/triage-labels.md`.

### Domain docs

Domain documentation uses the single-context layout. See `docs/agents/domain.md`.

## Local repositories

Store local clones used as reference material by coding agents under `.repos/`. These are development references, not repositories analyzed by this application.

### Effect

`.repos/effect/` is a local clone of the upstream `Effect-TS/effect` repository. When working with Effect v4, use its source, tests, `ai-docs/`, and `LLMS.md` to verify current APIs and established patterns instead of inferring them from older Effect versions. Treat the clone as read-only reference material; make project changes in this repository.
