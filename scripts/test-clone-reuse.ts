import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem } from "effect";
import { ensureCloned } from "../src/github/clone.ts";
import type { GithubRepo } from "../src/domain/github.ts";

const repo = {
  id: 1,
  fullName: "Effect-TS/effect",
  url: "",
  license: null,
  language: "TypeScript",
  description: null,
  defaultBranch: "main",
  stargazersCount: 0,
  forksCount: 0,
  fork: false,
  private: false,
  archived: false,
  disabled: false,
  visibility: "public",
  createdAt: new Date(0),
  updatedAt: new Date(0),
  pushedAt: new Date(0),
  nodeId: "n",
  name: "effect",
  owner: {
    login: "Effect-TS",
    id: 2,
    type: "Organization",
    htmlUrl: "",
    avatarUrl: "",
    siteAdmin: false,
  },
  htmlUrl: "https://github.com/Effect-TS/effect",
  homepage: null,
  size: 0,
  watchersCount: 0,
  openIssuesCount: 0,
  topics: [],
  forks: 0,
  openIssues: 0,
  watchers: 0,
  score: 1,
} as unknown as GithubRepo;

const base = "/tmp/opencode/clone-partial-test";
const dir = `${base}/repo`;

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.remove(base, { recursive: true, force: true });

  // full clone first
  const first = yield* ensureCloned(repo, dir);
  console.log(`setup: fresh=${first.fresh} commit=${first.commit.slice(0, 8)}`);

  // simulate a clone killed mid-checkout: .git + HEAD intact, worktree files gone
  yield* fs.remove(`${dir}/packages`, { recursive: true, force: true });
  yield* fs.remove(`${dir}/package.json`, { force: true });
  const missingNow = !(yield* fs.exists(`${dir}/package.json`));
  console.log(`worktree damaged: package.json missing=${missingNow}`);

  // does the reuse path trust the incomplete worktree?
  const second = yield* Effect.result(ensureCloned(repo, dir));
  if (second._tag === "Failure") {
    console.log(`RESULT: reuse rejected with error: ${String(second.failure).slice(0, 90)}`);
  } else {
    const healed = yield* fs.exists(`${dir}/package.json`);
    console.log(
      second.success.fresh === false
        ? `GAP: reuse TRUSTED the incomplete worktree (fresh=false, package.json back=${healed})`
        : `HEALED: re-cloned (fresh=${second.success.fresh}), package.json back=${healed}`,
    );
    console.log(`commit=${second.success.commit.slice(0, 8)}`);
  }

  yield* fs.remove(base, { recursive: true, force: true });
});

NodeRuntime.runMain(program.pipe(Effect.provide(NodeServices.layer)));
