import { Cause, Effect, Fiber, Schedule, Stream } from "effect";
import type { PlatformError } from "effect/PlatformError";
import type { Scope } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/unstable/process";
import type { GithubRepo } from "../domain/github.ts";

const attemptClone = (
  repo: GithubRepo,
  targetDir: string,
): Effect.Effect<
  void,
  string | PlatformError,
  ChildProcessSpawner.ChildProcessSpawner | Scope.Scope
> =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

    // `GIT_TERMINAL_PROMPT=0` makes git fail fast instead of hanging on a
    // credential prompt for repos that disappeared or turned private.
    // `--quiet` keeps stderr to actual errors, so buffering it is cheap and
    // gives us the failure reason when the clone fails.
    const command = ChildProcess.make(
      "git",
      [
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
      ],
      { env: { GIT_TERMINAL_PROMPT: "0" } },
    );

    const handle = yield* spawner.spawn(command);

    // Drain stderr concurrently with waiting for the exit so a chatty child
    // can never block on a full pipe.
    const stderrFiber = yield* Stream.decodeText(handle.stderr).pipe(
      Stream.mkString,
      Effect.forkChild,
    );

    const exitCode = yield* handle.exitCode;

    if (exitCode === 0) return;

    const stderrText = (yield* Fiber.join(stderrFiber)).trim();

    return yield* Effect.fail(
      `git clone exited with code ${exitCode}${stderrText === "" ? "" : `: ${stderrText}`}`,
    );
  });

const describeCloneError = (error: string | PlatformError | Cause.TimeoutError): string => {
  if (Cause.isTimeoutError(error)) return "git clone timed out after 2 minutes";
  if (typeof error === "string") return error;
  return `git clone failed: ${error.message}`;
};

/**
 * Clones a repository shallowly (main branch, depth 1, no tags) into
 * `targetDir`, which must not exist beforehand.
 *
 * Fails with a human-readable message on non-zero exit, spawn errors, or the
 * timeout (the child process is killed by the spawner's scope finalizer).
 */
export const cloneRepo = (
  repo: GithubRepo,
  targetDir: string,
): Effect.Effect<void, string, ChildProcessSpawner.ChildProcessSpawner> =>
  attemptClone(repo, targetDir).pipe(
    // A fresh scope per attempt so the killed process of a failed attempt
    // does not linger into the retry.
    Effect.scoped,
    Effect.timeout("2 minutes"),
    Effect.mapError(describeCloneError),
    Effect.retry({ times: 2, schedule: Schedule.exponential("1 second") }),
  );
