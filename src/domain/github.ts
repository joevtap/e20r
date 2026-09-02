/*
{
  "id": 60918486,
  "node_id": "MDEwOlJlcG9zaXRvcnk2MDkxODQ4Ng==",
  "name": "node-jq",
  "full_name": "sanack/node-jq",
  "private": false,
  "owner": {
    "login": "sanack",
    "id": 19934836,
    "type": "Organization",
    "html_url": "https://github.com/sanack",
    "avatar_url": "https://avatars.githubusercontent.com/u/19934836?v=4",
    "site_admin": false
  },
  "html_url": "https://github.com/sanack/node-jq",
  "description": " Node.js wrapper for jq",
  "fork": false,
  "url": "https://api.github.com/repos/sanack/node-jq",
  "created_at": "2016-06-11T17:12:53Z",
  "updated_at": "2026-07-27T08:24:59Z",
  "pushed_at": "2026-07-27T08:24:17Z",
  "homepage": "",
  "size": 2330,
  "stargazers_count": 305,
  "watchers_count": 305,
  "language": "TypeScript",
  "forks_count": 57,
  "open_issues_count": 28,
  "license": {
    "key": "mit",
    "name": "MIT License",
    "spdx_id": "MIT",
    "url": "https://api.github.com/licenses/mit"
  },
  "topics": ["jq", "json", "nodejs"],
  "visibility": "public",
  "forks": 57,
  "open_issues": 28,
  "watchers": 305,
  "default_branch": "main",
  "archived": false,
  "disabled": false,
  "score": 1.0
}
*/

/** Envelope for GET /search/repositories — always exactly these three keys. */
interface SearchRepositoriesResponse {
  /** Matches for the query at query time; can change between calls. */
  total_count: number;
  /** true ⇒ the query hit its internal time limit; slice may be partial — re-run it. */
  incomplete_results: boolean;
  items: SearchResultRepository[];
}

/** One search hit. A trimmed repository, not the full GET /repos/{owner}/{repo} object. */
interface SearchResultRepository {
  id: number;
  node_id: string;
  /** "owner-name/repo-name" — your third sort key, already in org/repo form. */
  full_name: string;
  /** Repo name alone, without the owner. */
  name: string;
  owner: {
    login: string;
    id: number;
    type: string; // "User" | "Organization"
    html_url: string;
    avatar_url: string;
    site_admin: boolean;
  };
  private: boolean;
  html_url: string;
  description: string | null;
  /** true ⇒ this repo is itself a fork (redundant with fork:false in the query — keep as a sanity check). */
  fork: boolean;
  url: string;
  created_at: string; // ISO 8601
  updated_at: string; // ISO 8601
  pushed_at: string; // ISO 8601 — last commit on any branch

  homepage: string | null;
  size: number; // KB

  /** ★ Sort key 1. */
  stargazers_count: number;
  /** ★ Sort key 2. */
  forks_count: number;

  language: string | null;
  license: { key: string; name: string; spdx_id: string; url: string } | null;
  topics: string[];
  /** "public" | "private" | "internal" — present since API version 2022-11-28. */
  visibility: string;

  // ⚠️ Legacy duplicates of the counts above — same values, different names.
  // Pick one spelling and use it consistently (the ★ ones above).
  forks: number; // == forks_count
  open_issues: number; // == open_issues_count
  open_issues_count: number;
  watchers: number; // == stargazers_count
  watchers_count: number;

  default_branch: string; // Important for cloning later
  archived: boolean; // use to check the intended query
  disabled: boolean; // =above
  /** Relevance score. Meaningless here (1.0) unless the query has text keywords. Ignore it. */
  score: number;

  // Only present on authenticated requests:
  permissions?: Record<string, boolean>;
  temp_clone_token?: string;
}
