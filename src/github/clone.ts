import { Cause, Effect, Fiber, Option, Schedule, Stream } from "effect";
import type { Scope } from "effect";
import * as FileSystem from "effect/FileSystem";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { GithubRepo } from "../domain/github.ts";

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
 * `GIT_TERMINAL_PROMPT=0` makes git fail fast instead of hanging on a
 * credential prompt for repos that disappeared or turned private. Spawn and
 * pipe failures surface as `PlatformError`s and are normalized into the
 * human-readable failure message every caller expects.
 */
const gitOutput = (
  args: ReadonlyArray<string>,
): Effect.Effect<GitOutput, string, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    const command = ChildProcess.make("git", [...args], {
      env: { GIT_TERMINAL_PROMPT: "0" },
    });

    const handle = yield* spawner.spawn(command);

    // Buffers both streams concurrently with waiting for the exit so a
    // chatty child can never block on a full pipe.
    const stderrFiber = yield* Stream.decodeText(handle.stderr).pipe(
      Stream.mkString,
      Effect.forkChild,
    );
    const stdoutFiber = yield* Stream.decodeText(handle.stdout).pipe(
      Stream.mkString,
      Effect.forkChild,
    );

    const exitCode = yield* handle.exitCode;
    const stderrText = yield* Fiber.join(stderrFiber);
    const stdoutText = yield* Fiber.join(stdoutFiber);

    return {
      stdout: stdoutText.trim(),
      stderr: stderrText.trim(),
      exitCode,
    };
  }).pipe(
    Effect.mapError((error) =>
      typeof error === "string" ? error : `git ${args[0]} failed: ${String(error)}`,
    ),
  );

const attemptClone = (
  repo: GithubRepo,
  targetDir: string,
): Effect.Effect<void, string, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function* () {
    // `--quiet` keeps stderr to actual errors, so buffering it is cheap and
    // gives us the failure reason when the clone fails.
    const output = yield* gitOutput([
      "clone",
      "--depth",
      "1",
      "--single-branch",
      "--no-tags",
      "--branch",
      repo.defaultBranch,
      "--quiet",
      repo.htmlUrl,
      targetDir,
    ]);

    if (output.exitCode === 0) return;

    return yield* Effect.fail(cloneFailureMessage(output));
  });

/**
 * Formats the human-readable failure of a non-zero git invocation: the exit
 * code plus whatever stderr carried (with `--quiet`, actual errors only).
 */
const cloneFailureMessage = (output: GitOutput): string =>
  `git clone exited with code ${output.exitCode}${output.stderr === "" ? "" : `: ${output.stderr}`}`;

const describeCloneError = (error: string | Cause.TimeoutError): string =>
  Cause.isTimeoutError(error) ? "git clone timed out after 2 minutes" : error;

const describeRevParseError = (error: string | Cause.TimeoutError): string =>
  Cause.isTimeoutError(error) ? "git rev-parse HEAD timed out after 30 seconds" : error;

const cloneAttempt = (
  repo: GithubRepo,
  targetDir: string,
): Effect.Effect<void, string, ChildProcessSpawner.ChildProcessSpawner> =>
  attemptClone(repo, targetDir).pipe(
    // A fresh scope per attempt so the killed process of a failed attempt
    // does not linger into the retry.
    Effect.scoped,
    Effect.timeout("2 minutes"),
    Effect.mapError(describeCloneError),
  );

const attemptRevParseHead = (
  cloneDir: string,
): Effect.Effect<string, string, ChildProcessSpawner.ChildProcessSpawner | Scope.Scope> =>
  Effect.gen(function* () {
    const output = yield* gitOutput(["-C", cloneDir, "rev-parse", "HEAD"]);

    if (output.exitCode !== 0) {
      return yield* Effect.fail(
        `git rev-parse HEAD exited with code ${
          output.exitCode
        }${output.stderr === "" ? "" : `: ${output.stderr}`}`,
      );
    }

    const commit = output.stdout;

    if (!/^[0-9a-f]{40}$/.test(commit)) {
      return yield* Effect.fail(`git rev-parse HEAD produced no commit hash: ${commit}`);
    }

    return commit;
  });

/**
 * The commit hash of a clone's HEAD, retried a couple of times: a
 * just-finished clone may still be settling its files. Bounded by a hard
 * timeout so a hung git process cannot stall the pipeline.
 */
