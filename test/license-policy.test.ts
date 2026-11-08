import { NodeServices } from "@effect/platform-node";
import { describe, expect, it } from "@effect/vitest";
import { DateTime, Effect, Option, Redacted, Schema } from "effect";
import { HttpClient, HttpClientResponse } from "effect/http";
import { TestClock } from "effect/testing";
import { GithubRepoSchema, type GithubRepo } from "../src/domain/github.ts";
import {
  acceptedSpdxIds,
  defaultAcceptedLicenses,
  isEligibleRepository,
  parseAcceptedLicenses,
  populationPolicy,
} from "../src/domain/license-policy.ts";
import { buildSearchUrl, runCrawl } from "../src/github/search.ts";
import { makeDatabaseLayer } from "../src/store/db.ts";
import { Store, type CrawlState } from "../src/store/store.ts";
import { AppConfig, AppConfigSchema, makeAppConfigOverlayLayer } from "../src/config.ts";
import * as SqlClient from "effect/sql/SqlClient";

const repo = (
  id: number,
  stars: number,
  spdxId: string | null = "MIT",
  overrides: Partial<GithubRepo> = {},
): GithubRepo => ({
  id,
  url: `https://api.github.com/repos/a/${id}`,
  license: { key: "mit", name: "MIT", spdxId, url: null },
  language: "TypeScript",
  description: null,
  defaultBranch: "main",
  stargazersCount: stars,
  forksCount: 0,
  fullName: `a/${id}`,
  fork: false,
  private: false,
  archived: false,
  disabled: false,
  visibility: "public",
  createdAt: DateTime.makeUnsafe("2020-01-01T00:00:00Z"),
  updatedAt: DateTime.makeUnsafe("2020-01-01T00:00:00Z"),
  pushedAt: DateTime.makeUnsafe("2020-01-01T00:00:00Z"),
  nodeId: `${id}`,
  name: `${id}`,
  owner: {
    login: "a",
    id: 1,
    type: "User",
    htmlUrl: "https://github.com/a",
    avatarUrl: "",
    siteAdmin: false,
  },
  htmlUrl: `https://github.com/a/${id}`,
  homepage: null,
  size: 1,
  watchersCount: stars,
  openIssuesCount: 0,
  topics: [],
  forks: 0,
  openIssues: 0,
  watchers: stars,
  score: 1,
  ...overrides,
});
const policy = populationPolicy(parseAcceptedLicenses(defaultAcceptedLicenses));
const options = { budget: 3, apiKey: Redacted.make("fixture"), recrawl: false };
const state: CrawlState = {
  cursor: { url: buildSearchUrl(null, acceptedSpdxIds), lastSeenStars: null, intervalBound: null },
  complete: false,
  budget: 3,
  pages: 0,
};
const database = makeDatabaseLayer(":memory:");
const provide = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.provide(database), Effect.provide(NodeServices.layer));

interface Page {
  items: ReadonlyArray<GithubRepo>;
  next?: string;
  total?: number;
  incomplete?: boolean;
}
const mock = (pages: ReadonlyArray<Page>, urls: string[]) =>
  HttpClient.make((request) =>
    Effect.gen(function* () {
      urls.push(request.url);
      const page = pages[urls.length - 1];
      if (page === undefined) throw new Error("Unexpected extra request");
      // Advance virtual time so subsequent crawl requests need no real delay.
      yield* TestClock.adjust("6 seconds");
      return HttpClientResponse.fromWeb(
        request,
        Response.json(
          {
            total_count: page.total ?? page.items.length,
            incomplete_results: page.incomplete ?? false,
            items: page.items.map(Schema.encodeSync(GithubRepoSchema)),
          },
          { headers: page.next === undefined ? {} : { link: `<${page.next}>; rel="next"` } },
        ),
      );
    }),
  );

