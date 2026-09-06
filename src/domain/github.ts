import { Schema } from "effect";

export const GithubRepoLicenseSchema = Schema.Struct({
  key: Schema.String,
  name: Schema.String,
  spdxId: Schema.NullOr(Schema.String),
  url: Schema.NullOr(Schema.String),
}).pipe(
  Schema.encodeKeys({
    spdxId: "spdx_id",
  }),
);

export type GithubRepoLicense = Schema.Schema.Type<typeof GithubRepoLicenseSchema>;

export const GithubRepoSchema = Schema.Struct({
  id: Schema.Finite,
  url: Schema.String,
  license: Schema.NullOr(GithubRepoLicenseSchema),
  language: Schema.NullOr(Schema.String),
  description: Schema.NullOr(Schema.String),
  defaultBranch: Schema.String, // Used to clone

  // Sorting (in order)
  stargazersCount: Schema.Finite,
  forksCount: Schema.Finite,
  fullName: Schema.String,

  // Redundant checks
  fork: Schema.Boolean, // Should be false
  private: Schema.Boolean, // Should be false
  archived: Schema.Boolean, // Should be false
  disabled: Schema.Boolean, // Should be false
  visibility: Schema.Literals(["public", "private", "internal"]), // Should be public

  // Datetime
  createdAt: Schema.DateTimeUtcFromString,
  updatedAt: Schema.DateTimeUtcFromString,
  pushedAt: Schema.DateTimeUtcFromString,

  // Remaining fields of the GitHub Repository Search endpoint, in API payload order.
  // None are needed by this application today; they are kept so the schema mirrors the
  // full response and the data stays available if requirements change.

  nodeId: Schema.String,
  name: Schema.String,
  owner: Schema.Struct({
    login: Schema.String,
    id: Schema.Finite,
    type: Schema.Literals(["User", "Organization"]),
    htmlUrl: Schema.String,
    avatarUrl: Schema.String,
    siteAdmin: Schema.Boolean,
  }).pipe(
    Schema.encodeKeys({
      htmlUrl: "html_url",
      avatarUrl: "avatar_url",
      siteAdmin: "site_admin",
    }),
  ),
  htmlUrl: Schema.String,
  homepage: Schema.NullOr(Schema.String),
  size: Schema.Finite, // in KB

  watchersCount: Schema.Finite,
  openIssuesCount: Schema.Finite,
  topics: Schema.Array(Schema.String),
  forks: Schema.Finite,
  openIssues: Schema.Finite,
  watchers: Schema.Finite,

  score: Schema.Finite, // Relevance to the search query, always 1.0 unless the query has text keywords

  // Only present on authenticated requests
  permissions: Schema.optionalKey(Schema.Record(Schema.String, Schema.Boolean)),
  tempCloneToken: Schema.optionalKey(Schema.String),
}).pipe(
  Schema.encodeKeys({
    defaultBranch: "default_branch",
    stargazersCount: "stargazers_count",
    forksCount: "forks_count",
    fullName: "full_name",
    createdAt: "created_at",
    updatedAt: "updated_at",
    pushedAt: "pushed_at",
    nodeId: "node_id",
    htmlUrl: "html_url",
    watchersCount: "watchers_count",
    openIssuesCount: "open_issues_count",
    openIssues: "open_issues",
    tempCloneToken: "temp_clone_token",
  }),
);

export type GithubRepo = Schema.Schema.Type<typeof GithubRepoSchema>;

export const GithubRepoSearchResponseSchema = Schema.Struct({
  totalCount: Schema.Finite,
  incompleteResults: Schema.Boolean,
  items: Schema.Array(GithubRepoSchema),
}).pipe(
  Schema.encodeKeys({
    totalCount: "total_count",
    incompleteResults: "incomplete_results",
  }),
);

export type GithubRepoSearchResponse = Schema.Schema.Type<typeof GithubRepoSearchResponseSchema>;
