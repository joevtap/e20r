import { Buffer } from "node:buffer";
import { Cause, Duration, Effect, Fiber, Redacted, Schedule, Stream } from "effect";
import type { Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess, ChildProcessSpawner } from "effect/process";

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

/**
 * Credentials for the network steps (clone, and checkouts, which fetch
 * missing blobs). GitHub throttles anonymous git traffic per IP — past a
 * few thousand clones it answers every request with an auth challenge —
 * while authenticated traffic has far higher limits.
 */
export interface GitAuth {
  /** Extra environment for git: never command-line arguments, so never in `ps`. */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * Authenticates git against github.com with a token, as an HTTP header set
 * through git's environment config (`GIT_CONFIG_*`): nothing is written to
 * disk or passed on the command line, and the header is only sent to
 * `https://github.com/`. Any GitHub token can read public repositories.
 */
export const githubTokenAuth = (token: Redacted.Redacted<string>): GitAuth => ({
  env: {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${Redacted.value(token)}`).toString("base64")}`,
  },
});

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
  auth: GitAuth | undefined,
): Effect.Effect<GitOutput, string, Git | Scope.Scope> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const handle = yield* spawner.spawn(
      ChildProcess.make("git", [...args], {
        extendEnv: true,
        env: { GIT_TERMINAL_PROMPT: "0", GIT_LFS_SKIP_SMUDGE: "1", ...auth?.env },
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
  options: {
    readonly timeout: Duration.Input;
    readonly retries?: number;
    readonly auth?: GitAuth | undefined;
  },
): Effect.Effect<string, string, Git> =>
  Effect.gen(function* () {
    const output = yield* gitOutput(args, options.auth);
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
  auth?: GitAuth,
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
      { timeout: "10 minutes", retries: 0, auth },
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
  auth?: GitAuth,
): Effect.Effect<void, string, Git> =>
  Effect.gen(function* () {
    yield* gitStep(
      "git sparse-checkout",
      ["-C", cloneDir, "sparse-checkout", "set", "--no-cone", "--", ...patterns],
      { timeout: "10 minutes", auth },
    );
    yield* gitStep("git checkout", ["-C", cloneDir, "checkout", "--quiet"], {
      timeout: "10 minutes",
      auth,
    });
  });
