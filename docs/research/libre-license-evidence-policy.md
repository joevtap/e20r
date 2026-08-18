# Libre-License Evidence Policy

Research date: 2026-08-18

## Decision

Use a versioned, configurable allowlist of canonical SPDX license identifiers and exact `license WITH exception` combinations, evaluated over locally collected evidence at a pinned repository revision. Classification has three outcomes:

- `eligible`: every applicable license proposition is known and allowlisted, and no applicable evidence conflicts with that conclusion.
- `ineligible`: any applicable license proposition is positively identified as non-libre or explicitly denied. This remains true inside an `OR`; a libre alternative does not rescue a candidate under the study's conservative rule.
- `quarantined`: evidence is missing, malformed, contradictory, custom, or not yet classified. Quarantine is not evidence of non-libre licensing and must not be counted as eligible or ineligible until reviewed.

This is a reproducible study-selection rule, not legal advice or an assertion that SPDX inclusion itself means a license is libre. SPDX's machine-readable list distinguishes `isOsiApproved` and `isFsfLibre`, and many listed licenses have neither flag or an explicit false value ([SPDX License List JSON](https://spdx.org/licenses/licenses.json)). OSI says its approved licenses permit software to be freely used, modified, and shared; the FSF separately classifies licenses as free or nonfree and notes that its list is not exhaustive ([OSI approved licenses](https://opensource.org/licenses), [FSF license list](https://www.gnu.org/licenses/license-list.html)).

## Configuration contract

Pin the policy beside each study run and preserve its digest. A policy contains:

```yaml
schemaVersion: 1
spdxLicenseListVersion: 3.28.0
allow:
  licenses: [0BSD, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MIT]
  withExceptions: []
deny:
  licenses: []
  withExceptions: []
scope:
  packageManifests: all-local
  includeVendoredCode: true
  includeExamplesAndTools: true
  includeGeneratedArtifacts: false
evidence:
  licenseFileNames: [LICENSE, LICENSE.md, LICENSE.txt, LICENCE, COPYING, COPYING.md]
```

The example identifiers are illustrative defaults, not an exhaustive universal libre list. Build or update the actual allowlist only from a reviewed SPDX License List release, accepting an identifier when the configured authority rule is met, for example `isOsiApproved == true OR isFsfLibre == true`. Permit explicit reviewed additions and denials with source, reviewer, rationale, and review date. Never infer libre status merely because an identifier exists in SPDX, lacks a false flag, is deprecated, or has a libre-sounding name.

Canonicalize case-insensitive identifiers to the spelling in the pinned SPDX list; reject unknown identifiers and record deprecated identifiers while mapping them only through SPDX's published replacement data. Operators are case-sensitive. Preserve parentheses and parse according to SPDX precedence: `+`, `WITH`, `AND`, then `OR` ([SPDX 2.3 Annex D](https://spdx.github.io/spdx-spec/v2.3/SPDX-license-expressions/)). Do not use regex or substring matching as the expression parser.

An exception changes the terms. A `WITH` node is eligible only if its exact canonical pair is in `allow.withExceptions`; an allowlisted base license alone is insufficient. `LicenseRef-*`, `DocumentRef-*:LicenseRef-*`, legacy custom strings, and npm's `SEE LICENSE IN <filename>` require local text review and remain quarantined until represented by an explicit reviewed policy entry. `UNLICENSED`, an explicit proprietary/noncommercial/source-available term, or an exact deny entry is ineligible. Absence of a deny entry never implies eligibility.

## Expression evaluation

Evaluate the parsed expression recursively, retaining the syntax tree and each leaf's policy result.

| Expression | Study result |
| --- | --- |
| Allowlisted identifier | eligible |
| Denied or confirmed non-libre identifier | ineligible |
| Unknown/unreviewed identifier or `LicenseRef` | quarantined |
| `A WITH E` | eligible only for an exact allowlisted pair; denied pair is ineligible; otherwise quarantined |
| `A AND B` | ineligible if either side is ineligible; quarantined if neither is ineligible and either is unresolved; otherwise eligible |
| `A OR B` | use the same conservative aggregation as `AND`: any ineligible branch makes the candidate ineligible; otherwise any unresolved branch quarantines; only all-eligible branches pass |

