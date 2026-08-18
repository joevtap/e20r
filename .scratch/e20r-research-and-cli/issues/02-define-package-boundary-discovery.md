# Define Package-Boundary and Workspace Discovery

Type: grilling
Status: resolved
Blocked by: 01

## Question

How should e20r discover every package boundary, associate source files with the nearest manifest, record active workspace membership independently, and incrementally add npm, pnpm, Yarn, Bun, and monorepo-engine support without making workspace membership a repository-qualification gate?

## Answer

Use the tracked files at the recorded Git revision as the reproducible discovery universe. Discover every tracked `package.json` repository-wide rather than limiting discovery to workspace-selected directories. Explicit eligibility rules exclude installed dependencies, generated output, and other ineligible paths; untracked checkout residue is never evidence. Unavailable submodule contents and filesystem or parsing failures remain explicit scoped failures.

A tracked `package.json` establishes a Package Boundary only when it can be parsed as a valid manifest. A malformed or unreadable candidate produces a package-boundary discovery failure but no boundary. Every eligible source file belongs to exactly one Package Boundary: its nearest valid ancestor manifest. Files with no valid ancestor are retained in a repository-level unassociated source inventory with provenance and reason `no-package-boundary`; they cannot contribute package-boundary qualification. A malformed nested manifest therefore does not hide files from the nearest valid ancestor, but its failure keeps collection partial.

Evidence Collection records **Workspace Selection Evidence**, not Workspace Membership. Each selection record identifies the valid Package Boundary, declaring workspace root, declaration mechanism and location, matched pattern, and package path. Resolve patterns relative to each declaring root. Evaluate every recognized declaration, including nested roots; a boundary may have zero, one, or multiple selection records. Overlapping patterns within one root retain pattern provenance but identify one selected boundary. Workspace Membership remains a later Study Analysis conclusion about which configuration was active.

Workspace patterns select only valid discovered Package Boundaries. Preserve unmatched patterns, matching directories without valid manifests, unsupported syntax, and evaluation failures as diagnostics or scoped failures rather than silently broadening selection. Workspace selection is independent evidence and is never a repository-qualification gate.

Support proceeds in this bounded order:

1. Repository-wide Package Boundaries and nearest-valid-manifest source ownership.
2. `package.json#workspaces` through a shared `package-json-workspaces` declaration adapter, first exercised with npm and then Bun/OpenCode. Package-manager signals remain separate because npm, Yarn, and Bun share this syntax.
3. `pnpm-workspace.yaml`, including inclusion, exclusion, negation, and catalog evidence.
4. Yarn-specific package-manager evidence and workspace edge cases without changing the shared declaration model.
5. Nested and multiple workspace roots.

Pattern evaluation reproduces each supported declaration mechanism's committed include, exclude, and negation semantics without installing dependencies or consulting lockfile-resolved package contents. Monorepo engines such as Turborepo, Nx, Lerna, and Rush are not collected or interpreted. Additional workspace mechanisms and support beyond nested or multiple roots require a future scope decision driven by observed cohort evidence.
