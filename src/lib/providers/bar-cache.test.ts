import { describe, expect, it } from "vitest";
import {
  isCacheFresh,
  isStoredTimeframe,
  isUsMarketOpen,
  lastSettledClose,
  newYorkParts,
  parseCachedBars,
  servesWindow,
  sliceBars,
} from "./bar-cache";
import type { Bar } from "./types";

/**
 * Deciding when stored chart history is still good.
 *
 * What is pinned is the market-shaped rule: short reuse while the US market is
 * open, and after the day's bars settle, reuse until the next session — so an
 * evening or weekend of chart views costs nothing, and a chart never shows
 * yesterday's close as today's once today has one.
 */

// Tuesday 15 September 2026 is in daylight time: New York is UTC−4.
const tue = (utc: string) => new Date(`2026-09-15T${utc}Z`);

describe("the New York clock", () => {
  it("reads weekday, time and date in New York, whatever the server's zone", () => {
    expect(newYorkParts(tue("14:00:00"))).toEqual({ weekday: 2, minutes: 10 * 60, ymd: "2026-09-15" });
    // 02:00 UTC on Wednesday is still Tuesday evening in New York.
    expect(newYorkParts(new Date("2026-09-16T02:00:00Z")).ymd).toBe("2026-09-15");
  });

  it("knows when the market is open", () => {
    expect(isUsMarketOpen(tue("15:00:00"))).toBe(true); // 11:00
    expect(isUsMarketOpen(tue("13:00:00"))).toBe(false); // 09:00, before the open
    expect(isUsMarketOpen(tue("21:00:00"))).toBe(false); // 17:00, settled
    expect(isUsMarketOpen(new Date("2026-09-19T15:00:00Z"))).toBe(false); // Saturday
  });
});

describe("the last settled close", () => {
  it("is the day before, during a session", () => {
    expect(lastSettledClose(tue("15:00:00")).toISOString()).toBe("2026-09-14T20:30:00.000Z");
  });

  it("is today, once today's bars have settled", () => {
    expect(lastSettledClose(tue("21:00:00")).toISOString()).toBe("2026-09-15T20:30:00.000Z");
  });

  it("is Friday, across a weekend", () => {
    expect(lastSettledClose(new Date("2026-09-19T15:00:00Z")).toISOString()).toBe(
      "2026-09-18T20:30:00.000Z",
    );
  });

  it("follows New York into winter time", () => {
    // Monday 7 December 2026: New York is UTC−5, so 16:30 is 21:30 UTC.
    expect(lastSettledClose(new Date("2026-12-07T22:00:00Z")).toISOString()).toBe(
      "2026-12-07T21:30:00.000Z",
    );
  });
});

describe("whether stored daily bars are fresh", () => {
  it("is reused for an hour while the market is open", () => {
    const now = tue("15:00:00");
    expect(isCacheFresh("1Day", tue("14:30:00"), now)).toBe(true);
    expect(isCacheFresh("1Day", tue("13:30:00"), now)).toBe(false);
  });

  it("holds from the settled close until the next open", () => {
    const evening = tue("23:00:00");
    expect(isCacheFresh("1Day", tue("20:45:00"), evening)).toBe(true);
    // Fetched mid-session: the closing bar was still moving.
    expect(isCacheFresh("1Day", tue("19:00:00"), evening)).toBe(false);
  });

  it("serves a whole weekend from one fetch after Friday's close", () => {
    expect(isCacheFresh("1Day", new Date("2026-09-18T21:00:00Z"), new Date("2026-09-20T18:00:00Z"))).toBe(true);
  });

  it("stores hourly bars for a shorter while", () => {
    const now = tue("15:00:00");
    expect(isCacheFresh("1Hour", tue("14:50:00"), now)).toBe(true);
    expect(isCacheFresh("1Hour", tue("14:30:00"), now)).toBe(false);
  });

  it("never stores minute bars", () => {
    expect(isStoredTimeframe("1Min")).toBe(false);
    expect(isStoredTimeframe("15Min")).toBe(false);
    expect(isCacheFresh("5Min", tue("14:59:00"), tue("15:00:00"))).toBe(false);
  });
});

describe("whether a stored window answers a request", () => {
  const now = tue("23:00:00");
  const fetchedAt = tue("21:00:00");

  it("answers a shorter window inside a longer stored one", () => {
    const row = { fromDate: new Date("2016-09-15T00:00:00Z"), fetchedAt };
    expect(servesWindow(row, "1Day", new Date("2025-09-15T00:00:00Z"), now)).toBe(true);
  });

  it("does not answer a longer window than it stored", () => {
    const row = { fromDate: new Date("2025-09-15T00:00:00Z"), fetchedAt };
    expect(servesWindow(row, "1Day", new Date("2021-09-15T00:00:00Z"), now)).toBe(false);
  });

  it("tolerates the same request made a day later", () => {
    const row = { fromDate: new Date("2025-09-15T23:00:00Z"), fetchedAt };
    expect(servesWindow(row, "1Day", new Date("2025-09-14T23:00:00Z"), now)).toBe(true);
  });
});

describe("reading what was stored", () => {
  const bar = (time: number): Bar => ({ time, open: 1, high: 1, low: 1, close: 1, volume: 0 });

  it("keeps both ends of the window", () => {
    const bars = [bar(100), bar(200), bar(300)];
    expect(sliceBars(bars, new Date(100_000), new Date(200_000))).toEqual([bar(100), bar(200)]);
  });

  it("accepts a well-formed row and carries its source", () => {
    expect(parseCachedBars({ bars: [bar(1)], source: "Alpaca", includesDividends: false })).toEqual({
      bars: [bar(1)],
      source: "Alpaca",
      includesDividends: false,
    });
  });

  it("refuses anything it cannot trust", () => {
    expect(parseCachedBars(null)).toBeNull();
    expect(parseCachedBars({ bars: "nope" })).toBeNull();
    expect(parseCachedBars({ bars: [{ time: "x", close: 1 }] })).toBeNull();
  });
});