SPDX normally uses `OR` for a choice and `AND` when simultaneous compliance is required ([SPDX 2.3 Annex D](https://spdx.github.io/spdx-spec/v2.3/SPDX-license-expressions/)). Treating both with universal aggregation is an intentional study policy implementing the user's rule that any applicable non-libre license makes the candidate ineligible, not a reinterpretation of SPDX legal semantics.

## Local verification procedure

1. Pin the repository commit, policy file, policy digest, SPDX list version, and verifier version. Perform all classification against that checkout, not mutable forge metadata.
2. Enumerate every local package boundary selected by the configured scope, including the root, workspace members, nested manifests, and vendored source. Record excluded generated or third-party artifact paths and why they are outside scope. Do not assume a root license automatically governs every package.
3. For each boundary, collect manifest license fields, referenced custom-license files, nearest applicable `LICENSE`/`COPYING`/`NOTICE` files up the directory tree, package-specific license files, SPDX file headers, and license notices in vendored files. npm directs packages to use an SPDX expression, a top-level file for `SEE LICENSE IN`, and `UNLICENSED` when no rights are granted ([npm `package.json` license field](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#license)).
4. Record evidence verbatim with relative path, line or field location, content hash, package boundary, and provenance kind. Parse syntactically valid SPDX expressions against the pinned list. Do not silently repair malformed expressions.
5. Reconcile evidence per package. Manifest metadata is a declaration, not proof that file-level terms agree. SPDX distinguishes the author's declared license, all licenses detected in files, and the reviewer's concluded license; a differing conclusion should have an explanation ([SPDX 2.3 package fields 7.13-7.16](https://spdx.github.io/spdx-spec/v2.3/package-information/#713-concluded-license-field)). Preserve all three concepts in the evidence record.
6. If metadata is absent, inspect local license texts and file headers. No license evidence (`NONE` in SPDX terminology), no attempted conclusion (`NOASSERTION`), malformed metadata, an unreadable referenced file, an unknown custom license, or conflicting declarations all quarantine. They never default to a permissive license.
7. Evaluate every applicable package expression and detected file license. A package is ineligible on any positive non-libre result, quarantined if there is no ineligible result but any unresolved evidence remains, and eligible only when all applicable evidence passes. Repository eligibility is the same aggregation across packages.
8. Emit an auditable result containing outcome, reason codes, normalized expressions, all evidence locations and hashes, policy/list versions and digests, package scope, exclusions, and manual-review decisions. Re-run verification whenever the commit, policy, SPDX list, or scope changes.

## Dual licensing and conflicts

Preserve the author's operator exactly. `MIT OR GPL-3.0-only` is dual licensing by choice; `MIT AND GPL-3.0-only` says both sets of terms apply. Under this policy both pass only when both identifiers are allowlisted. `MIT OR <confirmed non-libre>` is ineligible by the conservative rule. `MIT OR LicenseRef-Custom` is quarantined until the custom branch is reviewed. A manifest saying MIT while a package-local license adds a noncommercial restriction is ineligible because positive non-libre local evidence outranks the permissive declaration; a merely unexplained mismatch is quarantined pending determination.

Package-level terms apply to that package and its covered files. A package with no local declaration may inherit an ancestor license only when the ancestor text or project documentation clearly states that scope; otherwise quarantine it. Development tools, examples, and vendored code are applicable by default because they are part of the analyzed candidate, but the scope is configurable and exclusions must be explicit before collection rather than chosen after seeing a license result. Registry metadata for external dependencies is not a substitute for repository-local evidence; bundled or vendored dependency source is local and must be checked.

## Quarantine resolution

Manual review may resolve quarantine only by adding evidence or a reviewed policy entry, never by overriding the outcome ad hoc. Record the exact text hash and map custom terms either to a matched SPDX identifier using SPDX's matching guidance or to a stable local `LicenseRef`; then classify that reference with primary authority and rationale. A reviewer who cannot establish permission to use, modify, and redistribute leaves the candidate quarantined. If review establishes a field-of-use, noncommercial, no-derivatives, delayed-open, or other non-libre restriction, mark it ineligible.

## Sources

- SPDX, [License List JSON](https://spdx.org/licenses/licenses.json), machine-readable identifiers and OSI/FSF flags (accessed 2026-08-18; observed list version 3.28.0).
- SPDX Specification 2.3, [Annex D: SPDX License Expressions](https://spdx.github.io/spdx-spec/v2.3/SPDX-license-expressions/), normative expression grammar and operator meaning.
- SPDX Specification 2.3, [Clause 7: Package Information](https://spdx.github.io/spdx-spec/v2.3/package-information/), especially declared, detected, and concluded license fields and `NONE`/`NOASSERTION`.
- Open Source Initiative, [OSI Approved Licenses](https://opensource.org/licenses), approval meaning and SPDX identifiers.
- Free Software Foundation, [Various Licenses and Comments about Them](https://www.gnu.org/licenses/license-list.html), free/nonfree classifications and stated limits.
- npm, [`package.json` license field](https://docs.npmjs.com/cli/v11/configuring-npm/package-json/#license), package metadata conventions for SPDX, custom files, and `UNLICENSED`.
