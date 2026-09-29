import { describe, expect, it } from "@effect/vitest";
import { Duration, Effect } from "effect";
import { Headers } from "effect/unstable/http";
import { makePacer, rateLimitWait } from "../src/github/search.ts";

const seconds = (headers: Record<string, string>, now = 1_000_000_000) =>
  Duration.toSeconds(rateLimitWait(Headers.fromInput(headers), now * 1000));

describe("rateLimitWait", () => {
  it("follows GitHub's documented order", () => {
    // retry-after wins when present
    expect(
      seconds({
        "retry-after": "19",
        "x-ratelimit-remaining": "0",
        "x-ratelimit-reset": "1000000100",
      }),
    ).toBe(20);
    // quota used up: until the reset, rounded up, plus a second
    expect(seconds({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1000000018" })).toBe(19);
    // quota left (secondary limit) or no headers: one full minute
    expect(seconds({ "x-ratelimit-remaining": "12", "x-ratelimit-reset": "1000000018" })).toBe(60);
    expect(seconds({})).toBe(60);
  });

  it("never schedules a retry that is bound to be refused", () => {
    // a reset already in the past, or retry-after 0, used to mean a 1s retry
    expect(seconds({ "x-ratelimit-remaining": "0", "x-ratelimit-reset": "999999990" })).toBe(60);
    expect(seconds({ "retry-after": "0" })).toBe(60);
  });
});

describe("makePacer", () => {
  it.live("spaces runs evenly instead of letting them burst", () =>
    Effect.gen(function* () {
      const pace = makePacer("60 millis");
      const started = Date.now();
      const at: Array<number> = [];
      for (let i = 0; i < 4; i++) {
        yield* pace;
        at.push(Date.now() - started);
      }
      expect(at[0]).toBeLessThan(30); // the first run does not wait
      for (let i = 1; i < at.length; i++)
        expect((at[i] ?? 0) - (at[i - 1] ?? 0)).toBeGreaterThanOrEqual(55);
    }),
  );

  it.live("does not wait when runs are already slower than the interval", () =>
    Effect.gen(function* () {
      const pace = makePacer("20 millis");
      yield* pace;
      yield* Effect.sleep("60 millis");
      const before = Date.now();
      yield* pace;
      expect(Date.now() - before).toBeLessThan(15);
    }),
  );
});
