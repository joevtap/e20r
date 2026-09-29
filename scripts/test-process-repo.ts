// Ad-hoc end-to-end check of the per-repository pipeline on hand-picked
// repositories (clone, select, exclude or deep-analyze, commit), against an
// in-memory database. Needs network access; git is authenticated when
// GITHUB_API_KEY is set in the environment. Run from the repository root:
//
//   GITHUB_API_KEY=… pnpm tsx scripts/test-process-repo.ts Effect-TS/effect pingdotgg/uploadthing
//
import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Effect, FileSystem, Redacted } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";
import { execFileSync } from "node:child_process";
import { githubTokenAuth } from "../src/github/git.ts";
import { processRepo } from "../src/pipeline/process-repo.ts";
import { makeDatabaseLayer } from "../src/store/db.ts";
import { Store } from "../src/store/store.ts";

const names = process.argv.slice(2);

/** The default branch of a GitHub repository, from `git ls-remote --symref`. */
const defaultBranch = (url: string): string => {
  const token = process.env["GITHUB_API_KEY"];
  const env = token
    ? { ...process.env, ...githubTokenAuth(Redacted.make(token)).env, GIT_TERMINAL_PROMPT: "0" }
    : { ...process.env, GIT_TERMINAL_PROMPT: "0" };
  const output = execFileSync("git", ["ls-remote", "--symref", url, "HEAD"], {
    encoding: "utf8",
    env,
  });
  return /ref: refs\/heads\/(\S+)\s+HEAD/.exec(output)?.[1] ?? "main";
};

const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const sql = yield* SqlClient.SqlClient;
  const store = yield* Store;
  const workDir = yield* fs.makeTempDirectoryScoped({ prefix: "e20r-smoke-" });

  for (const [index, fullName] of names.entries()) {
    const htmlUrl = `https://github.com/${fullName}`;
    const repo = {
      id: index + 1,
      fullName,
      owner: fullName.split("/")[0] ?? "",
      defaultBranch: defaultBranch(htmlUrl),
      htmlUrl,
      stars: 0,
    };
    const result = yield* processRepo(repo, {
      runId: 0,
      workDir,
      keepClones: false,
      skipAnalysis: false,
      maxParseBytes: 1_000_000,
      exclusion: { excludeRepos: [], excludeEffectPackageDefiners: true },
      gitAuth: process.env["GITHUB_API_KEY"]
        ? githubTokenAuth(Redacted.make(process.env["GITHUB_API_KEY"]))
        : undefined,
    });
    console.log(fullName, JSON.stringify(result));
  }

  console.log(JSON.stringify(yield* store.population));
  const rows =
    yield* sql`SELECT repo_id, full_name, status, excluded_reason, timings FROM repo_state`;
  for (const row of rows) console.log(JSON.stringify(row));
  const adoption = yield* sql`SELECT * FROM v_repo_adoption`;
  for (const row of adoption) console.log(JSON.stringify(row));
  const packages =
    yield* sql`SELECT * FROM workspace_packages WHERE effect_dependency IS NOT NULL LIMIT 8`;
  for (const row of packages) console.log(JSON.stringify(row));
  console.log(`work dir entries left: ${(yield* fs.readDirectory(workDir)).length}`);
});

NodeRuntime.runMain(
  program.pipe(
    Effect.scoped,
    Effect.provide(makeDatabaseLayer(":memory:")),
    Effect.provide(NodeServices.layer),
  ),
);
