import { Config, ConfigProvider, Context, Effect, Layer, Schema } from "effect";

/**
 * Required GitHub API key for authenticated requests.
 *
 * It can be generated accessing: https://github.com/settings/personal-access-tokens/
 */
const GithubApiKeySchema = Schema.Redacted(
  Schema.String.check(
    Schema.isNonEmpty({
      message: "GITHUB_API_KEY must not be empty",
    }),
  ),
).pipe(
  Schema.annotateKey({
    messageMissingKey: "GITHUB_API_KEY is required",
  }),
);

const AppConfigOverridesSchema = Schema.Struct({
  repoSearchBudget: Schema.FiniteFromString.pipe(
    Schema.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),

      // Sane default upper bound for an absurd amount of repositories to be inspected
      Schema.isLessThanOrEqualTo(30_000),
    ),
  ),
  cachePath: Schema.String.check(
    Schema.isNonEmpty({
      message: "CACHE_PATH must not be empty",
    }),
  ),
  noCache: Schema.Boolean,
  ephemeral: Schema.Boolean,
  cloneConcurrency: Schema.FiniteFromString.pipe(
    Schema.check(Schema.isInt(), Schema.isGreaterThan(0), Schema.isLessThanOrEqualTo(64)),
  ),
  clean: Schema.Boolean,
  fresh: Schema.Boolean,
  fromCache: Schema.Boolean,
});

const AppConfigOverridesInputSchema = Schema.Struct({
  repoSearchBudget: Schema.optionalKey(
    Schema.toType(AppConfigOverridesSchema.fields.repoSearchBudget),
  ),
  cachePath: Schema.optionalKey(Schema.toType(AppConfigOverridesSchema.fields.cachePath)),
  noCache: Schema.optionalKey(Schema.toType(AppConfigOverridesSchema.fields.noCache)),
  ephemeral: Schema.optionalKey(Schema.toType(AppConfigOverridesSchema.fields.ephemeral)),
  cloneConcurrency: Schema.optionalKey(
    Schema.toType(AppConfigOverridesSchema.fields.cloneConcurrency),
  ),
  clean: Schema.optionalKey(Schema.toType(AppConfigOverridesSchema.fields.clean)),
  fresh: Schema.optionalKey(Schema.toType(AppConfigOverridesSchema.fields.fresh)),
  fromCache: Schema.optionalKey(Schema.toType(AppConfigOverridesSchema.fields.fromCache)),
});

export type AppConfigOverrides = Schema.Schema.Type<typeof AppConfigOverridesInputSchema>; /**
 * The application configuration schema with required and optional fields.
 *
 * Loaded by default from a `.env` file at the root of the repository.
 *
 * Fields:
 *
 * - Required GitHub API Key with no default value.
 * - Repo search budget with a default value of 5000.
 * - Cache directory path with a default value of ".e20r".
 * - Cache disabling switch with a default value of false.
 * - Clone deletion after successful analysis switch with a default value of false.
 * - Parallel clone count with a default value of 4.
 * - Cache cleaning switch (--clean) with a default value of false.
 * - Fresh re-run switch (--fresh) with a default value of false.
 * - Search-from-cache switch (--from-cache) with a default value of false.
 */
const AppConfigSchema = Schema.Struct({
  githubApiKey: GithubApiKeySchema,
  ...AppConfigOverridesSchema.mapFields((fields) => {
    return {
      repoSearchBudget: fields.repoSearchBudget.pipe(
        Schema.withDecodingDefaultKey(Effect.succeed("5000")),
      ),
      cachePath: fields.cachePath.pipe(Schema.withDecodingDefaultKey(Effect.succeed(".e20r"))),
      noCache: fields.noCache.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
      ephemeral: fields.ephemeral.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
      cloneConcurrency: fields.cloneConcurrency.pipe(
        Schema.withDecodingDefaultKey(Effect.succeed("4")),
      ),
      clean: fields.clean.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
      fresh: fields.fresh.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
      fromCache: fields.fromCache.pipe(Schema.withDecodingDefaultKey(Effect.succeed(false))),
    };
  }).fields,
});

export type AppConfigValue = Schema.Schema.Type<typeof AppConfigSchema>;

export const AppConfigConfig = Config.schema(AppConfigSchema);

export class AppConfig extends Context.Service<AppConfig, AppConfigValue>()("e20r/AppConfig") {}

export const AppConfigProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromDotEnv().pipe(Effect.map(ConfigProvider.constantCase)),
);

export const AppConfigLayer = Layer.effect(AppConfig, AppConfigConfig).pipe(
  Layer.provide(AppConfigProviderLayer),
);

export const makeAppConfigOverlayLayer = (
  overrides: AppConfigOverrides,
): Layer.Layer<AppConfig, Schema.SchemaError | string, AppConfig> =>
  Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const validated = yield* Schema.decodeEffect(AppConfigOverridesInputSchema)(overrides);

      const current = yield* AppConfig;

      // Effective values after the flag/env overlay, where contradictions
      // must be caught before the cache layer is built: `--clean` would
      // otherwise wipe a cache the run then reads (`--from-cache`) or that
      // `--no-cache` says must not be touched.
      const noCache = validated.noCache ?? current.noCache;
      const clean = validated.clean ?? current.clean;
      const fromCache = validated.fromCache ?? current.fromCache;

      if (noCache && fromCache) {
        return yield* Effect.fail("--no-cache and --from-cache cannot be combined");
      }
      if (noCache && clean) {
        return yield* Effect.fail("--no-cache and --clean cannot be combined");
      }
      if (clean && fromCache) {
        return yield* Effect.fail(
          "--clean and --from-cache cannot be combined: --clean wipes the cache that --from-cache reads",
        );
      }

      return {
        ...current,
        ...(validated.repoSearchBudget === undefined
          ? {}
          : {
              repoSearchBudget: validated.repoSearchBudget,
            }),
        ...(validated.cachePath === undefined
          ? {}
          : {
              cachePath: validated.cachePath,
            }),
        ...(validated.noCache === undefined
          ? {}
          : {
              noCache: validated.noCache,
            }),
        ...(validated.ephemeral === undefined
          ? {}
          : {
              ephemeral: validated.ephemeral,
            }),
        ...(validated.cloneConcurrency === undefined
          ? {}
          : {
              cloneConcurrency: validated.cloneConcurrency,
            }),
        ...(validated.clean === undefined
          ? {}
          : {
              clean: validated.clean,
            }),
        ...(validated.fresh === undefined
          ? {}
          : {
              fresh: validated.fresh,
            }),
        ...(validated.fromCache === undefined
          ? {}
          : {
              fromCache: validated.fromCache,
            }),
      };
    }),
  );
