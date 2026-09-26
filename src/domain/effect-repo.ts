import { Schema } from "effect";

/**
 * A repository positively identified as using Effect at runtime
 * (`dependencies`/`optionalDependencies`, or a catalog reference).
 *
 * Records are appended to `effect-repos.jsonl`, keyed by `repoId` for resume;
 * they are the hand-off from the clone-and-select stage to the deep analysis
 * stage. Deep analysis happens in later stages and has no probes or signals
 * defined yet; each stage owns its own state file keyed by `repoId`, so this
 * record only needs identity and the pinned clone reference.
 */
export const EffectRepoStateSchema = Schema.Struct({
  repoId: Schema.Finite,
  fullName: Schema.String,
  defaultBranch: Schema.String,
  commit: Schema.String,
  recordedAt: Schema.DateTimeUtcFromString,
});

export type EffectRepoState = Schema.Schema.Type<typeof EffectRepoStateSchema>;
