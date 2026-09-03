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
});

const AppConfigOverridesInputSchema = Schema.Struct({
  repoSearchBudget: Schema.optionalKey(
    Schema.toType(AppConfigOverridesSchema.fields.repoSearchBudget),
  ),
});

export type AppConfigOverrides = Schema.Schema.Type<
  typeof AppConfigOverridesInputSchema
>; /**
 * The application configuration schema with required and optional fields.
 *
 * Loaded by default from a `.env` file at the root of the repository.
 *
 * Fields:
 *
 * - Required GitHub API Key with no default value.
 * - Repo search budget with a default value of 5000.
 */
const AppConfigSchema = Schema.Struct({
  githubApiKey: GithubApiKeySchema,
  ...AppConfigOverridesSchema.mapFields((fields) => {
    return {
      repoSearchBudget:
        fields.repoSearchBudget.pipe(
          Schema.withDecodingDefaultKey(Effect.succeed("5000")),
        ),
    };
  }).fields,
});

export type AppConfigValue = Schema.Schema.Type<typeof AppConfigSchema>;

export const AppConfigConfig = Config.schema(AppConfigSchema);

export class AppConfig extends Context.Service<AppConfig, AppConfigValue>()(
  "e20r/AppConfig",
) {}

export const AppConfigProviderLayer = ConfigProvider.layer(
  ConfigProvider.fromDotEnv().pipe(Effect.map(ConfigProvider.constantCase)),
);

export const AppConfigLayer = Layer.effect(AppConfig, AppConfigConfig).pipe(
  Layer.provide(AppConfigProviderLayer),
);

export const makeAppConfigOverlayLayer = (
  overrides: AppConfigOverrides,
): Layer.Layer<AppConfig, Schema.SchemaError, AppConfig> =>
  Layer.effect(
    AppConfig,
    Effect.gen(function* () {
      const validated = yield* Schema.decodeEffect(
        AppConfigOverridesInputSchema,
      )(overrides);

      const current = yield* AppConfig;

      return {
        ...current,
        ...(validated.repoSearchBudget === undefined
          ? {}
          : {
              repoSearchBudget:
                validated.repoSearchBudget,
            }),
      };
    }),
  );
