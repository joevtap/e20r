# Host-Runtime Evidence Catalog

Catalog version: `3-draft`

Every rule in this catalog inherits rule version `1` unless the rule explicitly declares another version.

## Scope

This catalog defines deterministic observations for Evidence Collection. It does not define Study Analysis rules, precedence, confidence aggregation, or a final Host Runtime classification. A collector should emit every matched observation independently, including contradictory signals.

Each observation should preserve a stable rule ID, runtime named by the evidence, strength (`affirmative` or `weak`), repository-relative path, package-boundary path, exact JSON/TOML key or source span, normalized observed value, and source revision. Configuration belongs to the nearest containing Package Boundary; source evidence belongs to the nearest containing Package Boundary and retains its file path.

`affirmative` means the artifact explicitly selects, configures, invokes, or uses an API unique to the named host. It does not mean that the package has been classified. `weak` means the observation is deterministic but non-exclusive, tooling-only, advisory, generated, or otherwise insufficient to affirm that host.

## Evidence Catalog

| Rule ID | Host | Boundary | Deterministic observation | Strength and qualification |
| --- | --- | --- | --- | --- |
| `node.manifest.engines` | Node.js | package | `package.json` has a non-wildcard `engines.node` value | Affirmative declaration of Node compatibility/intent; preserve the range. npm says `engines.node` specifies versions of Node, but also says it is advisory unless `engine-strict` is enabled. Not exclusive evidence. [npm `package.json`: engines](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#engines) |
| `node.script.invocation` | Node.js | package/source | A parsed package script directly invokes `node` to execute repository application output | Affirmative Node execution intent. Preserve the script key, command, and target; exclude development-only tooling commands and test-only targets. [Node command-line API](https://nodejs.org/api/cli.html) |
| `node.source.node_builtin` | Node.js | source | A parsed static/dynamic import or `require` resolves to `node:<builtin>` | Weak Node-compatible API use, not affirmative Node.js Host Runtime evidence: Deno exposes Node APIs and Bun is Node-compatible. Preserve the specifier rather than converting it to a host conclusion. [Node process import](https://nodejs.org/api/process.html#process), [Deno Node APIs](https://docs.deno.com/api/node/), [Bun runtime](https://bun.com/docs/runtime) |
| `node.source.unique_process_release` | Node.js | source | Parsed code reads `process.release.name` and compares/uses the value `node` | Affirmative host-identification code. Node defines `process` as information/control for the current Node process and documents `process.release`. [Node process](https://nodejs.org/api/process.html#processrelease) |
| `node.manifest.export_condition` | Node.js | package | A reachable `exports`/`imports` branch is keyed `node` or `node-addons` | Affirmative Node-targeted package entry point, not proof that the package itself executes under Node. Node defines these conditions as matching Node environments. Preserve key and target. [Node conditional exports](https://nodejs.org/api/packages.html#conditional-exports) |
| `bun.config.runtime` | Bun | package | Local `bunfig.toml` has at least one documented top-level runtime field or `[run]` runtime setting | Affirmative Bun runtime configuration. Do not count a global `.bunfig.toml`; package collection concerns repository-local configuration. [Bun `bunfig.toml`](https://bun.com/docs/runtime/bunfig) |
| `bun.script.invocation` | Bun | package/source | Parsed script command or shebang directly invokes `bun`, `bun run`, `bun test`, or `bun --bun` for repository code | Affirmative Bun execution intent. Preserve script key/command or source span. Bun documents these commands as executing files/scripts in Bun. [Bun runtime](https://bun.com/docs/runtime) |
| `bun.source.unique_global` | Bun | source | Parsed executable code references the `Bun` global or imports `bun:*` | Affirmative Bun-specific API usage. A type-only reference is weak. [Bun runtime API](https://bun.com/docs/runtime) |
| `deno.config` | Deno | package | `deno.json` or `deno.jsonc` exists and parses | Weak Deno tooling/project configuration. An empty or formatter/linter/compiler-only config does not affirm Deno Host Runtime execution; record fields individually. [Deno config files](https://docs.deno.com/runtime/fundamentals/configuration/) |
| `deno.task.invocation` | Deno | package | A Deno task or package script directly invokes `deno run`, `deno serve`, `deno compile`, or `deno test` against repository code | Affirmative Deno execution intent; preserve command and target. Deno distinguishes `package.json` compatibility from Deno-specific configuration. [Deno config files](https://docs.deno.com/runtime/fundamentals/configuration/) |
| `deno.source.unique_global` | Deno | source | Parsed executable code references a `Deno` runtime API such as `Deno.version`, `Deno.mainModule`, or `Deno.serve` | Affirmative Deno-specific API usage. Deno documents `Deno.version` as current Deno CLI runtime information. [Deno runtime API](https://docs.deno.com/api/deno/runtime/#Deno.version) |

## Weak Signals That Must Not Count Affirmatively

Record these, if useful for audit/debugging, with `strength: weak`; never promote them during Evidence Collection:

- `package.json` existence, npm/yarn/pnpm/Bun lockfiles, `node_modules`, `.js`/`.ts`/`.mjs`/`.cjs`, ESM/CommonJS syntax, generic `scripts`, or `@types/node`. They identify packaging, tooling, or module format, not a host. Bun can honor a Node shebang by launching Node, and Deno directly supports `package.json`.
- Bare Node built-ins, `node:` imports, `process`, `Buffer`, or a `#!/usr/bin/env node` shebang as Node-host proof. Bun and Deno implement Node compatibility; a shebang can also belong to a development CLI. Emit API-use/tooling observations instead.
- `engines.node: "*"`, an absent `engines` field, or npm's successful install. npm says `engines` is advisory unless strict mode is enabled.
- `bun.lock`, `bun.lockb`, `bun install`, `bunx`, `packageManager: "bun@..."`, or Bun in CI setup alone. These establish package-manager/tooling use, not that application source executes in Bun. Bun explicitly distinguishes running scripts under Node from forcing `--bun`.
- An empty `bunfig.toml`; `[install]`-only settings; `@types/bun` in development dependencies; Bun test files alone. These may be package-manager, type, or test-only evidence.
- A Deno lockfile, Deno formatter/linter/compiler-only settings, `deno install`, `deno task` running a Node command, `npm:`/`jsr:`/URL imports, or Deno in CI alone. Deno supports Node projects incrementally, so these do not establish Deno application execution.

## Collection Rules

1. Parse structured files and source syntax; do not substring-match comments, docs, snapshots, lockfile payloads, or arbitrary strings.
2. Keep package observations and source observations separate. Never smear one package's signal across sibling Package Boundaries.
3. Preserve coexisting Node.js, Bun, and Deno evidence without forcing one repository-wide runtime.
4. Preserve context (`production-source`, `test`, `build`, `tooling`, `example`, `generated`, `vendor`) rather than silently discarding it. Later analysis decides eligibility.
5. Version every rule and retain its primary-source URL. A changed runtime contract should create a new rule version rather than rewriting historical meaning.

## Sources Consulted

- Node.js, [Process](https://nodejs.org/api/process.html) and [Modules: Packages](https://nodejs.org/api/packages.html).
- npm, [`package.json`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json).
- Bun, [Runtime](https://bun.com/docs/runtime) and [`bunfig.toml`](https://bun.com/docs/runtime/bunfig).
- Deno, [Config files](https://docs.deno.com/runtime/fundamentals/configuration/) and [Runtime API](https://docs.deno.com/api/deno/runtime/).
