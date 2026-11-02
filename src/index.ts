import { NodeRuntime, NodeServices } from "@effect/platform-node";
import { Context, Effect, FileSystem, Layer, Option, Path } from "effect";
import { Command, Flag } from "effect/cli";
import { FetchHttpClient } from "effect/http";
import {
  AppConfig,
  AppConfigLayer,
  excludedRepos,
  makeAppConfigOverlayLayer,
  type SettingOverrides,
} from "./config.ts";
import { makeRunSummary } from "./domain/run-summary.ts";
import { githubTokenAuth } from "./github/git.ts";
import { runCrawl } from "./github/search.ts";
import { runProcess } from "./pipeline/run.ts";
import { exportAll, printReport } from "./report.ts";
import { makeDatabaseLayer } from "./store/db.ts";
import { serveViewer } from "./viewer/server.ts";
import { Store } from "./store/store.ts";

// ---- flags ----

const flag = {
  repoSearchBudget: Flag.Int("repo-search-budget").pipe(
    Flag.withAlias("b"),
    Flag.withDescription("Number of top TypeScript repositories to process"),
    Flag.optional,
  ),
  cachePath: Flag.String("cache-path").pipe(
    Flag.withDescription("Directory holding the state database (e20r.db) and the work directory"),
    Flag.optional,
  ),
  noCache: Flag.Boolean("no-cache").pipe(
    Flag.withDescription(
      "In-memory database and a temporary work directory; nothing survives the run",
    ),
    Flag.optional,
  ),
  clean: Flag.Boolean("clean").pipe(
    Flag.withDescription("Wipe the state database and the work directory before the run"),
    Flag.optional,
  ),
  recrawl: Flag.Boolean("recrawl").pipe(
    Flag.withDescription("Discard the crawl cursor and crawl again from the top"),
    Flag.optional,
  ),
  concurrency: Flag.Int("concurrency").pipe(
    Flag.withAlias("c"),
    Flag.withDescription("Repositories processed (cloned, selected, analyzed) in parallel"),
    Flag.optional,
  ),
  fresh: Flag.Boolean("fresh").pipe(
    Flag.withDescription("Re-process every repository, whatever its recorded state"),
    Flag.optional,
  ),
  retryFailed: Flag.Boolean("retry-failed").pipe(
    Flag.withDescription("Retry failed repositories even past --max-attempts"),
    Flag.optional,
  ),
  reanalyze: Flag.Boolean("reanalyze").pipe(
    Flag.withDescription("Re-process adopters recorded by an older analyzer version"),
    Flag.optional,
  ),
  maxAttempts: Flag.Int("max-attempts").pipe(
    Flag.withDescription("Attempts before a failing repository is given up on"),
    Flag.optional,
  ),
  maxParseBytes: Flag.Int("max-parse-bytes").pipe(
    Flag.withDescription("Source files above this size are scanned as text only"),
    Flag.optional,
  ),
  excludeRepos: Flag.String("exclude-repos").pipe(
    Flag.withDescription("Comma-separated owner/name list kept out of the deep analysis"),
    Flag.optional,
  ),
  skipAnalysis: Flag.Boolean("skip-analysis").pipe(
    Flag.withDescription("Stop adopters at selection (no deep analysis)"),
    Flag.optional,
  ),
  keepClones: Flag.Boolean("keep-clones").pipe(
    Flag.withDescription("Keep work directories after processing (debugging only)"),
    Flag.optional,
  ),
};

const storageFlags = { cachePath: flag.cachePath, clean: flag.clean };
const crawlFlags = { repoSearchBudget: flag.repoSearchBudget, recrawl: flag.recrawl };
const processFlags = {
  repoSearchBudget: flag.repoSearchBudget,
  concurrency: flag.concurrency,
  fresh: flag.fresh,
  retryFailed: flag.retryFailed,
  reanalyze: flag.reanalyze,
  maxAttempts: flag.maxAttempts,
  maxParseBytes: flag.maxParseBytes,
  excludeRepos: flag.excludeRepos,
  skipAnalysis: flag.skipAnalysis,
  keepClones: flag.keepClones,
};

// ---- per-run services ----

/** Where this run keeps its state: the database file and the work directory. */
class Paths extends Context.Service<
  Paths,
  { readonly database: string; readonly workDir: string }
>()("e20r/Paths") {}

