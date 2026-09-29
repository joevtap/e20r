import { Cause, Duration, Effect, Fiber, Schedule, Stream } from "effect";
import type { Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";

/**
 * Git plumbing for the per-repository pipeline. Clones are blobless and
 * shallow — trees only, no file contents — and file contents are then
 * fetched on demand through sparse checkouts, so a repository costs only
 * the blobs a stage actually reads: its manifests for selection, its
 * TypeScript sources for deep analysis, never assets, binaries or lockfiles.
 */

/**
 * The minimum identity a clone needs: repository name, the branch to clone
 * and the URL to clone from. `GithubRepo` satisfies it structurally.
 */
export interface CloneTarget {
  readonly fullName: string;
  readonly defaultBranch: string;
  readonly htmlUrl: string;
}

type Git = ChildProcessSpawner.ChildProcessSpawner;

interface GitOutput {
  readonly stdout: string;
  readonly stderr: string;
  readonly exitCode: number;
}

/**
 * Runs one git command, draining stdout and stderr concurrently so a chatty
 * child can never block on a full pipe, and returns its captured output and
 * exit code.
 *
 * The environment extends the parent's (PATH, HOME, proxy and CA settings)
 * with `GIT_TERMINAL_PROMPT=0`, so git fails fast instead of hanging on a
 * credential prompt for repos that disappeared or turned private, and
 * `GIT_LFS_SKIP_SMUDGE=1`, so checkouts never download LFS content. Spawn
 * and pipe failures are normalized into the human-readable failure message
 * every caller expects.
 */
const gitOutput = (
  args: ReadonlyArray<string>,
): Effect.Effect<GitOutput, string, Git | Scope.Scope> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const handle = yield* spawner.spawn(
      ChildProcess.make("git", [...args], {
        extendEnv: true,
        env: { GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1" },
      }),
    );

    const stderrFiber = yield* Stream.decodeText(handle.stderr).pipe(
      Stream.mkString,
      Effect.forkChild,
    );
    const stdoutFiber = yield* Stream.decodeText(handle.stdout).pipe(
      Stream.mkString,
      Effect.forkChild,
    );

    const exitCode = yield* handle.exitCode;
    const stderr = yield* Fiber.join(stderrFiber);
    const stdout = yield* Fiber.join(stdoutFiber);

    return { stdout, stderr: stderr.trim(), exitCode };
  }).pipe(
    Effect.mapError((error) =>
      typeof error === "string" ? error : `git ${args[0]} failed: ${String(error)}`,
    ),
  );

/**
 * One git step: a fresh scope (the child is killed when the step ends,
 * times out or is interrupted), a hard timeout so a hung process cannot
 * stall the pipeline, a non-zero exit turned into a failure message, and
 * retries with backoff for transient network failures.
 */
const gitStep = (
  label: string,
  args: ReadonlyArray<string>,
  options: { readonly timeout: Duration.Input; readonly retries?: number },
): Effect.Effect<string, string, Git> =>
  Effect.gen(function* () {
    const output = yield* gitOutput(args);
    if (output.exitCode === 0) return output.stdout;
    return yield* Effect.fail(
      `${label} exited with code ${output.exitCode}${output.stderr === "" ? "" : `: ${output.stderr}`}`,
    );
  }).pipe(
    Effect.scoped,
    Effect.timeout(options.timeout),
    Effect.mapError((error) =>
      Cause.isTimeoutError(error)
        ? `${label} timed out after ${Duration.format(Duration.fromInputUnsafe(options.timeout))}`
        : error,
    ),
    Effect.retry({ times: options.retries ?? 2, schedule: Schedule.exponential("1 second") }),
  );

/**
 * Clones a repository blobless and shallow (default branch, depth 1, no
 * tags, no checkout) into `targetDir`. Every attempt starts by removing the
 * remains of the previous one (a killed clone leaves a partial directory
 * behind, and `git clone` refuses non-empty destinations). The timeout is
 * generous for huge trees; it only exists so a hung process cannot stall
 * the pipeline forever.
 */
export const cloneBlobless = (
  repo: CloneTarget,
  targetDir: string,
): Effect.Effect<void, string, Git | FileSystem.FileSystem> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* Effect.ignore(fs.remove(targetDir, { recursive: true, force: true }));
    yield* gitStep(
      "git clone",
      [
        "clone",
        "--depth",
        "1",
        "--filter=blob:none",
        "--no-checkout",
        "--single-branch",
        "--no-tags",
        "--branch",
        repo.defaultBranch,
        "--quiet",
        repo.htmlUrl,
        targetDir,
      ],
      { timeout: "10 minutes", retries: 0 },
    );
  }).pipe(Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }));

/** The commit hash of the clone's HEAD. */
export const revParseHead = (cloneDir: string): Effect.Effect<string, string, Git> =>
  gitStep("git rev-parse HEAD", ["-C", cloneDir, "rev-parse", "HEAD"], {
    timeout: "30 seconds",
  }).pipe(
    Effect.map((stdout) => stdout.trim()),
    Effect.filterOrFail(
      (commit) => /^[0-9a-f]{40}$/.test(commit),
      (commit) => `git rev-parse HEAD produced no commit hash: ${commit}`,
    ),
  );

/**
 * The raw `git ls-tree -r -z --full-tree HEAD` listing (see `parseLsTree`).
 * Needs trees only, which a blobless clone has; `-l` is deliberately not
 * passed, because blob sizes would force every blob to be fetched.
 */
export const lsTree = (cloneDir: string): Effect.Effect<string, string, Git> =>
  gitStep("git ls-tree", ["-C", cloneDir, "ls-tree", "-r", "-z", "--full-tree", "HEAD"], {
    timeout: "2 minutes",
  });

/**
 * Sets the (non-cone, gitignore-syntax) sparse-checkout patterns and checks
 * the matching files out; missing blobs are fetched from the remote in a
 * batch. Calling it again with wider patterns only fetches the difference.
 */
export const sparseCheckout = (
  cloneDir: string,
  patterns: ReadonlyArray<string>,
): Effect.Effect<void, string, Git> =>
  Effect.gen(function* () {
    yield* gitStep(
      "git sparse-checkout",
      ["-C", cloneDir, "sparse-checkout", "set", "--no-cone", "--", ...patterns],
      { timeout: "10 minutes" },
    );
    yield* gitStep("git checkout", ["-C", cloneDir, "checkout", "--quiet"], {
      timeout: "10 minutes",
    });
  });
