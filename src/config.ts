import { Config, ConfigProvider, Context, Effect, Layer, Option, Schema } from "effect";

/**
 * GitHub API key for authenticated search requests. Only the crawl needs
 * it, so it is optional here and required where it is used.
 *
 * It can be generated accessing: https://github.com/settings/personal-access-tokens/
 */
const GithubApiKeySchema = Schema.Redacted(
  Schema.String.check(Schema.isNonEmpty({ message: "GITHUB_API_KEY must not be empty" })),
);

const int = (min: number, max: number) =>
  Schema.FiniteFromString.pipe(
    Schema.check(
      Schema.isInt(),
      Schema.isGreaterThanOrEqualTo(min),
      Schema.isLessThanOrEqualTo(max),
    ),
  );

/**
 * Every setting that can come from the environment (`.env`, constant-case
 * keys: `repoSearchBudget` -> `REPO_SEARCH_BUDGET`) and be overridden by a
 * command-line flag of the same name.
 */
const settings = {
  /** Number of top TypeScript repositories to process (sane upper bound: 30k). */
  repoSearchBudget: int(1, 30_000),
  /** Directory holding the state database and the work directory. */
  cachePath: Schema.String.check(Schema.isNonEmpty({ message: "CACHE_PATH must not be empty" })),
  /** In-memory database and a temporary work directory: nothing survives the run. */
  noCache: Schema.Boolean,
  /** Repositories processed (cloned, selected, analyzed) in parallel. */
  concurrency: int(1, 64),
  /** Failed repositories are retried on later runs up to this many attempts. */
  maxAttempts: int(1, 100),
  /** Source files above this size are scanned as text only (usually generated). */
  maxParseBytes: int(1_000, 100_000_000),
  /** Comma-separated `owner/name` list kept out of the deep analysis. */
  excludeRepos: Schema.String,
  /** Keep repositories that define `effect` / `@effect/*` packages out of the deep analysis. */
  excludeEffectCopies: Schema.Boolean,
  /** Keep work directories after processing (debugging only). */
  keepClones: Schema.Boolean,
  /** Wipe the database and the work directory before the run. */
  clean: Schema.Boolean,
  /** Re-process every repository, whatever its recorded state. */
  fresh: Schema.Boolean,
  /** Retry failed repositories even past `maxAttempts`. */
  retryFailed: Schema.Boolean,
  /** Re-process adopters recorded by an older analyzer version. */
  reanalyze: Schema.Boolean,
  /** Stop adopters at selection (no deep analysis). */
  skipAnalysis: Schema.Boolean,
  /** Discard the crawl cursor and crawl again from the top. */
  recrawl: Schema.Boolean,
};

const SettingsSchema = Schema.Struct(settings);

/** The decoded (type-side) settings, used to validate flag overrides. */
const SettingsTypeSchema = Schema.toType(SettingsSchema);

export type Settings = Schema.Schema.Type<typeof SettingsSchema>;

const AppConfigSchema = Schema.Struct({
  githubApiKey: Schema.optionalKey(GithubApiKeySchema),
  repoSearchBudget: settings.repoSearchBudget.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("5000")),
  ),
  cachePath: settings.cachePath.pipe(Schema.withDecodingDefaultKey(Effect.succeed(".e20r"))),
  noCache: settings.noCache.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  concurrency: settings.concurrency.pipe(Schema.withDecodingDefaultKey(Effect.succeed("4"))),
  maxAttempts: settings.maxAttempts.pipe(Schema.withDecodingDefaultKey(Effect.succeed("3"))),
  maxParseBytes: settings.maxParseBytes.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed("1000000")),
  ),
  excludeRepos: settings.excludeRepos.pipe(Schema.withDecodingDefaultKey(Effect.succeed(""))),
  excludeEffectCopies: settings.excludeEffectCopies.pipe(
    Schema.withDecodingDefaultKey(Effect.succeed(true)),
  ),
  keepClones: settings.keepClones.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  clean: settings.clean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  fresh: settings.fresh.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  retryFailed: settings.retryFailed.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  reanalyze: settings.reanalyze.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  skipAnalysis: settings.skipAnalysis.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
  recrawl: settings.recrawl.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
});

export type AppConfigValue = Schema.Schema.Type<typeof AppConfigSchema>;

export class AppConfig extends Context.Service<AppConfig, AppConfigValue>()("e20r/AppConfig") {}

const AppConfigProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromDotEnv().pipe(Effect.map(ConfigProvider.constantCase)),
);

export const AppConfigLayer = Layer.effect(AppConfig, Config.schema(AppConfigSchema)).pipe(
  Layer.provide(AppConfigProviderLayer),
);

/** Flag values keyed by setting name; `Option.none()` means "not given". */
export type SettingOverrides = { readonly [K in keyof Settings]?: Option.Option<Settings[K]> };

/**
 * The environment configuration with the given flags laid over it. The
 * merged settings are validated as a whole, and contradictory combinations
 * are rejected before any layer that depends on them is built (`--clean`
 * would otherwise wipe a cache that `--no-cache` says must not be touched).
 */
export const makeAppConfigOverlayLayer = (
  overrides: SettingOverrides,
): Layer.Layer<AppConfig, Schema.SchemaError | string, AppConfig> =>
  Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const current = yield* AppConfig;
      const given: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(overrides) as Array<
        [string, Option.Option<unknown>]
      >) {
        if (Option.isSome(value)) given[key] = value.value;
      }
      const { githubApiKey, ...base } = current;
      const merged = yield* Schema.decodeEffect(SettingsTypeSchema)({ ...base, ...given });

      if (merged.noCache && merged.clean) {
        return yield* Effect.fail("--no-cache and --clean cannot be combined");
      }
      if (merged.fresh && merged.reanalyze) {
        return yield* Effect.fail("--fresh already re-processes everything; drop --reanalyze");
      }

      return { ...merged, ...(githubApiKey === undefined ? {} : { githubApiKey }) };
    }),
  );

/** The configured exclusion list, parsed. */
export const excludedRepos = (config: Settings): ReadonlyArray<string> =>
  config.excludeRepos
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
