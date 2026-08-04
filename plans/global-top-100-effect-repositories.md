# Global Top 100 Effect Repositories

## Goal

Find a defensible global top 100 of public TypeScript repositories that declare
Effect as a production dependency, ordered by stars and forks. Download only
dependency manifests during discovery, then fetch complete working trees for
the selected repositories and perform detailed static analysis locally.

## Ranking Contract

Repositories are ordered by:

1. Stars descending.
2. Forks descending.
3. Full repository name ascending.

The search must finish the complete star-count group containing the 100th
repository before selecting the final results. This ensures forks are a valid
secondary ordering criterion rather than an artifact of pagination.

## Eligibility Contract

A repository qualifies when all of the following are true:

- GitHub reports it as public and non-archived.
- GitHub Linguist identifies TypeScript in the repository.
- At least one exact `package.json` on the default branch declares `effect` in
  `dependencies` or `optionalDependencies`.
- The repository is not a fork.

README text, topics, frameworks, development dependencies, peer dependencies,
and transitive dependencies must not establish eligibility.

## Phase 1: Popularity-Ordered Discovery

Query GitHub repository search with:

```text
language:TypeScript is:public archived:false
```

Use `sort=stars`, `order=desc`, and `per_page=100`. Repository search provides
the ranking metadata and clone URLs needed by later phases.

Process candidates in API order and retain:

- Full repository name.
- Stars and forks.
- Default branch.
- HTTPS and SSH clone URLs.
- Visibility, fork status, and archive status.
- License and topics as descriptive metadata only.

### Search Partitioning

GitHub exposes at most 1,000 results for one search query. If the first 1,000
repositories do not produce enough confirmed Effect users, continue below the
last processed star count:

```text
language:TypeScript is:public archived:false stars:<LAST_STAR_COUNT
```

Before moving below a boundary, query and process the complete `stars:N` group.
If a single star-count group exceeds 1,000 results, partition that group by
fork count or creation date while preserving deterministic ordering.

Checkpoint the current query, page, star boundary, and processed repository IDs
so an interrupted run can resume without repeating completed work.

## Phase 2: Sparse Manifest Clones

Process repository candidates in batches of 50 to 100. Limit concurrent Git
operations to approximately 6 initially, then tune based on network and disk
behavior.

Create a shallow partial clone without checking out the full source tree:

```bash
git clone \
  --depth 1 \
  --single-branch \
  --filter=blob:none \
  --no-checkout \
  <clone-url> \
  <target-directory>
```

Configure non-cone sparse checkout for dependency metadata:

```text
**/package.json
**/pnpm-workspace.yaml
**/pnpm-lock.yaml
**/yarn.lock
**/package-lock.json
**/bun.lock
**/bun.lockb
```

Inspect every exact `package.json`, including manifests in nested monorepo
workspaces. Record each qualifying manifest path and its declared Effect range.

Delete clones that do not contain a direct production Effect dependency.
Retain qualifying sparse clones and their discovery metadata.

Keep failure records for repositories that cannot be cloned or parsed. Do not
silently treat failures as non-Effect repositories, because that would corrupt
the global ranking.

## Phase 3: Selection

Continue popularity-ordered discovery and sparse validation until:

- At least 100 repositories qualify.
- The complete star-count tie group containing the current 100th result has
  been processed.
- Clone or validation failures above the cutoff have been resolved or reported
  as ranking limitations.

Sort all confirmed repositories using the ranking contract. Select the top 100
and retain another 20 to 50 repositories as replacements for later failures.

Write a checkpoint containing:

- Ranking and repository metadata.
- Clone URLs and local paths.
- Matching manifest paths.
- Declared Effect dependency ranges.
- Discovery and validation failures.
- Search partitions and completion boundaries.

## Phase 4: Full Checkout

For the selected top 100 and reserve candidates, expand sparse clones only when
full analysis is required:

```bash
git -C <target-directory> sparse-checkout disable
```

Keep clones shallow unless commit history becomes an explicit analysis input.
Use the reserve pool when a selected repository cannot produce a complete
working tree.

## Phase 5: Local Classification

Run all detailed classification against local files rather than GitHub code
search snippets.

### Effect Versions