/** Pre-SQLite state files, reported (and wiped by `--clean`) so they are not mistaken for state. */
const legacyEntries = [
  "repos.jsonl",
  "clone-state.jsonl",
  "effect-repos.jsonl",
  "analysis-state.jsonl",
  "run-summary.jsonl",
  "clones",
];

const PathsLayer = Layer.effect(
  Paths,
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const fs = yield* FileSystem.FileSystem;
    const path = yield* Path.Path;

    if (config.noCache) {
      const root = yield* fs.makeTempDirectoryScoped({ prefix: "e20r-nocache-" });
      yield* Effect.log(`--no-cache: in-memory database, work directory in ${root}`);
      return { database: ":memory:", workDir: path.join(root, "work") };
    }

    const root = config.cachePath;
    const database = path.join(root, "e20r.db");
    const workDir = path.join(root, "work");
    yield* fs.makeDirectory(root, { recursive: true });

    const legacy = (yield* Effect.forEach(legacyEntries, (entry) =>
      Effect.map(Effect.option(fs.exists(path.join(root, entry))), (exists) =>
        Option.getOrElse(exists, () => false) ? [entry] : [],
      ),
    )).flat();

    if (config.clean) {
      // Loud, because it is destructive: the log says exactly what goes.
      const wiped = ["e20r.db", "e20r.db-wal", "e20r.db-shm", "work", ...legacy];
      yield* Effect.log(`--clean: wiping ${path.resolve(root)}: ${wiped.join(", ")}`);
      for (const entry of wiped) {
        yield* Effect.ignore(fs.remove(path.join(root, entry), { recursive: true, force: true }));
      }
    } else if (legacy.length > 0) {
      yield* Effect.logWarning(
        `${path.resolve(root)} holds pre-SQLite state (${legacy.join(", ")}) that this version ignores; ` +
          "delete it or run with --clean",
      );
    }

    return { database, workDir };
  }),
);

const DatabaseLayer = Layer.unwrap(
  Effect.gen(function* () {
    const paths = yield* Paths;
    return makeDatabaseLayer(paths.database);
  }),
);

/**
 * Every service a command needs, built from the environment configuration
 * with the command's flags laid over it.
 */
const runtimeLayer = (overrides: SettingOverrides) =>
  DatabaseLayer.pipe(
    Layer.provideMerge(PathsLayer),
    Layer.provideMerge(makeAppConfigOverlayLayer(overrides).pipe(Layer.provide(AppConfigLayer))),
    Layer.provideMerge(NodeServices.layer),
  );

// ---- commands ----

/** The configuration as recorded in `runs`, without the API key. */
const recordedConfig = Effect.gen(function* () {
  const { githubApiKey: _, ...config } = yield* AppConfig;
  return config;
});

const crawlStep = Effect.gen(function* () {
  const config = yield* AppConfig;
  if (config.githubApiKey === undefined) {
    return yield* Effect.fail("GITHUB_API_KEY is required to crawl (set it in .env)");
  }
  return yield* runCrawl({
    budget: config.repoSearchBudget,
    apiKey: config.githubApiKey,
    recrawl: config.recrawl,
  });
});

const processStep = (runId: number) =>
  Effect.gen(function* () {
    const config = yield* AppConfig;
    const paths = yield* Paths;
    const store = yield* Store;
    if (config.retryFailed) {
      const reset = yield* store.resetFailures;
      if (reset > 0) yield* Effect.log(`--retry-failed: ${reset} failed repositories re-queued`);
    }
    const counts = yield* runProcess({
      runId,
      budget: config.repoSearchBudget,
      workDir: paths.workDir,
      concurrency: config.concurrency,
      fresh: config.fresh,
      retryFailed: config.retryFailed,
      reanalyze: config.reanalyze,
      maxAttempts: config.maxAttempts,
      skipAnalysis: config.skipAnalysis,
      keepClones: config.keepClones,
      maxParseBytes: config.maxParseBytes,
      exclusion: {
        excludeRepos: excludedRepos(config),
        excludeEffectPackageDefiners: config.excludeEffectCopies,
      },
      gitAuth: config.githubApiKey === undefined ? undefined : githubTokenAuth(config.githubApiKey),
    });
    if (counts.halted !== null) {
      // The run stays recorded as unfinished (no `finished_at`), which is
      // what it is; the pending repositories are picked up by the next run.
      return yield* Effect.fail(
        `Stopped early: ${counts.notStarted} repositories left pending because GitHub kept refusing clones. ` +
          "Run the same command again later to continue.",
      );
    }
    return counts;
  });

