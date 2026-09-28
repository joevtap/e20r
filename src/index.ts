import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Command, Flag } from "effect/unstable/cli";
import {
  Array,
  DateTime,
  Duration,
  Effect,
  FileSystem,
  Layer,
  Option,
  Order,
  Result,
  Schedule,
  Stream,
} from "effect";
import { AppConfig, AppConfigLayer, makeAppConfigOverlayLayer } from "./config.ts";
import { CacheDir, CacheDirLayer } from "./cache.ts";
import { ensureCloned } from "./github/clone.ts";
import { analyzeRepo } from "./analysis/probe.ts";
import { runDeepAnalysis } from "./deep-analysis/stage.ts";
import { isEffectAdopter, type RepoCloneState } from "./domain/clone-state.ts";
import { hasEffectCodeUsage } from "./domain/analysis-state.ts";
import { makeRunSummary } from "./domain/run-summary.ts";
import type { EffectRepoState } from "./domain/effect-repo.ts";
import {
  FetchHttpClient,
  Headers,
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
} from "effect/unstable/http";
import { RateLimiter } from "effect/unstable/persistence";
import { type GithubRepo, GithubRepoSearchResponseSchema } from "./domain/github.ts";

/**
 * Parses the URL of the `rel="next"` entry out of an RFC 8288 `Link` header
 * value. Returns `Option.none()` when there is no such entry, which is how
 * GitHub signals the last page.
 */
const parseNextLink = (header: string): Option.Option<string> =>
  Array.findFirst(header.split(","), (link) => link.includes('rel="next"')).pipe(
    Option.flatMap((link) => Option.fromUndefinedOr(/<([^>]+)>/.exec(link)?.[1])),
  );

const secondsSince = (started: number): string => `${((Date.now() - started) / 1000).toFixed(1)}s`;

