# Define the Initial Repository Evidence Report

Type: prototype
Status: resolved

## Question

What is the smallest concrete JSON Repository Report and synthetic single-package fixture matrix that faithfully records qualification evidence, eligible TypeScript files, Effect-importing files, declared Effect specifiers, package-manager signals, Node.js host-runtime signals, exclusions, provenance, and collection failures without performing Study Analysis?

## Answer

Use a nested, versioned Repository Report organized as repository identity and revision, collection completeness, package boundaries, excluded files, and scoped collection failures. Each package boundary records its manifest, verbatim declared Effect specifier when present, package-manager signals, host-runtime signals, eligible source-file inventory, and verified Effect-using source files with their imports.

Every observed scientific value carries its own provenance: source location, collection method, and observation time. Absence is represented by an empty collection or null observation only after the corresponding collection step completed; an unrun or failed step remains distinguishable through the report-level collection status and completed/failed step lists.

The report records the two inputs needed to derive repository qualification later: a direct `dependencies.effect` declaration and verified Effect use in an eligible source file associated with the same package boundary. It does not store a `qualified` boolean or any other Study Analysis classification.

Collection failures are data, not fatal report-envelope errors. A partial report retains all successful evidence, marks completeness as `partial`, and records each failure's step, scope, subject path, stable kind, and diagnostic message. Exclusions likewise record the excluded path, stable reason, and rule provenance rather than silently removing files.

The initial synthetic single-package fixture matrix contains four cases:

| Case | Evidence varied | Behavior established |
| --- | --- | --- |
| Qualified npm/Node fixture | Direct Effect declaration, npm lockfile, Node engine, eligible `.ts` files, verified Effect import | All qualification inputs and independent package-manager/runtime evidence can coexist without deriving a classification |
| Declaration without use | Direct Effect declaration but no verified Effect-using file | Declaration alone does not supply the missing usage evidence |
| Eligible and excluded files | Source files plus generated output, declaration files, tests, or configured ignored paths | Eligible inventory and reasoned exclusions remain explicit and disjoint |
| Partial source collection | Successful manifest evidence plus one unreadable source path | Successful evidence survives; failure is not converted into evidence of absence |

The model and awkward transitions were validated in the throwaway [Initial Repository Report prototype](../prototypes/initial-repository-report.html), including declaration-only, partial-collection, and out-of-order usage-verification walkthroughs.
