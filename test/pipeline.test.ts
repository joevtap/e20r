import { describe, expect, it } from "@effect/vitest";
import { Redacted } from "effect";
import { githubTokenAuth } from "../src/github/git.ts";
import { makeBreaker } from "../src/pipeline/run.ts";

describe("circuit breaker", () => {
  const clock = () => {
    let time = 0;
    return { now: () => time, advance: (millis: number) => (time += millis) };
  };

  it("pauses after a streak of network failures, doubling the cool-down", () => {
    const time = clock();
    const breaker = makeBreaker({ streak: 3, maxTrips: 5 }, time.now);
    expect([breaker.onNetworkFailure(), breaker.onNetworkFailure()]).toEqual([
      undefined,
      undefined,
    ]);
    expect(breaker.onNetworkFailure()).toEqual({ _tag: "pause", millis: 120_000, trip: 1 });
    expect(breaker.waitMillis()).toBe(120_000);

    // In-flight failures during the cool-down do not count.
    for (let i = 0; i < 10; i++) expect(breaker.onNetworkFailure()).toBeUndefined();

    time.advance(120_000);
    expect(breaker.waitMillis()).toBe(0);
    breaker.onNetworkFailure();
    breaker.onNetworkFailure();
    expect(breaker.onNetworkFailure()).toEqual({ _tag: "pause", millis: 240_000, trip: 2 });
  });

  it("resets on success, and halts after too many cool-downs in a row", () => {
    const time = clock();
    const breaker = makeBreaker({ streak: 2, maxTrips: 2 }, time.now);
    const trip = () => {
      time.advance(60 * 60_000);
      breaker.onNetworkFailure();
      return breaker.onNetworkFailure();
    };
    expect(trip()?._tag).toBe("pause");
    breaker.onSuccess();
    breaker.onNetworkFailure();
    breaker.onSuccess(); // a success breaks the streak too
    expect(trip()).toEqual({ _tag: "pause", millis: 120_000, trip: 1 });
    expect(trip()).toEqual({ _tag: "pause", millis: 240_000, trip: 2 });
    expect(trip()).toEqual({ _tag: "halt" });
    expect(breaker.halted).toBe(true);
    expect(breaker.onNetworkFailure()).toBeUndefined();
  });

  it("caps the cool-down at 30 minutes", () => {
    const time = clock();
    const breaker = makeBreaker({ streak: 1, maxTrips: 10 }, time.now);
    const pauses: Array<number> = [];
    for (let i = 0; i < 6; i++) {
      const event = breaker.onNetworkFailure();
      if (event?._tag === "pause") pauses.push(event.millis / 60_000);
      time.advance(60 * 60_000);
    }
    expect(pauses).toEqual([2, 4, 8, 16, 30, 30]);
  });
});

describe("githubTokenAuth", () => {
  it("sends the token as a github.com-scoped header through git's env config", () => {
    const auth = githubTokenAuth(Redacted.make("ghp_secret"));
    expect(auth.env["GIT_CONFIG_COUNT"]).toBe("1");
    expect(auth.env["GIT_CONFIG_KEY_0"]).toBe("http.https://github.com/.extraheader");
    const header = auth.env["GIT_CONFIG_VALUE_0"] ?? "";
    expect(header.startsWith("Authorization: Basic ")).toBe(true);
    expect(Buffer.from(header.slice("Authorization: Basic ".length), "base64").toString()).toBe(
      "x-access-token:ghp_secret",
    );
    expect(JSON.stringify(auth)).not.toContain("ghp_secret");
  });
});