- Record declarations from every qualifying workspace.
- Resolve exact versions from npm, pnpm, Yarn, and Bun lockfiles.
- Categorize v3, v4 beta, v4 stable, other, and unresolved declarations.
- Preserve both the declared range and resolved version evidence.
- Allow one repository to contain multiple Effect versions.

### Runtime Evidence

Classify Node, Bun, Deno, browser, and edge targets with deterministic evidence.
Each decision must include a stable rule ID, package path, evidence path, and
observed value.

Strong evidence includes:

- Runtime-specific `engines` fields and package export conditions.
- `node:` imports and explicit Node runtime configuration.
- `Bun` APIs, `bun:` imports, and explicit Bun engine declarations.
- `deno.json`, `deno.jsonc`, `Deno` APIs, and `jsr:` imports.
- Browser package fields, browser export conditions, and explicit browser
  targets.
- Wrangler configuration, `cloudflare:workers`, Workerd exports, and explicit
  edge runtime declarations.

Lockfiles, framework names, build tools, repository topics, and README claims
must not classify a runtime by themselves.

Associate evidence with the nearest package boundary. A root Effect package
must not absorb evidence from unrelated nested packages.

## Effect Architecture

Use Effect primitives to keep policy centralized and failures explicit:

- `Stream.paginateEffect` for repository search pages and star partitions.
- `RateLimiter` for GitHub repository and metadata requests.
- `Effect.forEach` with bounded concurrency for clone and analysis batches.
- `Schedule` for bounded network and Git retry policies.
- `Effect.acquireRelease` for temporary clone directories and cleanup.
- Typed tagged errors for API, clone, manifest, lockfile, and analysis failures.
- Schema decoding for GitHub responses, manifests, checkpoints, and final output.
- Filesystem and command services from `@effect/platform` at the runtime edge.

Separate modules by the knowledge they own:

- GitHub repository discovery and pagination policy.
- Git clone lifecycle and sparse-checkout policy.
- Package and workspace discovery.
- Effect dependency and lockfile resolution.
- Runtime evidence classification.
- Ranking, checkpointing, and final reporting.

The orchestration layer should request high-level operations and must not know
GitHub pagination details, Git command sequences, lockfile formats, or runtime
classification rules.

## Operational Limits

Start with these conservative limits:

- GitHub repository search within its documented rate bucket.
- Six concurrent sparse clones.
- Four concurrent full checkouts.
- Four concurrent local repository analyses.
- Per-clone timeout and bounded retry count.
- Configurable disk budget and explicit cleanup policy.
- Persistent checkpoints after every completed candidate batch.

Never delete a retained clone or checkpoint during cleanup. Cleanup should only
remove failed, disqualified, or explicitly temporary directories.

## Outputs

Produce two machine-readable artifacts:

### Discovery Result

Contains the ranked candidate pool, GitHub metadata, manifest evidence, clone
status, failures, search partitions, and completeness information.

### Analysis Result

Contains the final top 100 with clone paths, Effect versions, runtime labels,
typed evidence, monorepo package details, and static-analysis findings.

Keep operational logs on stderr and structured JSON on stdout or in explicit
output files.

## Verification

Add tests for:

- Repository ordering and stable tie-breaking.
- Star-boundary pagination and partition continuation.
- Resume behavior from checkpoints.
- Sparse clone cleanup and retained-clone safety.
- Exact `package.json` discovery in monorepos.
- Production dependency filtering.
- Lockfile version resolution.
- Multiple Effect versions in one repository.
- Runtime evidence and unrelated-package isolation.
- Clone failures above and below the top-100 cutoff.
- Replacement selection from the reserve pool.

Run an integration trial against a small star range before starting global
discovery. Verify that interrupted runs resume and that non-qualifying clones
are cleaned without touching retained repositories.

## Completion Criteria

The implementation is complete when:

- The selected repositories are globally popularity-ordered within the fully
  traversed GitHub repository-search partitions.
- The star-count group at the cutoff is complete.
- Every selected repository has a successful local checkout or is replaced from
  the reserve pool.
- Every Effect and runtime classification is backed by local-file evidence.
- Discovery failures and completeness limitations are visible in output.
- The workflow can resume safely after interruption.
- Re-running against unchanged inputs produces the same ordering and evidence.
