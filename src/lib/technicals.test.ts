import { describe, expect, it } from "vitest";
import { computeTechnicals, isTrendKey, TREND_FILTERS, trendDetail, trendStates, type DailyBar } from "./technicals";

const DAY = 86_400;
const START = Date.UTC(2025, 0, 2) / 1000;

/** Daily bars from a list of closes, one a day, highs and lows a touch either side. */
function bars(closes: number[]): DailyBar[] {
  return closes.map((close, i) => ({ time: START + i * DAY, close, high: close * 1.01, low: close * 0.99 }));
}

const flat = (n: number, value: number) => Array.from({ length: n }, () => value);
const ramp = (n: number, from: number, step: number) => Array.from({ length: n }, (_, i) => from + i * step);

describe("where a price stands against its history", () => {
  it("averages the last 50 and 200 closes", () => {
    const t = computeTechnicals(bars([...flat(150, 10), ...flat(50, 20)]))!;
    expect(t.sma50).toBe(20);
    expect(t.sma200).toBe(12.5);
    expect(t.close).toBe(20);
  });

  it("has no 200-day average, and so no cross, with less than 200 closes", () => {
    const t = computeTechnicals(bars(ramp(120, 10, 0.1)))!;
    expect(t.sma50).not.toBeNull();
    expect(t.sma200).toBeNull();
    expect(t.lastCross).toBeNull();
    expect(trendStates(t)).not.toContain("uptrend");
  });

  it("finds a golden cross a few days ago, and calls it recent", () => {
    // A long decline, then a sharp rise: the 50-day climbs back through the 200-day.
    const closes = [...ramp(220, 100, -0.2), ...ramp(45, 56, 1.5)];
    const t = computeTechnicals(bars(closes))!;
    expect(t.lastCross?.direction).toBe("golden");
    expect(t.lastCross!.barsAgo).toBeLessThanOrEqual(20);
    expect(trendStates(t)).toEqual(expect.arrayContaining(["golden-cross", "uptrend", "above-200"]));
    expect(trendStates(t)).not.toContain("death-cross");
  });

  it("finds a death cross the same way", () => {
    const closes = [...ramp(220, 50, 0.2), ...ramp(45, 94, -1.5)];
    const t = computeTechnicals(bars(closes))!;
    expect(t.lastCross?.direction).toBe("death");
    expect(trendStates(t)).toEqual(expect.arrayContaining(["death-cross", "downtrend", "below-200"]));
  });

  it("calls an old cross a trend, not a fresh cross", () => {
    const closes = [...ramp(220, 100, -0.2), ...ramp(40, 56, 1.5), ...ramp(60, 116, 0.05)];
    const t = computeTechnicals(bars(closes))!;
    expect(t.lastCross?.direction).toBe("golden");
    expect(t.lastCross!.barsAgo).toBeGreaterThan(20);
    expect(trendStates(t)).toContain("uptrend");
    expect(trendStates(t)).not.toContain("golden-cross");
  });

  it("reads the 52-week range from highs and lows, and says when the close is near either end", () => {
    const rising = computeTechnicals(bars(ramp(260, 50, 0.2)))!;
    expect(rising.high52w).toBeCloseTo(rising.close * 1.01, 6);
    expect(trendStates(rising)).toContain("near-high");
    expect(trendStates(rising)).not.toContain("near-low");

    const falling = computeTechnicals(bars(ramp(260, 100, -0.2)))!;
    expect(trendStates(falling)).toContain("near-low");
  });

  it("gives no 52-week range for under half a year of history", () => {
    const t = computeTechnicals(bars(ramp(100, 50, 0.2)))!;
    expect(t.high52w).toBeNull();
    expect(trendStates(t)).not.toContain("near-high");
  });

  it("measures momentum with RSI: steady falls are oversold, steady rises overbought", () => {
    expect(computeTechnicals(bars(ramp(60, 100, -1)))!.rsi14).toBeLessThan(30);
    expect(trendStates(computeTechnicals(bars(ramp(60, 100, -1)))!)).toContain("oversold");
    expect(trendStates(computeTechnicals(bars(ramp(60, 40, 1)))!)).toContain("overbought");
    // An unchanging price has no momentum either way.
    expect(computeTechnicals(bars(flat(60, 10)))!.rsi14).toBe(50);
  });

  it("ignores unusable bars and the order they arrive in", () => {
    const clean = bars(ramp(220, 10, 0.1));
    const messy = [...clean].reverse().concat([{ time: START, close: NaN, high: 1, low: 1 }, { time: START, close: 0, high: 0, low: 0 }]);
    expect(computeTechnicals(messy)).toEqual(computeTechnicals(clean));
    expect(computeTechnicals([])).toBeNull();
  });

  it("dates the figures by the last bar", () => {
    expect(computeTechnicals(bars(flat(3, 10)))!.asOf).toBe("2025-01-04");
  });
});

describe("the filter's states", () => {
  it("knows its own keys", () => {
    expect(Object.keys(TREND_FILTERS)).toHaveLength(10);
    expect(isTrendKey("golden-cross")).toBe(true);
    expect(isTrendKey("constructor")).toBe(false);
    expect(isTrendKey("moon")).toBe(false);
  });

  it("says in a few words why a row matched", () => {
    const figures = {
      technicalClose: 95,
      sma50: 110,
      sma200: 100,
      rsi14: 27.4,
      high52w: 100,
      low52w: 60,
      lastCross: "golden",
      lastCrossDate: "2026-10-14",
    };
    expect(trendDetail("golden-cross", figures)).toBe("Crossed Oct 14");
    expect(trendDetail("uptrend", figures)).toBe("50-day 10.0% above 200-day");
    expect(trendDetail("below-200", figures)).toBe("5.0% below 200-day");
    expect(trendDetail("near-high", figures)).toBe("5.0% below 52-week high");
    expect(trendDetail("near-low", figures)).toBe("58.3% above 52-week low");
    expect(trendDetail("oversold", figures)).toBe("RSI 27");
    expect(trendDetail("oversold", { ...figures, rsi14: null })).toBeNull();
  });
});