// Real Store/SQLite and real response schema, with only the HTTP transport replaced.
describe("licensed population", () => {
  it("accepts exactly the eight SPDX literals and rejects ambiguous metadata", () => {
    for (const id of acceptedSpdxIds)
      expect(isEligibleRepository(repo(1, 1, id), acceptedSpdxIds)).toBe(true);
    for (const id of [
      null,
      "NOASSERTION",
      "",
      "mit",
      " MIT",
      "GPL-3.0-only",
      "GPL-3.0-or-later",
      "MIT OR Apache-2.0",
      "BUSL-1.1",
      "BSD-3-Clause",
    ]) {
      expect(isEligibleRepository(repo(1, 1, id), acceptedSpdxIds)).toBe(false);
    }
    for (const overrides of [
      { license: null },
      { language: "JavaScript" },
      { fork: true },
      { archived: true },
      { private: true },
      { visibility: "private" as const },
    ]) {
      expect(isEligibleRepository(repo(1, 1, "MIT", overrides), acceptedSpdxIds)).toBe(false);
    }
  });

  it("validates configuration and canonicalizes equivalent sets", () => {
    expect(populationPolicy(parseAcceptedLicenses("MIT,Apache-2.0,MIT"))).toBe(
      populationPolicy(parseAcceptedLicenses("Apache-2.0, MIT")),
    );
    for (const value of ["", "NOASSERTION", "MIT,", "MIT fork:true", "mit"])
      expect(() => parseAcceptedLicenses(value)).toThrow();
    const url = new URL(buildSearchUrl(42, acceptedSpdxIds));
    const query = url.searchParams.get("q")!;
    for (const id of acceptedSpdxIds) expect(query).toContain(`license:${id.toLowerCase()}`);
    expect(query).toContain("language:typescript fork:false archived:false is:public");
    expect(query).toContain("stars:<=42");
  });

  it.effect("uses defaults, decoded settings, then flag overrides, validating each list", () =>
    Effect.gen(function* () {
      const decode = Schema.decodeUnknownSync(AppConfigSchema);
      const defaults = decode({ cachePath: ".test" });
      expect(defaults.repoSearchBudget).toBe(5000);
      expect(defaults.acceptedLicenses).toBe(defaultAcceptedLicenses);
      // This tests the decoded configuration and overlay, not filesystem dotenv parsing.
      const decoded = decode({ cachePath: ".test", acceptedLicenses: "MIT" });
      expect(decoded.acceptedLicenses).toBe("MIT");
      const effective = yield* AppConfig.pipe(
        Effect.provide(
          makeAppConfigOverlayLayer({
            acceptedLicenses: Option.some("Apache-2.0"),
            clean: Option.some(false),
          }),
        ),
        Effect.provideService(AppConfig, { ...decoded, clean: true }),
      );
      expect(effective.acceptedLicenses).toBe("Apache-2.0");
      expect(effective.clean).toBe(false);
      for (const value of ["", "NOASSERTION", "MIT fork:true"]) {
        expect(() => decode({ cachePath: ".test", acceptedLicenses: value })).toThrow();
      }
    }),
  );

  it.effect("continues past rejected pages and deduplicates before the cut; ranks all ties", () => {
    const urls: string[] = [];
    const pages: Page[] = [
      {
        items: [repo(1, 100, null), repo(2, 90, "NOASSERTION")],
        next: "https://api.github.com/search/repositories?page=2",
      },
      {
        items: [repo(3, 80), repo(4, 70, "BSD-3-Clause"), repo(5, 60)],
        next: "https://api.github.com/search/repositories?page=3",
      },
      {
        items: [repo(5, 60), repo(6, 60, "Apache-2.0", { forksCount: 5, fullName: "z/z" })],
        next: "https://api.github.com/search/repositories?page=4",
      },
      { items: [repo(7, 60, "MIT", { forksCount: 5, fullName: "a/a" }), repo(8, 59)] },
    ];
    return provide(
      Effect.gen(function* () {
        const store = yield* Store;
        const result = yield* runCrawl(options).pipe(
          Effect.provideService(HttpClient.HttpClient, mock(pages, urls)),
        );
        expect(result.pages).toBe(4);
        expect(yield* store.repoCount).toBe(5);
        expect((yield* store.topRepos(3)).map((r) => r.id)).toEqual([3, 7, 6]);
        expect(yield* store.starsAtRank(3)).toBe(60);
        yield* store.requireCompletePopulation(3);
        const skipped = yield* runCrawl(options);
        expect(skipped.skipped).toBe(true);
        expect(urls).toHaveLength(4);
      }),
    );
  });

  it.effect(
    "resumes the committed page after an incomplete response, then extends the budget",
    () => {
      const urls: string[] = [];
      const next = "https://api.github.com/search/repositories?page=2";
      return provide(
        Effect.gen(function* () {
          const store = yield* Store;
          yield* store.ensurePopulationPolicy(policy);
          yield* store.saveCrawlPage([repo(1, 100)], {
            ...state,
            cursor: { ...state.cursor!, url: next },
            pages: 1,
          });
          const failed = yield* Effect.result(
            runCrawl({ ...options, budget: 1 }).pipe(
              Effect.provideService(
                HttpClient.HttpClient,
                mock([{ items: [repo(2, 90)], incomplete: true }], urls),
              ),
            ),
          );
          expect(failed._tag).toBe("Failure");
          expect(Option.getOrThrow(yield* store.crawlState).pages).toBe(1);
          expect(yield* store.repoCount).toBe(1);
          expect((yield* Effect.result(store.requireCompletePopulation(1)))._tag).toBe("Failure");
          const resumedUrls: string[] = [];
          yield* runCrawl({ ...options, budget: 1 }).pipe(
            Effect.provideService(
              HttpClient.HttpClient,
              mock(
                [
                  {
                    items: [repo(2, 90)],
                    next: "https://api.github.com/search/repositories?page=3",
                  },
                ],
                resumedUrls,
              ),
            ),
          );
          expect(resumedUrls[0]).toBe(next);
          const extendedUrls: string[] = [];
          yield* runCrawl(options).pipe(
            Effect.provideService(
              HttpClient.HttpClient,
              mock([{ items: [repo(3, 80), repo(4, 70)] }], extendedUrls),
            ),
          );
          expect(extendedUrls[0]).toContain("page=3");
          expect((yield* store.topRepos(3)).map((r) => r.id)).toEqual([1, 2, 3]);
          expect((yield* Effect.result(store.requireCompletePopulation(5)))._tag).toBe("Failure");
          expect((yield* Effect.result(runCrawl({ ...options, recrawl: true })))._tag).toBe(
            "Failure",
          );
        }),
      );
    },
  );

  it.effect("rejects legacy and different-policy caches without changing their state", () =>
    provide(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.saveCrawlPage([repo(1, 10)], { ...state, complete: true });
        expect((yield* Effect.result(store.ensurePopulationPolicy(policy)))._tag).toBe("Failure");
        expect(yield* store.repoCount).toBe(1);
        expect(Option.getOrThrow(yield* store.crawlState).complete).toBe(true);
      }),
    ),
  );

  it.effect("persists canonical policy and refuses a changed set even on recrawl", () =>
    provide(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.ensurePopulationPolicy(policy);
        yield* store.ensurePopulationPolicy(populationPolicy([...acceptedSpdxIds].reverse()));
        expect(
          (yield* Effect.result(runCrawl({ ...options, acceptedLicenses: "MIT", recrawl: true })))
            ._tag,
        ).toBe("Failure");
        const sql = yield* SqlClient.SqlClient;
        const rows = yield* sql<{ policy: string }>`SELECT policy FROM population_policy`;
        expect(rows).toEqual([{ policy }]);
      }),
    ),
  );

  it.effect(
    "fails on a saturated tie discovered from the initial query and preserves the last cursor",
    () => {
      const urls: string[] = [];
      const items = Array.from({ length: 1000 }, (_, i) =>
        repo(i + 1, 10, "MIT", { forksCount: i }),
      );
      const pages: Page[] = [];
      // Initial query reaches the cap, then the overlapping stars<=10 interval
      // proves the boundary itself cannot be enumerated. The unseen 1001st
      // candidate could have the most forks, so no prefix may be certified.
      for (const bound of [null, 10]) {
        for (let i = 0; i < 10; i++) {
          const next = new URL(buildSearchUrl(bound, acceptedSpdxIds));
          next.searchParams.set("page", String(i + 2));
          pages.push({
            items: items.slice(i * 100, (i + 1) * 100),
            total: 1001,
            ...(i < 9 ? { next: next.toString() } : {}),
          });
        }
      }
      return provide(
        Effect.gen(function* () {
          const store = yield* Store;
          const result = yield* Effect.result(
            runCrawl(options).pipe(Effect.provideService(HttpClient.HttpClient, mock(pages, urls))),
          );
          expect(result._tag).toBe("Failure");
          expect(urls).toHaveLength(20);
          expect(new URL(urls[0]!).searchParams.get("q")).not.toContain("stars:");
          const saved = Option.getOrThrow(yield* store.crawlState);
          expect(saved.complete).toBe(false);
          expect(saved.pages).toBe(19);
          expect(saved.cursor?.url).toBe(urls[19]);
          expect(yield* store.repoCount).toBe(1000);
          expect((yield* Effect.result(store.requireCompletePopulation(3)))._tag).toBe("Failure");
        }),
      );
    },
  );

  it.effect("rejects even a first incomplete page that would fill the budget", () => {
    const urls: string[] = [];
    return provide(
      Effect.gen(function* () {
        const store = yield* Store;
        const result = yield* Effect.result(
          runCrawl(options).pipe(
            Effect.provideService(
              HttpClient.HttpClient,
              mock([{ items: [repo(1, 100), repo(2, 90), repo(3, 80)], incomplete: true }], urls),
            ),
          ),
        );
        expect(result._tag).toBe("Failure");
        expect(Option.isNone(yield* store.crawlState)).toBe(true);
        expect(yield* store.repoCount).toBe(0);
      }),
    );
  });

  it.effect("allows a fully enumerable tie of exactly 1000 results", () => {
    const urls: string[] = [];
    const items = Array.from({ length: 1000 }, (_, i) => repo(i + 1, 10, "MIT", { forksCount: i }));
    const pages: Page[] = Array.from({ length: 10 }, (_, i) => {
      const next = new URL(buildSearchUrl(10, acceptedSpdxIds));
      next.searchParams.set("page", String(i + 2));
      return {
        items: items.slice(i * 100, (i + 1) * 100),
        total: 1000,
        ...(i < 9 ? { next: next.toString() } : {}),
      };
    });
    pages.push({ items: [repo(1001, 9)], total: 1 });
    return provide(
      Effect.gen(function* () {
        const store = yield* Store;
        yield* store.ensurePopulationPolicy(policy);
        yield* store.setCrawlState({
          ...state,
          cursor: {
            url: buildSearchUrl(10, acceptedSpdxIds),
            intervalBound: 10,
            lastSeenStars: null,
          },
        });
        yield* runCrawl(options).pipe(
          Effect.provideService(HttpClient.HttpClient, mock(pages, urls)),
        );
        expect(urls).toHaveLength(11);
        expect(new URL(urls[10]!).searchParams.get("q")).toContain("stars:<=9");
        expect((yield* store.topRepos(3)).map((r) => r.id)).toEqual([1000, 999, 998]);
        yield* store.requireCompletePopulation(3);
      }),
    );
  });

  it.effect("reports exhaustion below budget, including zero-star candidates", () => {
    const urls: string[] = [];
    return provide(
      Effect.gen(function* () {
        const store = yield* Store;
        const result = yield* Effect.result(
          runCrawl(options).pipe(
            Effect.provideService(
              HttpClient.HttpClient,
              mock(
                [{ items: [repo(1, 0), repo(2, 0, "NOASSERTION")] }, { items: [repo(1, 0)] }],
                urls,
              ),
            ),
          ),
        );
        expect(result._tag).toBe("Failure");
        expect(yield* store.repoCount).toBe(1);
        expect((yield* Effect.result(store.requireCompletePopulation(3)))._tag).toBe("Failure");
        expect((yield* Effect.result(runCrawl(options)))._tag).toBe("Failure");
      }),
    );
  });
});
