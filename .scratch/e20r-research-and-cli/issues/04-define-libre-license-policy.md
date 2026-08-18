# Define the Libre-License Evidence Policy

Type: research
Status: resolved

## Question

What configurable SPDX allowlist and local verification procedure should determine libre-license eligibility, including dual licensing, custom expressions, absent metadata, package-level licenses, and the rule that any applicable non-libre license makes a candidate ineligible while unresolved cases remain quarantined?

## Answer

Use a pinned, configurable SPDX identifier and exact-exception allowlist with three outcomes: all applicable local package/file evidence must pass; any confirmed non-libre evidence, including an `OR` branch, makes the repository ineligible; and missing, custom, malformed, or contradictory evidence remains quarantined for recorded manual review. The full expression semantics, package-scope rules, and reproducible local verification procedure are in [Libre-License Evidence Policy](../../../docs/research/libre-license-evidence-policy.md).
