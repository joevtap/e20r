import { Config, ConfigProvider, Effect, Schema } from "effect";

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

/**
 * The application configuration schema with required and optional fields.
 *
 * Loaded by default from a `.env` file at the root of the repository.
 *
 * Fields:
 *
 * - Required GitHub API Key with no default value.
 * - Target Effect using repositories `n` with a default value of 100.
 * - Maximum inspected repositories with TypeScript classified as the primary language;
 * with a default value of 5000.
 */
const AppConfigSchema = Schema.Struct({
  githubApiKey: GithubApiKeySchema,

  targetEffectRepositoriesN: Schema.FiniteFromString.pipe(
    Schema.check(Schema.isGreaterThan(0), Schema.isInt()),
    Schema.withDecodingDefaultKey(Effect.succeed("100")),
  ),

  maximumInspectedTypescriptRepositoriesB: Schema.FiniteFromString.pipe(
    Schema.check(
      Schema.isInt(),
      Schema.isGreaterThan(0),

      // Sane default upper bound for an absurd amount of repositories to be inspected
      Schema.isLessThanOrEqualTo(30_000),
    ),
    Schema.withDecodingDefaultKey(Effect.succeed("5000")),
  ),
});

export const AppConfig = Config.schema(AppConfigSchema);

export const AppConfigLayer = ConfigProvider.layer(
  ConfigProvider.fromDotEnv().pipe(Effect.map(ConfigProvider.constantCase)),
);