/**
 * Runs `body` as one recorded run: a `runs` row is opened first and closed
 * with the counts and the population summary at the end. A run that is
 * interrupted keeps `finished_at` empty, which is how it shows in the table.
 */
const recordedRun = <A, E, R>(command: string, body: (runId: number) => Effect.Effect<A, E, R>) =>
  Effect.gen(function* () {
    const store = yield* Store;
    const runId = yield* store.startRun(command, yield* recordedConfig);
    const counts = yield* body(runId);
    const summary = makeRunSummary(yield* store.population);
    yield* store.finishRun(runId, { ...summary, [command]: counts });
    yield* printReport;
  });

const runBase = Command.make(
  "run",
  { ...storageFlags, ...crawlFlags, ...processFlags, noCache: flag.noCache },
  () =>
    recordedRun("run", (runId) =>
      Effect.gen(function* () {
        const crawl = yield* crawlStep;
        const process = yield* processStep(runId);
        return { crawl, process };
      }),
    ),
).pipe(Command.withDescription("Crawl, then process every top repository that needs work"));
const run = Command.provide(runBase, (input) => runtimeLayer(input));

const crawlBase = Command.make("crawl", { ...storageFlags, ...crawlFlags }, () =>
  recordedRun("crawl", () => crawlStep),
).pipe(Command.withDescription("Crawl the top TypeScript repositories (resumable)"));
const crawl = Command.provide(crawlBase, (input) => runtimeLayer(input));

const processBase = Command.make("process", { ...storageFlags, ...processFlags }, () =>
  recordedRun("process", processStep),
).pipe(
  Command.withDescription("Clone, select and deep-analyze the crawled repositories that need work"),
);
const processCommand = Command.provide(processBase, (input) => runtimeLayer(input));

const reportBase = Command.make("report", { cachePath: flag.cachePath }, () => printReport).pipe(
  Command.withDescription("Print the population summary and the most used packages and symbols"),
);
const report = Command.provide(reportBase, (input) => runtimeLayer(input));

const exportCommand = Command.make(
  "export",
  {
    cachePath: flag.cachePath,
    out: Flag.String("out").pipe(
      Flag.withDescription("Output directory (default: <cache-path>/export)"),
      Flag.optional,
    ),
  },
  ({ out }) =>
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const path = yield* Path.Path;
      yield* exportAll(Option.getOrElse(out, () => path.join(config.cachePath, "export")));
    }),
).pipe(
  Command.withDescription("Export every table and view as JSONL"),
  Command.provide(({ cachePath }) => runtimeLayer({ cachePath })),
);

const viewBase = Command.make(
  "view",
  {
    cachePath: flag.cachePath,
    port: Flag.Int("port").pipe(Flag.withDescription("Port to listen on"), Flag.withDefault(4173)),
    host: Flag.String("host").pipe(
      Flag.withDescription("Interface to bind (0.0.0.0 to share on the network)"),
      Flag.withDefault("127.0.0.1"),
    ),
  },
  ({ port, host }) =>
    Effect.gen(function* () {
      const config = yield* AppConfig;
      const path = yield* Path.Path;
      return yield* serveViewer({
        database: path.resolve(config.cachePath, "e20r.db"),
        host,
        port,
      });
    }),
).pipe(Command.withDescription("Browse the state database in the browser (read-only, live)"));
const view = Command.provide(viewBase, ({ cachePath }) =>
  makeAppConfigOverlayLayer({ cachePath }).pipe(Layer.provide(AppConfigLayer)),
);

const e20r = Command.make("e20r").pipe(
  Command.withDescription(
    "effect-adoption-analyzer: mines Effect adoption in the top TypeScript repositories on GitHub",
  ),
  Command.withSubcommands([run, crawl, processCommand, report, view, exportCommand]),
);

// Flag-independent services only; everything derived from the configuration
// is provided per command (`runtimeLayer`) so it sees the flag overrides.
const CliLayer = NodeServices.layer.pipe(Layer.provideMerge(FetchHttpClient.layer));

NodeRuntime.runMain(Effect.provide(Command.run(e20r, { version: "0.2.0" }), CliLayer));
