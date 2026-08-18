# OpenCode as the First e20r Analysis Subject

Research date: 2026-08-18

Analyzed snapshot: `anomalyco/opencode` commit [`9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a`](https://github.com/anomalyco/opencode/tree/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a) on its `dev` default branch. The bounded research used `.repos/opencode/` as a development reference checkout; `.repos/` is not an e20r runtime analysis location.

## Identification and ambiguity

The OpenCode project the user most likely means is **Anomaly's OpenCode**, canonical repository [`https://github.com/anomalyco/opencode`](https://github.com/anomalyco/opencode). This is the strongest candidate because:

- GitHub describes it as "The open source coding agent," identifies TypeScript as its primary language, links `opencode.ai`, and reports `dev` as the default branch ([GitHub repository API](https://api.github.com/repos/anomalyco/opencode)).
- Its own manifest identifies the repository as `https://github.com/anomalyco/opencode` ([root `package.json`, lines 120-124](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/package.json#L120-L124)).
- It directly and extensively adopts Effect v4, making it plausible as an e20r subject ([root catalog, lines 33-67](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/package.json#L33-L67)).

The name is ambiguous. GitHub search also returns the older [`opencode-ai/opencode`](https://github.com/opencode-ai/opencode), a Go terminal coding agent that is now archived, as well as thousands of related or unrelated repositories ([GitHub repository search](https://github.com/search?q=opencode&type=repositories)). This report therefore treats `anomalyco/opencode` as the likely subject, not as an identity proven from the name alone.

## License

MIT. Both the repository's first-party license file and root manifest say MIT ([`LICENSE`](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/LICENSE), [`package.json`, line 124](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/package.json#L124)). GitHub's repository API independently classifies it as SPDX `MIT` ([repository API](https://api.github.com/repos/anomalyco/opencode)).

## Language, package manager, and workspace structure

- **Primary language:** TypeScript, according to GitHub's repository metadata ([repository API](https://api.github.com/repos/anomalyco/opencode)). Source and manifests use ESM (`"type": "module"`) ([root manifest, lines 3-7](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/package.json#L3-L7)).
- **Package manager:** Bun `1.3.14`, declared by `packageManager`; the committed lockfile is `bun.lock` ([root manifest, line 7](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/package.json#L7), [`bun.lock`](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/bun.lock)).
- **Monorepo:** Bun workspaces select `packages/*`, `packages/console/*`, `packages/stats/*`, `packages/sdk/js`, and `packages/slack` ([root manifest, lines 25-32](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/package.json#L25-L32)). `packages/slack` is redundant with `packages/*`, but harmless as a declaration.
- **Task orchestration:** scripts invoke Turborepo, with `turbo@2.10.2` in root development dependencies ([root manifest, lines 16 and 98-110](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/package.json#L16-L16)).
- **Out-of-workspace manifests:** repository-wide enumeration also finds manifests such as `github/package.json`, `sdks/vscode/package.json`, and `artifacts/glm52-rise-video/package.json`; they are not selected by the root workspace patterns and should not be silently treated as Bun workspace members.

## Direct production `effect` dependencies

For this report, "direct production" means `effect` appears in `dependencies` or `optionalDependencies` of a selected workspace manifest. It excludes `devDependencies` and peer-only declarations. Nineteen workspace packages qualify, all declaring `"effect": "catalog:"`:

| Workspace manifest | Declaration source |
| --- | --- |
| `packages/app` | [`package.json`, line 84](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/app/package.json#L84) |
| `packages/cli` | [`package.json`, line 27](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/cli/package.json#L27) |
| `packages/codemode` | [`package.json`, line 18](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/codemode/package.json#L18) |
| `packages/core` | [`package.json`, line 109](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/core/package.json#L109) |
| `packages/desktop` | [`package.json`, line 28](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/desktop/package.json#L28) |
| `packages/effect-drizzle-sqlite` | [`package.json`, line 26](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/effect-drizzle-sqlite/package.json#L26) |
| `packages/effect-sqlite-node` | [`package.json`, line 20](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/effect-sqlite-node/package.json#L20) |
| `packages/httpapi-codegen` | [`package.json`, line 14](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/httpapi-codegen/package.json#L14) |
| `packages/llm` | [`package.json`, line 50](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/llm/package.json#L50) |
| `packages/opencode` | [`package.json`, line 121](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/opencode/package.json#L121) |
| `packages/plugin` | [`package.json`, line 26](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/plugin/package.json#L26) |
| `packages/protocol` | [`package.json`, line 15](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/protocol/package.json#L15) |
| `packages/schema` | [`package.json`, line 15](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/schema/package.json#L15) |
| `packages/sdk-next` | [`package.json`, line 18](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/sdk-next/package.json#L18) |
| `packages/server` | [`package.json`, line 18](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/server/package.json#L18) |
| `packages/stats/app` | [`package.json`, line 24](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/stats/app/package.json#L24) |
| `packages/stats/core` | [`package.json`, line 33](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/stats/core/package.json#L33) |
| `packages/stats/server` | [`package.json`, line 20](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/stats/server/package.json#L20) |
| `packages/tui` | [`package.json`, line 60](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/tui/package.json#L60) |

`packages/client` and `packages/http-recorder` expose peer declarations of exactly `4.0.0-beta.83`; both also carry catalog-based development declarations ([client manifest, lines 22-37](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/client/package.json#L22-L37), [HTTP recorder manifest, lines 50-58](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/http-recorder/package.json#L50-L58)). Neither is a direct production `effect` declaration.

## Declared Effect range and resolution

Every `catalog:` declaration resolves through the root workspace catalog to exact **`4.0.0-beta.83`**, not a semver range ([root manifest, line 66](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/package.json#L66)). The two peer declarations are also exact `4.0.0-beta.83`. The repository patches that exact Effect release ([root manifest, line 160](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/package.json#L160)). Therefore the declared classification at this snapshot is **Effect v4 beta**, exact beta 83.

Related direct catalog dependencies are also pinned to beta 83: `@effect/opentelemetry`, `@effect/platform-node`, and `@effect/sql-sqlite-bun` ([root manifest, lines 34-36](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/package.json#L34-L36)).

## Host-runtime evidence

The repository is multi-host. Runtime classification should be associated with package/source boundaries rather than assigning one runtime to the whole repository.

- **Bun, strong repository/tooling and application evidence:** the root pins Bun and executes package entry points with `bun` ([root manifest, lines 7-18](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/package.json#L7-L18)). The main OpenCode package has Bun scripts and a default Bun-specific database import condition ([`packages/opencode/package.json`, lines 8-29](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/opencode/package.json#L8-L29)). This is strong Bun host evidence for the CLI/application, while its explicit `node` import condition also shows intended Node compatibility for storage.
- **Node.js, strong production evidence:** `packages/cli/src/index.ts` imports `@effect/platform-node/NodeRuntime` and `NodeServices`, then runs with `NodeRuntime.runMain` ([source](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/cli/src/index.ts)). The main package directly depends on `@effect/platform-node` ([manifest, lines 79-81](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/opencode/package.json#L79-L81)). This is deterministic Node host evidence, not merely an `@types/node` hint.
- **Browser, strong production evidence:** `packages/app` builds with Vite and its entry accesses `document` and `window` ([app manifest, lines 15-31](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/app/package.json#L15-L31), [`entry.tsx`](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/app/src/entry.tsx)). Since the app directly depends on Effect, this is strong browser-hosted Effect evidence.
- **Electron desktop, strong production evidence:** `packages/desktop` declares an Electron main entry and Electron build/dev scripts ([manifest, lines 12-28](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/desktop/package.json#L12-L28)); its main process imports `app` and `BrowserWindow` from Electron ([`src/main/index.ts`](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/desktop/src/main/index.ts)). The package directly depends on Effect, so classify it as Electron main/renderer rather than generic browser alone.
- **Cloudflare Workers/edge, strong repository evidence but not yet tied to a direct-Effect package by this bounded pass:** `packages/function/src/api.ts` imports `DurableObject` from `cloudflare:workers` ([source](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/packages/function/src/api.ts)), and generated SST types name Cloudflare Worker services, KV, and R2 resources ([`sst-env.d.ts`](https://github.com/anomalyco/opencode/blob/9b0dd36cda0b9accb429a7f9f9ad9b054a27d04a/sst-env.d.ts)). However, `packages/function` does not directly declare `effect`. SST imports/types in Effect-bearing stats packages are deployment context, not by themselves enough to classify their Effect execution host as Cloudflare.
- **Deno:** no affirmative Deno production-host evidence was found in the bounded manifest and source searches. Absence from this pass is not proof of unsupported execution.

## Suitability as the first real subject

`anomalyco/opencode` is a strong first e20r subject: it is a large, active TypeScript/Bun monorepo; has exact, catalog-centralized Effect v4 beta declarations across 19 production packages; uses Effect in CLI, server/core libraries, browser UI, and desktop code; and presents meaningful package-boundary runtime classification challenges. It also tests important analyzer behavior around catalog resolution, peer versus production dependencies, patched dependencies, workspace membership, and mixed Bun/Node/browser/Electron/edge evidence.

The main caveat is snapshot volatility: the `dev` default branch moves quickly, so future analyses must record the commit and should not assume beta 83 remains current.
