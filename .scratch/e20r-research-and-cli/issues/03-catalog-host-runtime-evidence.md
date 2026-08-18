# Catalog Host-Runtime Evidence

Type: research
Status: resolved

## Question

Which deterministic, provenance-preserving evidence sources can establish Node.js, Bun, and Deno Host Runtime signals at Package and source boundaries, and which tempting signals are too weak to record as affirmative runtime evidence?

## Answer

Collect explicit Node.js, Bun, and Deno declarations, runtime-specific configuration, invocations, identity checks, and unique APIs as separate provenance-rich observations. Shared APIs, package-manager artifacts, frameworks, and development tooling remain weak observations and must not affirm a Host Runtime; classification is deferred to Study Analysis. Browser, Electron, and edge platforms are not Host Runtimes in e20r and are not collected by this catalog. See [Host-Runtime Evidence Catalog](../../../docs/research/host-runtime-evidence-catalog.md).
