# effect-mcp as the First Real Leaf

Research date: 2026-08-18

Selected snapshot: [`niklaserik/effect-mcp`](https://github.com/niklaserik/effect-mcp) commit [`5c6a0c76ca408a7d96dc98eb442f4b68aa659389`](https://github.com/niklaserik/effect-mcp/commit/5c6a0c76ca408a7d96dc98eb442f4b68aa659389).

This repository is a development-only validation subject. It is not bundled with e20r, fetched by the final tool as a built-in fixture, or exposed as a user-facing progression stage.

## Why this repository

`effect-mcp` is the smallest researched subject that introduces a real checkout without introducing workspace or multi-runtime complexity. GitHub reports it as public, non-fork, non-archived, and TypeScript-primary. At the researched snapshot it has one package manifest, three tracked TypeScript files, one pnpm lockfile, and no workspace declaration ([repository metadata](https://api.github.com/repos/niklaserik/effect-mcp), [pinned tree](https://github.com/niklaserik/effect-mcp/tree/5c6a0c76ca408a7d96dc98eb442f4b68aa659389)).

## Expected selection evidence

- **Libre license:** the manifest declares MIT and the repository contains the complete MIT grant ([manifest](https://github.com/niklaserik/effect-mcp/blob/5c6a0c76ca408a7d96dc98eb442f4b68aa659389/package.json#L26), [license](https://github.com/niklaserik/effect-mcp/blob/5c6a0c76ca408a7d96dc98eb442f4b68aa659389/LICENSE)).
- **Direct declaration:** the root Package Boundary declares `"effect": "^3.14.11"` in `dependencies` ([manifest](https://github.com/niklaserik/effect-mcp/blob/5c6a0c76ca408a7d96dc98eb442f4b68aa659389/package.json#L39-L46)).
- **Qualifying source use:** all three tracked TypeScript files import from `effect`: `src/index.ts`, `src/utils/codeDetection.ts`, and `src/utils/documentationFetcher.ts` ([entry source](https://github.com/niklaserik/effect-mcp/blob/5c6a0c76ca408a7d96dc98eb442f4b68aa659389/src/index.ts#L1), [detector source](https://github.com/niklaserik/effect-mcp/blob/5c6a0c76ca408a7d96dc98eb442f4b68aa659389/src/utils/codeDetection.ts#L1), [fetcher source](https://github.com/niklaserik/effect-mcp/blob/5c6a0c76ca408a7d96dc98eb442f4b68aa659389/src/utils/documentationFetcher.ts#L1-L8)).
- **Package manager:** `pnpm-lock.yaml` and `pnpm.onlyBuiltDependencies` provide pnpm evidence, although no package-manager version is pinned ([lockfile](https://github.com/niklaserik/effect-mcp/blob/5c6a0c76ca408a7d96dc98eb442f4b68aa659389/pnpm-lock.yaml), [manifest configuration](https://github.com/niklaserik/effect-mcp/blob/5c6a0c76ca408a7d96dc98eb442f4b68aa659389/package.json#L48-L53)).
- **Host runtime:** the start script directly invokes Node for repository application output, satisfying `node.script.invocation`; `@effect/platform-node` remains supporting package context rather than host proof ([scripts and dependencies](https://github.com/niklaserik/effect-mcp/blob/5c6a0c76ca408a7d96dc98eb442f4b68aa659389/package.json#L9-L15)).

These are expectations from reconnaissance, not accepted e20r observations. The progression stage must independently acquire the pinned commit and emit every Signal and Probe Attempt.

## Acceptance gate

The leaf stage passes when it preserves:

- Exact-commit acquisition.
- Complete local license evidence.
- One valid Package Boundary.
- The verbatim Declared Effect Specifier.
- Every qualifying source-use provenance.
- Eligible and excluded source evidence.
- pnpm and affirmative Node script-invocation observations.
- Complete Probe Attempts with no unexplained required failure.

The stage deliberately does not test workspace selection, dependency catalogs, multiple Package Boundaries, or multiple Host Runtimes. Those belong to the pinned OpenCode stage.

## Known limitations

The repository has no functioning test suite; its test script deliberately exits with an error. It does not declare a Node engine or pin a pnpm version. These are useful absent observations and do not prevent it from testing e20r's evidence interface.