const revParseHead = (
  cloneDir: string,
): Effect.Effect<string, string, ChildProcessSpawner.ChildProcessSpawner> =>
  attemptRevParseHead(cloneDir).pipe(
    Effect.scoped,
    Effect.timeout("30 seconds"),
    Effect.mapError(describeRevParseError),
    Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
  );

/**
 * Whether the clone's worktree matches its HEAD exactly: `git diff-index
 * --quiet HEAD` exits non-zero on any missing or modified tracked file.
 *
 * A clone killed mid-checkout still has a resolvable HEAD but an incomplete
 * worktree, so a resolved HEAD alone must not be trusted; a worktree
 * difference means the clone is partial and has to be re-cloned.
 */
const isWorktreeComplete = (
  cloneDir: string,
): Effect.Effect<boolean, string, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const output = yield* gitOutput([
      "-C",
      cloneDir,
      "diff-index",
      "--quiet",
      "--ignore-submodules=all",
      "HEAD",
      "--",
    ]);
    return output.exitCode === 0;
  }).pipe(Effect.scoped);

/**
 * The HEAD commit of an existing clone if and only if the clone is complete
 * and usable: its HEAD resolves and its worktree matches it exactly (a run
 * killed mid-checkout leaves a resolvable HEAD over a partial worktree).
 * Returns `Option.none()` for anything unusable.
 */
const usableCommit = (
  cloneDir: string,
): Effect.Effect<Option.Option<string>, never, ChildProcessSpawner.ChildProcessSpawner> =>
  Effect.gen(function* () {
    const commit = yield* revParseHead(cloneDir).pipe(Effect.option);
    if (Option.isNone(commit)) return Option.none();

    const complete = yield* isWorktreeComplete(cloneDir).pipe(
      Effect.option,
      Effect.map(Option.getOrElse(() => false)),
    );
    return complete ? commit : Option.none();
  });

export interface CloneOutcome {
  /** The commit hash of the cloned HEAD, from `git rev-parse HEAD`. */
  readonly commit: string;

  /** Whether the clone was freshly created instead of reused. */
  readonly fresh: boolean;
}

/**
 * Clones a repository shallowly (its default branch, depth 1, no tags) into
 * `cloneDir`, which must not exist beforehand, and fails with a
 * human-readable message on non-zero exit, spawn errors, or the 2-minute
 * timeout (the child process is killed by the spawner's scope finalizer).
 *
 * Every attempt runs in a fresh scope and is retried with backoff.
 */
const cloneRepo = (
  repo: GithubRepo,
  targetDir: string,
): Effect.Effect<void, string, ChildProcessSpawner.ChildProcessSpawner> =>
  cloneAttempt(repo, targetDir).pipe(
    Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
  );

/**
 * Clones the repository shallowly into `cloneDir` unless a usable clone is
 * already there (reuse makes the step resumable across runs), and returns the
 * commit hash of the cloned HEAD so the recorded state always pins the exact
 * snapshot it describes.
 *
 * Every step is retried and self-healing: if the existing clone directory is
 * corrupt or partial (for example a run was killed mid-clone), it is removed
 * and cloned again, so the pipeline can never get stuck on a stale clone.
 */
export const ensureCloned = (
  repo: GithubRepo,
  cloneDir: string,
): Effect.Effect<
  CloneOutcome,
  string,
  ChildProcessSpawner.ChildProcessSpawner | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const exists = Option.getOrElse(yield* Effect.option(fs.exists(cloneDir)), () => false);

    if (!exists) {
      yield* cloneRepo(repo, cloneDir);
      return { commit: yield* revParseHead(cloneDir), fresh: true } satisfies CloneOutcome;
    }

    // Reuse the existing clone only when its HEAD resolves and its worktree
    // is complete; a run killed mid-checkout leaves a resolvable HEAD over a
    // partial worktree, which would poison the probes. Anything unusable is
    // removed and cloned again, so the run can never get stuck on a broken
    // directory from a previous run.
    const reusedCommit = yield* usableCommit(cloneDir);

    if (Option.isSome(reusedCommit)) {
      return { commit: reusedCommit.value, fresh: false } satisfies CloneOutcome;
    }

    yield* Effect.ignore(fs.remove(cloneDir, { recursive: true, force: true }));
    yield* cloneRepo(repo, cloneDir);
    return { commit: yield* revParseHead(cloneDir), fresh: true } satisfies CloneOutcome;
  });