const e20r = Command.make(
  "e20r",
  {
    repoSearchBudget: Flag.integer("repo-search-budget").pipe(
      Flag.withAlias("b"),
      Flag.withDescription("Number of top TypeScript repositories to inspect"),
      Flag.optional,
    ),
    cachePath: Flag.path("cache-path").pipe(
      Flag.withDescription("Directory used for the local cache"),
      Flag.optional,
    ),
    noCache: Flag.boolean("no-cache").pipe(
      Flag.withDescription("Disable reading and writing the local cache; the run stays in memory"),
      Flag.optional,
    ),
    ephemeral: Flag.boolean("ephemeral").pipe(
      Flag.withDescription("Delete clones after their analysis completes successfully"),
      Flag.optional,
    ),
    cloneConcurrency: Flag.integer("clone-concurrency").pipe(
      Flag.withDescription("Number of repositories cloned and analyzed in parallel"),
      Flag.optional,
    ),
    analysisConcurrency: Flag.integer("analysis-concurrency").pipe(
      Flag.withDescription(
        "Number of deep-analysis (AST) sessions in parallel (1-16; each can use hundreds of MB to a few GB)",
      ),
      Flag.optional,
    ),
    noAst: Flag.boolean("no-ast").pipe(
      Flag.withDescription(
        "Skip the TypeScript AST phase: usage signals come from the text scanner, no symbol counts",
      ),
      Flag.optional,
    ),
    clean: Flag.boolean("clean").pipe(
      Flag.withDescription("Wipe the cache state and clones before the run starts"),
      Flag.optional,
    ),
    fresh: Flag.boolean("fresh").pipe(
      Flag.withDescription("Re-process every repository even if its state is already recorded"),
      Flag.optional,
    ),
    fromCache: Flag.boolean("from-cache").pipe(
      Flag.withDescription("Skip the GitHub search and select the top repositories from the cache"),
      Flag.optional,
    ),
    analysisOnly: Flag.boolean("analysis-only").pipe(
      Flag.withDescription(
        "Skip the crawl and selection; deep-analyze the cached Effect adopters only",
      ),
      Flag.optional,
    ),
    skipAnalysis: Flag.boolean("skip-analysis").pipe(
      Flag.withDescription("Skip the deep-analysis stage of the selected Effect adopters"),
      Flag.optional,
    ),
  },
  // Flag values flow into the handler through the AppConfig overlay layer
  // provided below, not as direct arguments.
  () =>
    Effect.gen(function* () {
      // Loading configuration service so we know it is working
      const config = yield* AppConfig;

      const cache = yield* CacheDir;

      const limiter = yield* RateLimiter.RateLimiter;

      const githubRepoSearchClient = (yield* HttpClient.HttpClient).pipe(
        HttpClient.withRateLimiter({
          limiter,
          key: "github-search",
          window: "1 minute",
          limit: 15,
        }),
        HttpClient.mapRequest(HttpClientRequest.bearerToken(config.githubApiKey)),
        HttpClient.filterStatusOk,
        HttpClient.retryTransient({
          schedule: Schedule.exponential(100),
          times: 3,
        }),
      );

      // GitHub's Search endpoint signals quota exhaustion with 403 responses
      // (not 429) carrying `retry-after` and/or `x-ratelimit-reset` headers,
      // which `withRateLimiter` does not see (it only retries 429s). The delay
      // is the largest of the two server-indicated values (`retry-after` can be
      // a worthless 0 while the primary window is still exhausted); one minute
      // is the fallback when neither is present.
      const rateLimitDelay = (
        response: HttpClientResponse.HttpClientResponse,
      ): Duration.Duration => {
        const fromHeader = (
          name: string,
          toSeconds: (value: number) => number,
        ): Option.Option<number> =>
          Headers.get(response.headers, name).pipe(
            Option.map(Number),
            Option.filter(Number.isFinite),
            Option.map(toSeconds),
          );

        const seconds = Math.max(
          Option.getOrElse(
            fromHeader("retry-after", (s) => s + 1),
            () => 0,
          ),
          Option.getOrElse(
            fromHeader("x-ratelimit-reset", (epoch) => Math.max(epoch - Date.now() / 1000, 1)),
            () => 0,
          ),
        );

        return seconds > 0 ? Duration.seconds(seconds) : Duration.minutes(1);
      };

      const fetchPage = (
        url: string,
        retriesLeft = 3,
      ): Effect.Effect<
        HttpClientResponse.HttpClientResponse,
        HttpClientError.HttpClientError | RateLimiter.RateLimiterError
      > =>
        githubRepoSearchClient.get(url).pipe(
          Effect.catchIf(
            HttpClientError.isHttpClientError,
            Effect.fn(function* (
              error: HttpClientError.HttpClientError | RateLimiter.RateLimiterError,
            ) {
              if (!HttpClientError.isHttpClientError(error)) return yield* error;
              const status = error.response?.status;
              if (
                retriesLeft <= 0 ||
                error.response === undefined ||
                (status !== 403 && status !== 429)
              ) {
                return yield* error;
              }
              const delay = rateLimitDelay(error.response);
              yield* Effect.log(
                `Rate limited (HTTP ${error.response.status}); retrying in ${Duration.toMillis(delay) / 1000}s`,
              );
              yield* Effect.sleep(delay);
              return yield* fetchPage(url, retriesLeft - 1);
            }),
          ),
        );

      const buildSearchUrl = (maxStars?: number) =>
        `https://api.github.com/search/repositories?${new URLSearchParams({
          q:
            maxStars === undefined
              ? "language:typescript fork:false archived:false"
              : `language:typescript fork:false archived:false stars:<=${maxStars}`,
          sort: "stars",
          order: "desc",
          per_page: "100",
          page: "1",
        })}`;

      interface SearchState {
        readonly url: string;
        readonly lastSeenStars: Option.Option<number>;
        readonly intervalBound: Option.Option<number>;
      }

      // Search progress for logging
      const stats = { pages: 0, items: 0, cached: 0 };

      // Crawled repositories of previous runs: the source of the
      // --from-cache selection and of the resumed adopter selections below.
      const reposById = yield* cache.reposById;

      const repos = Stream.paginate(
        {
          url: buildSearchUrl(),
          lastSeenStars: Option.none(),
          intervalBound: Option.none(),
        } satisfies SearchState,
        (state) =>
          fetchPage(state.url).pipe(
            Effect.flatMap((response) =>
              Effect.gen(function* () {
                const body = yield* HttpClientResponse.schemaBodyJson(
                  GithubRepoSearchResponseSchema,
                )(response);

                stats.pages++;
                stats.items += body.items.length;

                // Cache each page as it arrives instead of only at the end of
                // the crawl: a crash mid-crawl keeps the gathered repositories
                // on disk, and already-cached ids are appended only once.
                stats.cached += yield* cache.appendRepos(body.items);

                const lastSeenStars = Option.orElse(
                  Option.map(Array.last(body.items), (repo) => repo.stargazersCount),
                  () => state.lastSeenStars,
                );
                const nextPageUrl = Headers.get(response.headers, "link").pipe(
                  Option.flatMap(parseNextLink),
                );

                const intervalLabel = Option.match(state.intervalBound, {
                  onNone: () => "any stars",
                  onSome: (bound) => `stars<=${bound}`,
                });
                if (Option.isNone(state.lastSeenStars)) {
                  yield* Effect.log(`Starting interval ${intervalLabel}`);
                }
                yield* Effect.log(
                  `Page ${stats.pages} (${intervalLabel}): +${body.items.length} repos, down to ★${Option.getOrElse(
                    lastSeenStars,
                    () => 0,
                  )}`,
                );

                const nextState = Option.match(nextPageUrl, {
                  onSome: (url) =>
                    Option.some<SearchState>({
                      url,
                      lastSeenStars,
                      intervalBound: state.intervalBound,
                    }),
                  onNone: () =>
                    Option.match(lastSeenStars, {
                      onSome: (stars) => {
                        // Chain the next interval bounded by the lowest star count seen. If the whole interval was a single star, the bound cannot stay equal or the same query would be re-issued forever
                        const nextBound = Option.match(state.intervalBound, {
                          onNone: () => stars,
                          onSome: (bound) => (stars < bound ? stars : stars - 1),
                        });
                        return nextBound >= 1
                          ? Option.some<SearchState>({
                              url: buildSearchUrl(nextBound),
                              lastSeenStars: Option.none(),
                              intervalBound: Option.some(nextBound),
                            })
                          : Option.none();
                      },
                      onNone: () => Option.none(),
                    }),
                });

                return [body.items, nextState] as const;
              }),
            ),
          ),
      );

      // Deduplicates by repository id
      const seen = new Set<number>();
      const uniqueRepos = repos.pipe(
        Stream.filterMap((repo) => {
          if (seen.has(repo.id)) return Result.failVoid;
          seen.add(repo.id);
          return Result.succeed(repo);
        }),
      );

      // Total order for the top repositories: stars first, then fork count, then full name, all descending except the name
      const repoOrder = Order.combineAll([
        Order.mapInput(Order.flip(Order.Number), (repo: GithubRepo) => repo.stargazersCount),
        Order.mapInput(Order.flip(Order.Number), (repo: GithubRepo) => repo.forksCount),
        Order.mapInput(Order.String, (repo: GithubRepo) => repo.fullName),
      ]);

      let collected = 0;
      let cutOffStars = 0;

      // --from-cache skips the GitHub search entirely and selects the top
      // repositories from the crawl cache; the search stream below is only
      // pulled when a fresh crawl is wanted.
      // --analysis-only skips the crawl and selection entirely: the
      // deep-analysis stage below then works off the cached adopter
      // selections, so nothing has to be collected here.
      const collectedRepos = config.analysisOnly
        ? []
        : config.fromCache
          ? yield* Effect.map(cache.reposById, (cached) => [...cached.values()])
          : yield* uniqueRepos.pipe(
              Stream.throttle({ cost: () => 1, units: 1, duration: "3 seconds" }),
              Stream.takeWhile((repo) => {
                collected++;
                if (collected === config.repoSearchBudget) cutOffStars = repo.stargazersCount;
                return collected <= config.repoSearchBudget || repo.stargazersCount >= cutOffStars;
              }),
              Stream.runCollect,
            );

      // Sort the whole collected set by the total order, then keep the top N.
      const topRepos = Array.take(Array.sort(repoOrder)(collectedRepos), config.repoSearchBudget);

      if (!config.analysisOnly) {
        yield* Effect.log(
          config.fromCache
            ? `Selected ${topRepos.length} of ${collectedRepos.length} cached repositories; keeping top ${config.repoSearchBudget}.`
            : `Crawled ${stats.pages} pages: ${collectedRepos.length} unique repositories ` +
                `(${stats.items - collectedRepos.length} boundary re-listings skipped), cut-off at ★${cutOffStars}; ` +
                `keeping top ${config.repoSearchBudget}.`,
        );

        if (!config.fromCache) {
          yield* Effect.log(
            cache.enabled
              ? `Crawl cached ${stats.cached} new repositories in ${cache.root}`
              : "Cache disabled; results kept in memory only",
          );
        }
      }

      const cloneStatesById = yield* cache.cloneStateById;
      // --fresh re-processes everything, so nothing counts as already done.
      const previouslyRecorded = config.fresh
        ? 0
        : Array.filter(topRepos, (repo) => cloneStatesById.get(repo.id)?.cloneStatus === "cloned")
            .length;

      // Resume per repository, keyed by the clone-state cache:
      // 1. recorded as cloned -> skip entirely (probes already ran)
      // 2. recorded as clone-failed -> retriable: retry clone and probes
      // 3. not recorded -> clone and probe from scratch
      // (--fresh ignores the recorded state and re-runs every repository.)
      let freshClones = 0;
      let reusedClones = 0;
      let cloneFailures = 0;

      // Selections of Effect adopters for the deep-analysis stage, appended
      // to their own state file.

      // A previous run may have recorded the adopter state but failed to
      // append the selection hand-off (disk full, crash): selections of
      // already-recorded adopters are re-attempted on resume, and the
      // append dedupe makes re-attempts idempotent.
      const recoveredSelections: Array<EffectRepoState> = [];
      for (const cloneState of cloneStatesById.values()) {
        const repo = reposById.get(cloneState.repoId);
        if (
          cloneState.cloneStatus === "cloned" &&
          cloneState.adopter &&
          cloneState.commit !== undefined &&
          repo !== undefined
        ) {
          recoveredSelections.push({
            repoId: cloneState.repoId,
            fullName: cloneState.fullName,
            defaultBranch: repo.defaultBranch,
            commit: cloneState.commit,
            recordedAt: cloneState.recordedAt,
          });
        }
      }

      if (recoveredSelections.length > 0) {
        const recovered = yield* cache.appendEffectRepos(recoveredSelections).pipe(Effect.option);
        yield* Effect.log(
          Option.isNone(recovered)
            ? `Failed to recover ${recoveredSelections.length} prior Effect adopter selections`
            : `Recovered ${recoveredSelections.length} prior Effect adopter selections (${recovered.value} newly recorded)`,
        );
      }

      const effectRepos: Array<EffectRepoState> = [];
      let effectReposLost = 0;

      // Clone-phase progress: one line per repository plus a rollup every
      // ~30 seconds, so a long cloning stretch is never silent.
      const progress = {
        completed: 0,
        failed: 0,
        started: Date.now(),
        lastRollup: Date.now(),
      };

      const rollup = Effect.sync(() => {
        const now = Date.now();
        if (now - progress.lastRollup < 30_000) return;
        progress.lastRollup = now;
        const elapsed = (now - progress.started) / 1000;
        const rate = elapsed > 0 ? progress.completed / elapsed : 0;
        const remaining = rate > 0 ? (topRepos.length - progress.completed) / rate : 0;
        return (
          `cloning ${progress.completed}/${topRepos.length} · ${progress.failed} failures · ` +
          `${Math.round(elapsed / 60)}m elapsed · ~${Math.round(remaining / 60)}m left`
        );
      });

      const progressLog = Effect.gen(function* () {
        const line = yield* rollup;
        if (line !== undefined) yield* Effect.log(line);
      });

      const recordCloneState = (cloneState: RepoCloneState): Effect.Effect<boolean> =>
        Effect.gen(function* () {
          // A hard failure to record is logged and carried on with: the run
          // keeps working, and the repo's missing record makes the next run
          // retry it (per-repo resume is keyed on the recorded state).
          const written = yield* cache.appendCloneStates([cloneState]).pipe(Effect.option);
          if (Option.isNone(written)) {
            yield* Effect.logWarning(
              `Failed to record clone state of ${cloneState.fullName} after retries`,
            );
            return false;
          }
          return written.value > 0;
        });

      const clonedRepos = yield* Effect.forEach(
        topRepos,
        Effect.fn("clone-and-select")(function* (repo: GithubRepo) {
          const started = Date.now();
          const where = `[${++progress.completed}/${topRepos.length}]`;

          // --fresh re-processes recorded repositories as well.
          if (!config.fresh && cloneStatesById.get(repo.id)?.cloneStatus === "cloned") {
            yield* Effect.log(`${where} ${repo.fullName}: already recorded (skipped)`);
            yield* progressLog;
            return undefined;
          }

          const cloneDir = cache.cloneDirFor(repo);
          const fs = yield* FileSystem.FileSystem;

          const outcome = yield* ensureCloned(repo, cloneDir).pipe(Effect.result);

          if (Result.isFailure(outcome)) {
            cloneFailures++;
            progress.failed++;
            const cloneError = Option.getOrUndefined(Result.getFailure(outcome));
            yield* Effect.log(
              `${where} ${repo.fullName}: clone failed in ${secondsSince(started)} — ${cloneError ?? "unknown error"}`,
            );
            yield* progressLog;
            const cloneState: RepoCloneState = {
              repoId: repo.id,
              fullName: repo.fullName,
              cloneStatus: "clone-failed",
              ...(cloneError === undefined ? {} : { cloneError }),
              signals: [],
              adopter: false,
              recordedAt: yield* DateTime.now,
            };
            yield* recordCloneState(cloneState);
            return cloneState;
          }

          if (outcome.success.fresh) {
            freshClones++;
          } else {
            reusedClones++;
          }

          const signals = yield* analyzeRepo(cloneDir, repo);

          const cloneState: RepoCloneState = {
            repoId: repo.id,
            fullName: repo.fullName,
            cloneStatus: "cloned",
            commit: outcome.success.commit,
            signals: [...signals],
            // Only direct effect dependency evidence counts as adoption:
            // runtime dependencies, not dev-only or peer-only usage.
            adopter: isEffectAdopter(signals),
            recordedAt: yield* DateTime.now,
          };

          const wasRecorded = yield* recordCloneState(cloneState);

          yield* Effect.log(
            `${where} ${repo.fullName}: ${outcome.success.fresh ? "cloned" : "reused"} in ${secondsSince(started)}` +
              ` (★${repo.stargazersCount}${cloneState.adopter ? ", adopter" : ""}, ${signals.length} signals)`,
          );
          yield* progressLog;

          const { commit } = cloneState;
          if (cloneState.adopter && commit !== undefined) {
            effectRepos.push({
              repoId: repo.id,
              fullName: repo.fullName,
              defaultBranch: repo.defaultBranch,
              commit,
              recordedAt: cloneState.recordedAt,
            });
            if (!wasRecorded) effectReposLost++;
          }

          // Clones are deleted only once their state is durably recorded;
          // otherwise the next run would have to re-clone anyway. Adopter
          // clones stay alive for the deep-analysis stage below, which
          // deletes them once their analysis is recorded (or when analysis
          // is skipped, nothing else needs them).
          if (wasRecorded && config.ephemeral && (!cloneState.adopter || config.skipAnalysis)) {
            yield* Effect.ignore(fs.remove(cloneDir, { recursive: true, force: true }));
          }

          return cloneState;
        }),
        { concurrency: config.cloneConcurrency },
      );

      const recordedStates = clonedRepos.filter((clone) => clone !== undefined) as RepoCloneState[];

      if (effectRepos.length > 0) {
        const written = yield* cache.appendEffectRepos(effectRepos).pipe(Effect.option);
        if (Option.isNone(written)) {
          yield* Effect.logWarning(
            `Failed to record ${effectRepos.length} Effect adopter selections after retries`,
          );
        }
      }

      if (!config.analysisOnly) {
        yield* Effect.log(
          `Recorded ${recordedStates.length} repositories ` +
            `(${previouslyRecorded} already recorded, ${freshClones} fresh clones, ${reusedClones} reused, ` +
            `${cloneFailures} clone failures); ` +
            `${recordedStates.filter((clone) => clone.adopter).length} Effect adopters` +
            `${effectReposLost > 0 ? `, ${effectReposLost} adopter selections not recorded` : ""}.`,
        );
      }

      // ---- deep-analysis stage ----

      // Every selected adopter: from this run's selection and from previous
      // runs (deduped by repository id).
      const adopters = new Map<number, EffectRepoState>();
      for (const selection of recoveredSelections) adopters.set(selection.repoId, selection);
      for (const selection of effectRepos) adopters.set(selection.repoId, selection);

      if (config.skipAnalysis) {
        yield* Effect.log("Deep-analysis stage skipped (--skip-analysis)");
      } else {
        yield* Effect.log(
          `Deep analysis: ${adopters.size} adopters, AST ${config.noAst ? "disabled (--no-ast)" : `enabled (concurrency ${config.analysisConcurrency})`}`,
        );
        const analyzed = yield* runDeepAnalysis([...adopters.values()], {
          fresh: config.fresh,
          ephemeral: config.ephemeral,
          concurrency: config.analysisConcurrency,
          ast: !config.noAst,
        });
        yield* Effect.log(
          `Deep analysis: ${analyzed.analyzed} adopters analyzed (${analyzed.codeUsage} with effect in code), ` +
            `${analyzed.alreadyRecorded} already recorded, ${analyzed.failures} failures.`,
        );
      }

      // ---- population summary ----

      // "Out of N repos analysed, M used effect": computed from the recorded
      // state (last record winning), so it describes the population as a
      // whole and not just the work done by this run.
      const analysisStates = yield* cache.analysisStateById;
      let analyzedRepos = 0;
      let failedClones = 0;
      let adopterCount = 0;
      for (const state of cloneStatesById.values()) {
        if (state.cloneStatus === "cloned") {
          analyzedRepos++;
        } else {
          failedClones++;
        }
        if (state.adopter) adopterCount++;
      }
      let analyzedAdopters = 0;
      let adoptersWithCodeUsage = 0;
      for (const state of analysisStates.values()) {
        if (state.analysisStatus !== "analyzed") continue;
        analyzedAdopters++;
        if (hasEffectCodeUsage(state.signals)) adoptersWithCodeUsage++;
      }

      const summary = makeRunSummary(
        {
          analyzedRepos,
          cloneFailures: failedClones,
          adopters: adopterCount,
          analyzedAdopters,
          adoptersWithCodeUsage,
        },
        {
          repoSearchBudget: config.repoSearchBudget,
          fromCache: config.fromCache,
          fresh: config.fresh,
          ephemeral: config.ephemeral,
        },
        yield* DateTime.now,
      );

      const writtenSummary = yield* cache.appendRunSummaries([summary]).pipe(Effect.option);
      if (Option.isNone(writtenSummary)) {
        yield* Effect.logWarning("Failed to record the run summary after retries");
      }

      yield* Effect.log(
        `Population: ${analyzedRepos} repos analysed (${failedClones} clone failures), ` +
          `${adopterCount} adopters (${(summary.population.adopterRatio * 100).toFixed(1)}%); ` +
          `${analyzedAdopters} analyzed for usage, ${adoptersWithCodeUsage} with effect in code ` +
          `(${(summary.deepAnalysis.codeUsageRatio * 100).toFixed(1)}%).`,
      );
    }),
).pipe(
  Command.provide(
    ({
      repoSearchBudget,
      cachePath,
      noCache,
      ephemeral,
      cloneConcurrency,
      analysisConcurrency,
      noAst,
      clean,
      fresh,
      fromCache,
      analysisOnly,
      skipAnalysis,
    }) =>
      // Services derived from AppConfig (CacheDir) must be built from the
      // flag-overlaid config, so the AppConfig chain lives inside this provide
      // instead of the outer CliLayer. `Layer.provide` feeds the overlaid
      // config into CacheDir; NodeServices supplies FileSystem/Path/etc.
      CacheDirLayer.pipe(
        Layer.provideMerge(
          makeAppConfigOverlayLayer({
            ...Option.match(repoSearchBudget, {
              onNone: () => {},
              onSome: (value) => ({ repoSearchBudget: value }),
            }),
            ...Option.match(cachePath, {
              onNone: () => {},
              onSome: (value) => ({ cachePath: value }),
            }),
            ...Option.match(noCache, {
              onNone: () => {},
              onSome: (value) => ({ noCache: value }),
            }),
            ...Option.match(ephemeral, {
              onNone: () => {},
              onSome: (value) => ({ ephemeral: value }),
            }),
            ...Option.match(cloneConcurrency, {
              onNone: () => {},
              onSome: (value) => ({ cloneConcurrency: value }),
            }),
            ...Option.match(analysisConcurrency, {
              onNone: () => {},
              onSome: (value) => ({ analysisConcurrency: value }),
            }),
            ...Option.match(noAst, {
              onNone: () => {},
              onSome: (value) => ({ noAst: value }),
            }),
            ...Option.match(clean, {
              onNone: () => {},
              onSome: (value) => ({ clean: value }),
            }),
            ...Option.match(fresh, {
              onNone: () => {},
              onSome: (value) => ({ fresh: value }),
            }),
            ...Option.match(fromCache, {
              onNone: () => {},
              onSome: (value) => ({ fromCache: value }),
            }),
            ...Option.match(analysisOnly, {
              onNone: () => {},
              onSome: (value) => ({ analysisOnly: value }),
            }),
            ...Option.match(skipAnalysis, {
              onNone: () => {},
              onSome: (value) => ({ skipAnalysis: value }),
            }),
          }).pipe(Layer.provide(AppConfigLayer)),
        ),
        Layer.provideMerge(NodeServices.layer),
      ),
  ),
);

const command = Command.run(e20r, { version: "0.1.0" });

const RateLimiterLayer = RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory));

// Flag-independent services only. AppConfig-derived services (CacheDir) are
// provided per-run by the command's own `Command.provide` layer so they see
// the flag overrides.
const CliLayer = NodeServices.layer.pipe(
  Layer.provideMerge(FetchHttpClient.layer),
  Layer.provideMerge(RateLimiterLayer),
);

const program = Effect.provide(command, CliLayer);

NodeRuntime.runMain(program);
