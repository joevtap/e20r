# Catalog Host-Runtime Evidence

Type: research
Status: resolved

## Question

Which deterministic, provenance-preserving evidence sources can establish Node.js, Bun, Deno, browser, Electron, and edge host-runtime signals at package and source boundaries, and which tempting signals are too weak to record as affirmative runtime evidence?

## Answer

Collect explicit host declarations, runtime-specific configuration/invocations/APIs, browser entry/DOM evidence, Electron APIs, and provider-specific edge deployment contracts as separate provenance-rich observations. Shared Node/Web APIs, package-manager artifacts, frameworks, dev tooling, and generic worker/edge vocabulary remain weak observations and must not affirm a host; classification is deferred to Study Analysis. See [Host-Runtime Evidence Catalog](../../../docs/research/host-runtime-evidence-catalog.md).
