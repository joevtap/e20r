# Execute the Development Validation Progression

Type: task
Status: open
Blocked by: 06

## Question

Implement and run the development-only synthetic-fixture, pinned `niklaserik/effect-mcp`, and pinned `anomalyco/opencode` validation stages specified by **Validate the Real-Repository Progression**, preserving the fixed Signal Ledger and Probe Attempt interface and recording the evidence, accepted limitations, and failures needed to unblock durable SQLite state design.

This task primarily produces design evidence. It does not implement the final cohort pipeline, ship the progression gate, or make the pinned repositories runtime dependencies of e20r. Its sole approved product-facing exception is a generic, explicitly unsupported `e20r unstable validate repository` adapter over Candidate Evaluator for manual validation; the later stable CLI remains owned by **Specify the Incremental e20r CLI**.
