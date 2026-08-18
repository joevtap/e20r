# Host-Runtime Evidence Catalog

Catalog version: `1-draft`

Every rule in this catalog inherits rule version `1` unless the rule explicitly declares another version.

## Scope

This catalog defines deterministic observations for Evidence Collection. It does not define Study Analysis rules, precedence, confidence aggregation, or a final Host Runtime classification. A collector should emit every matched observation independently, including contradictory signals.

Each observation should preserve a stable rule ID, runtime named by the evidence, strength (`affirmative` or `weak`), repository-relative path, package-boundary path, exact JSON/TOML key or source span, normalized observed value, and source revision. Configuration belongs to the nearest containing Package Boundary; source evidence belongs to the nearest containing Package Boundary and retains its file path.

`affirmative` means the artifact explicitly selects, configures, invokes, or uses an API unique to the named host. It does not mean that the package has been classified. `weak` means the observation is deterministic but non-exclusive, tooling-only, advisory, generated, or otherwise insufficient to affirm that host.

## Evidence Catalog

| Rule ID | Host | Boundary | Deterministic observation | Strength and qualification |
| --- | --- | --- | --- | --- |
| `node.manifest.engines` | Node.js | package | `package.json` has a non-wildcard `engines.node` value | Affirmative declaration of Node compatibility/intent; preserve the range. npm says `engines.node` specifies versions of Node, but also says it is advisory unless `engine-strict` is enabled. Not exclusive evidence. [npm `package.json`: engines](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#engines) |
| `node.source.node_builtin` | Node.js API | source | A parsed static/dynamic import or `require` resolves to `node:<builtin>` | Affirmative use of the Node API contract, but not affirmative Node-host execution: Deno exposes Node APIs and Bun is Node-compatible. Preserve the specifier rather than converting it to a Node-host conclusion. [Node process import](https://nodejs.org/api/process.html#process), [Deno Node APIs](https://docs.deno.com/api/node/), [Bun runtime](https://bun.com/docs/runtime) |
| `node.source.unique_process_release` | Node.js | source | Parsed code reads `process.release.name` and compares/uses the value `node` | Affirmative host-identification code. Node defines `process` as information/control for the current Node process and documents `process.release`. [Node process](https://nodejs.org/api/process.html#processrelease) |
| `node.manifest.export_condition` | Node.js | package | A reachable `exports`/`imports` branch is keyed `node` or `node-addons` | Affirmative Node-targeted package entry point, not proof that the package itself executes under Node. Node defines these conditions as matching Node environments. Preserve key and target. [Node conditional exports](https://nodejs.org/api/packages.html#conditional-exports) |
| `bun.config.runtime` | Bun | package | Local `bunfig.toml` has at least one documented top-level runtime field or `[run]` runtime setting | Affirmative Bun runtime configuration. Do not count a global `.bunfig.toml`; package collection concerns repository-local configuration. [Bun `bunfig.toml`](https://bun.com/docs/runtime/bunfig) |
| `bun.script.invocation` | Bun | package/source | Parsed script command or shebang directly invokes `bun`, `bun run`, `bun test`, or `bun --bun` for repository code | Affirmative Bun execution intent. Preserve script key/command or source span. Bun documents these commands as executing files/scripts in Bun. [Bun runtime](https://bun.com/docs/runtime) |
| `bun.source.unique_global` | Bun | source | Parsed executable code references the `Bun` global or imports `bun:*` | Affirmative Bun-specific API usage. A type-only reference is weak. [Bun runtime API](https://bun.com/docs/runtime) |
| `deno.config` | Deno | package | `deno.json` or `deno.jsonc` exists and parses | Affirmative Deno tooling/project configuration, but record fields individually because an empty/tooling-only config does not itself prove production execution. Deno calls this the file that configures Deno itself and auto-detects it. [Deno config files](https://docs.deno.com/runtime/fundamentals/configuration/) |
| `deno.task.invocation` | Deno | package | A Deno task or package script directly invokes `deno run`, `deno serve`, `deno compile`, or `deno test` against repository code | Affirmative Deno execution intent; preserve command and target. Deno distinguishes `package.json` compatibility from Deno-specific configuration. [Deno config files](https://docs.deno.com/runtime/fundamentals/configuration/) |
| `deno.source.unique_global` | Deno | source | Parsed executable code references a `Deno` runtime API such as `Deno.version`, `Deno.mainModule`, or `Deno.serve` | Affirmative Deno-specific API usage. Deno documents `Deno.version` as current Deno CLI runtime information. [Deno runtime API](https://docs.deno.com/api/deno/runtime/#Deno.version) |
| `browser.manifest.browser` | browser | package | `package.json` has a `browser` string or mapping | Affirmative browser-targeted package entry/replacements, not proof of browser execution for all source. npm says this field is for client-side modules and hints that browser primitives may be used. Preserve the complete value. [npm `package.json`: browser](https://docs.npmjs.com/cli/v11/configuring-npm/package-json#browser) |
| `browser.manifest.export_condition` | browser | package | A reachable `exports`/`imports` branch is keyed `browser` | Affirmative browser-targeted entry point. Node's community condition definition says `browser` means any web-browser environment. Preserve branch target. [Node community conditions](https://nodejs.org/api/packages.html#community-conditions-definitions) |
| `browser.source.dom` | browser | source | Parsed executable code uses an unambiguously document/window-specific interface, for example `document`, `Window`, or DOM element creation, outside a declaration/polyfill implementation | Affirmative browser source-boundary evidence, though Electron renderer code may produce the same observation and remains separately observable. The HTML standard defines web realms with `Window`, `WorkerGlobalScope`, or `WorkletGlobalScope`; worker-only APIs do not establish browser UI execution. [WHATWG HTML realms](https://html.spec.whatwg.org/multipage/webappapis.html#realms-settings-objects-and-global-objects) |
| `electron.manifest.dependency` | Electron | package | `electron` is a direct production dependency and the package has an Electron entry (`main`) or direct execution script | Affirmative Electron package intent only when paired inside the same Package Boundary; a dev-only Electron dependency alone is weak. Electron's process API applies to main and renderer processes. [Electron process](https://www.electronjs.org/docs/latest/api/process) |
| `electron.source.import` | Electron | source | Parsed executable code imports/requires `electron` or an `electron/*` entry | Affirmative Electron API use at that source boundary. Preserve imported names because main/renderer availability differs. [Electron API](https://www.electronjs.org/docs/latest/api/app) |
| `electron.source.unique_process` | Electron | source | Parsed code reads `process.versions.electron` or another documented Electron-only `process` extension | Affirmative Electron host-identification/API evidence. Electron documents `process.versions.electron` and states its process object extends Node's. [Electron process](https://www.electronjs.org/docs/latest/api/process#processversionselectron-readonly) |
| `edge.cloudflare.config` | Cloudflare Workers edge | package | A repository-local `wrangler.json`, `wrangler.jsonc`, or `wrangler.toml` parses with `main`, `name`, and `compatibility_date`, or declares a Worker route/binding | Affirmative provider-specific edge deployment evidence. Preserve environment and entry point. Cloudflare calls the Wrangler file the Worker source of truth and requires those keys to deploy a Worker. [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) |
| `edge.vercel.runtime` | Vercel Edge | source | A function exports a statically evaluable config whose `runtime` is exactly `edge` | Affirmative provider-specific edge selection at that function source boundary. Preserve function path. Vercel calls this setting a prerequisite. [Vercel Edge Runtime](https://vercel.com/docs/functions/runtimes/edge) |
| `edge.provider.entry_api` | named edge provider | source | Parsed code imports a provider-owned runtime module or implements a provider-documented entry contract in a provider deployment boundary | Affirmative only for the named provider and only when the exact contract is cataloged with a first-party citation; do not generalize to all edge hosts. Cloudflare, for example, documents a Worker entry point in Wrangler config. [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) |
| `edge.runtime.identity` | named edge provider | source | Code reads a provider-defined identity value, such as Vercel's `globalThis.EdgeRuntime` or Cloudflare's flagged `navigator.userAgent === "Cloudflare-Workers"` | Affirmative provider-specific host-identification code. Preserve the exact identity test and provider. [Vercel identity](https://vercel.com/docs/functions/runtimes/edge#check-if-youre-running-on-the-edge-runtime), [Cloudflare identity](https://developers.cloudflare.com/workers/runtime-apis/web-standards/#navigatoruseragent) |

## Weak Signals That Must Not Count Affirmatively

Record these, if useful for audit/debugging, with `strength: weak`; never promote them during Evidence Collection:

- `package.json` existence, npm/yarn/pnpm/Bun lockfiles, `node_modules`, `.js`/`.ts`/`.mjs`/`.cjs`, ESM/CommonJS syntax, generic `scripts`, or `@types/node`. They identify packaging, tooling, or module format, not a host. Bun can honor a Node shebang by launching Node, and Deno directly supports `package.json`.
- Bare Node built-ins, `node:` imports, `process`, `Buffer`, or a `#!/usr/bin/env node` shebang as Node-host proof. Bun and Deno implement Node compatibility; a shebang can also belong to a development CLI. Emit API-use/tooling observations instead.
- `engines.node: "*"`, an absent `engines` field, or npm's successful install. npm says `engines` is advisory unless strict mode is enabled.
- `bun.lock`, `bun.lockb`, `bun install`, `bunx`, `packageManager: "bun@..."`, or Bun in CI setup alone. These establish package-manager/tooling use, not that application source executes in Bun. Bun explicitly distinguishes running scripts under Node from forcing `--bun`.
- An empty `bunfig.toml`; `[install]`-only settings; `@types/bun` in development dependencies; Bun test files alone. These may be package-manager, type, or test-only evidence.
- A Deno lockfile, Deno formatter/linter/compiler-only settings, `deno install`, `deno task` running a Node command, `npm:`/`jsr:`/URL imports, or Deno in CI alone. Deno supports Node projects incrementally, so these do not establish Deno application execution.
- `fetch`, `Request`, `Response`, `Headers`, Web Crypto, Web Streams, `URL`, `navigator`, `self`, `Worker`, service-worker files, WebAssembly, V8, or a `browser` dependency/dev server alone. Node, Bun, Deno, browsers, Electron, and edge hosts overlap heavily on Web APIs. The HTML standard also distinguishes browser windows from workers.
- JSX/React/Vue/Svelte, bundlers (`vite`, webpack, esbuild), DOM library dependencies, `lib: ["DOM"]`, browser test runners, or static HTML alone. These may be build, test, type-check, SSR, or library-target signals.
- Electron in `devDependencies`, Electron Forge/Builder config, `main` alone, Chromium APIs, Node APIs, or DOM APIs alone. Electron combines Node and Chromium and can package web content; require direct Electron execution/API evidence in the same boundary.
- Generic `edge`, `worker`, `serverless`, `functions`, `middleware`, `runtime`, CDN, region, or framework names; `export default { fetch() {} }`; `addEventListener("fetch", ...)`; WinterCG APIs; or a worker filename alone. These are shared vocabulary/contracts.
- `process.env`, Node-compatible modules, `Buffer`, or Web APIs inside edge code. Vercel documents `process.env`, selected Node modules, and Web APIs in its Edge runtime; Cloudflare also offers Node compatibility. They cannot distinguish Node, browser, or edge by themselves.
- Merely having `wrangler.*`, `vercel.json`, `netlify.toml`, provider dependencies, adapters, generated deployment output, examples, fixtures, docs, or vendored files. A valid provider-specific deployment declaration or source contract must bind the evidence to an entry point; generated/fixture provenance remains non-production context.

## Collection Rules

1. Parse structured files and source syntax; do not substring-match comments, docs, snapshots, lockfile payloads, or arbitrary strings.
2. Keep package observations and source observations separate. Never smear one package's signal across sibling Package Boundaries.
3. Emit provider-specific edge evidence (`cloudflare-workers`, `vercel-edge`, and so on), not a synthetic generic edge fact. Any later roll-up belongs to Study Analysis.
4. Preserve coexisting evidence. Electron can emit Electron, Node-API, and browser-DOM observations; an edge function can emit provider-edge and Node-API observations.
5. Preserve context (`production-source`, `test`, `build`, `tooling`, `example`, `generated`, `vendor`) rather than silently discarding it. Later analysis decides eligibility.
6. Version every rule and retain its primary-source URL. A changed provider contract should create a new rule version rather than rewriting historical meaning.

## Sources Consulted

- Node.js, [Process](https://nodejs.org/api/process.html) and [Modules: Packages](https://nodejs.org/api/packages.html).
- npm, [`package.json`](https://docs.npmjs.com/cli/v11/configuring-npm/package-json).
- Bun, [Runtime](https://bun.com/docs/runtime) and [`bunfig.toml`](https://bun.com/docs/runtime/bunfig).
- Deno, [Config files](https://docs.deno.com/runtime/fundamentals/configuration/) and [Runtime API](https://docs.deno.com/api/deno/runtime/).
- WHATWG, [HTML: Web application APIs](https://html.spec.whatwg.org/multipage/webappapis.html).
- Electron, [`process`](https://www.electronjs.org/docs/latest/api/process) and [`app`](https://www.electronjs.org/docs/latest/api/app).
- Cloudflare, [Wrangler configuration](https://developers.cloudflare.com/workers/wrangler/configuration/) and [Workers Web standards](https://developers.cloudflare.com/workers/runtime-apis/web-standards/).
- Vercel, [Edge Runtime](https://vercel.com/docs/functions/runtimes/edge).
