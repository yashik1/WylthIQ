import { describe, expect, it } from "vitest";
import type { Bar } from "../providers/types";
import { findBars, isDue } from "./chart-capture";
import type { TradeFill } from "./fills";
import { averagePrice, chartPlan, coversTrade, fillMarkers, tradeSpan } from "./trade-chart";

const NOW = new Date("2026-10-26T20:00:00Z");
const HOUR = 3600_000;

function fill(at: string | null, side: "buy" | "sell", shares = 10, price = 100, date = (at ?? "").slice(0, 10)): TradeFill {
  return { date: date || "2026-10-20", at, side, shares, price };
}

/** Bars every `step` seconds from `start` to `end`, inclusive. */
function bars(start: string, end: string, step: number): Bar[] {
  const out: Bar[] = [];
  for (let t = Date.parse(start) / 1000; t <= Date.parse(end) / 1000; t += step) {
    out.push({ time: t, open: 100, high: 101, low: 99, close: 100, volume: 1000 });
  }
  return out;
}

describe("which candles a trade is drawn on", () => {
  const timeframes = (fills: TradeFill[], openedAt: string, closedAt: string | null) =>
    chartPlan({ fills, openedAt, closedAt }, NOW).map((w) => w.timeframe);

  it("draws a scalp on one-minute candles, falling back to coarser ones", () => {
    const fills = [fill("2026-10-20T14:00:00Z", "buy"), fill("2026-10-20T14:25:00Z", "sell")];
    expect(timeframes(fills, "2026-10-20", "2026-10-20")).toEqual(["1Min", "5Min", "15Min", "1Hour", "1Day"]);
  });

  it("draws a day trade on five-minute candles", () => {
    const fills = [fill("2026-10-20T13:40:00Z", "buy"), fill("2026-10-20T19:10:00Z", "sell")];
    expect(timeframes(fills, "2026-10-20", "2026-10-20")[0]).toBe("5Min");
  });

  it("draws a swing on fifteen-minute or hourly candles, and a long hold on daily", () => {
    const week = [fill("2026-10-14T14:00:00Z", "buy"), fill("2026-10-19T19:00:00Z", "sell")];
    expect(timeframes(week, "2026-10-14", "2026-10-19")[0]).toBe("15Min");
    const month = [fill("2026-09-01T14:00:00Z", "buy"), fill("2026-10-15T19:00:00Z", "sell")];
    expect(timeframes(month, "2026-09-01", "2026-10-15")[0]).toBe("1Hour");
    const year = [fill("2025-06-01T14:00:00Z", "buy"), fill("2026-06-01T19:00:00Z", "sell")];
    expect(timeframes(year, "2025-06-01", "2026-06-01")).toEqual(["1Day"]);
  });

  it("uses the session for a dated day trade, and daily candles for anything longer", () => {
    const sameDay = [fill(null, "buy", 10, 100, "2026-10-20"), fill(null, "sell", 10, 101, "2026-10-20")];
    expect(timeframes(sameDay, "2026-10-20", "2026-10-20")[0]).toBe("5Min");
    const days = [fill(null, "buy", 10, 100, "2026-10-14"), fill(null, "sell", 10, 101, "2026-10-20")];
    expect(timeframes(days, "2026-10-14", "2026-10-20")).toEqual(["1Day"]);
  });

  it("runs an open trade up to now, and never asks for bars from the future", () => {
    const span = tradeSpan({ fills: [fill("2026-10-26T14:00:00Z", "buy")], openedAt: "2026-10-26", closedAt: null }, NOW);
    expect(span.end).toEqual(NOW);
    for (const w of chartPlan({ fills: [fill("2026-10-26T14:00:00Z", "buy")], openedAt: "2026-10-26", closedAt: null }, NOW)) {
      expect(w.to.getTime()).toBeLessThanOrEqual(NOW.getTime());
    }
  });

  it("pads the trade with context either side", () => {
    const fills = [fill("2026-10-20T14:00:00Z", "buy"), fill("2026-10-20T18:00:00Z", "sell")];
    const [w] = chartPlan({ fills, openedAt: "2026-10-20", closedAt: "2026-10-20" }, NOW);
    expect(w.from.getTime()).toBe(Date.parse("2026-10-20T14:00:00Z") - 2 * HOUR);
    expect(w.to.getTime()).toBe(Date.parse("2026-10-20T18:00:00Z") + 2 * HOUR);
  });
});

describe("whether bars show the trade", () => {
  const input = {
    fills: [fill("2026-10-20T14:00:00Z", "buy"), fill("2026-10-20T18:00:00Z", "sell")],
    openedAt: "2026-10-20",
    closedAt: "2026-10-20",
  };
  const [window] = chartPlan(input, NOW);

  it("accepts bars that run from before the entry to after the exit", () => {
    expect(coversTrade(bars("2026-10-20T12:00:00Z", "2026-10-20T20:00:00Z", 300), window, input, NOW)).toBe(true);
  });

  it("rejects bars that start after the entry, or stop before the exit", () => {
    expect(coversTrade(bars("2026-10-20T17:00:00Z", "2026-10-20T20:00:00Z", 300), window, input, NOW)).toBe(false);
    expect(coversTrade(bars("2026-10-20T12:00:00Z", "2026-10-20T14:30:00Z", 300), window, input, NOW)).toBe(false);
    expect(coversTrade([], window, input, NOW)).toBe(false);
  });
});

describe("the arrows", () => {
  const five = bars("2026-10-20T13:30:00Z", "2026-10-20T20:00:00Z", 300);

  it("puts each fill on the candle it happened in", () => {
    const markers = fillMarkers(
      [fill("2026-10-20T14:03:20Z", "buy", 6), fill("2026-10-20T14:00:00Z", "buy", 4), fill("2026-10-20T18:59:59Z", "sell", 10, 104)],
      five,
      "5Min",
    );
    expect(markers.map((m) => [new Date(m.time * 1000).toISOString(), m.side, m.shares])).toEqual([
      ["2026-10-20T14:00:00.000Z", "buy", 6],
      ["2026-10-20T14:00:00.000Z", "buy", 4],
      ["2026-10-20T18:55:00.000Z", "sell", 10],
    ]);
  });

  it("leaves out a fill outside the bars rather than pinning it to the edge", () => {
    expect(fillMarkers([fill("2026-10-21T15:00:00Z", "sell")], five, "5Min")).toEqual([]);
  });

  it("puts a dated fill on its day's candle on a daily chart, and nowhere on an intraday one", () => {
    // Daily bars stamped at midnight New York time, as Alpaca does.
    const daily = bars("2026-10-13T04:00:00Z", "2026-10-23T04:00:00Z", 86_400);
    const dated = [fill(null, "buy", 10, 100, "2026-10-15")];
    const [marker] = fillMarkers(dated, daily, "1Day");
    expect(new Date(marker.time * 1000).toISOString()).toBe("2026-10-15T04:00:00.000Z");
    expect(fillMarkers(dated, five, "5Min")).toEqual([]);
  });

  it("averages each side for the entry and exit lines", () => {
    const fills = [fill(null, "buy", 6, 100), fill(null, "buy", 4, 105), fill(null, "sell", 10, 110)];
    expect(averagePrice(fills, "buy")).toBe(102);
    expect(averagePrice(fills, "sell")).toBe(110);
    expect(averagePrice([], "sell")).toBeNull();
  });
});

describe("finding bars for a trade", () => {
  const input = {
    fills: [fill("2026-10-20T14:00:00Z", "buy"), fill("2026-10-20T14:20:00Z", "sell")],
    openedAt: "2026-10-20",
    closedAt: "2026-10-20",
  };
  const answer = (b: Bar[]) => ({ bars: b, source: "alpaca", includesDividends: false });

  it("steps to coarser candles when the finest have no history", async () => {
    const asked: string[] = [];
    const search = await findBars("SHOP.TO", input, NOW, async (_s, timeframe, from, to) => {
      asked.push(timeframe);
      if (timeframe === "1Min" || timeframe === "5Min") return answer([]);
      const step = timeframe === "15Min" ? 900 : timeframe === "1Hour" ? 3600 : 86_400;
      return answer(bars(from.toISOString(), to.toISOString(), step));
    });
    expect(asked).toEqual(["1Min", "5Min", "15Min"]);
    expect(search.covered?.window.timeframe).toBe("15Min");
  });

  it("reports a provider failure, so the trade is tried again, rather than settling for nothing", async () => {
    const search = await findBars("AAPL", input, NOW, async () => {
      throw new Error("every provider failed");
    });
    expect(search).toEqual({ covered: null, partial: null, failed: true });
  });
});

describe("when a trade's chart is due", () => {
  const fills = [fill("2026-10-20T14:00:00Z", "buy")];
  const chart = (key: string, hoursAgo: number, empty = false) => ({
    fillsKey: key,
    capturedAt: new Date(NOW.getTime() - hoursAgo * HOUR),
    empty,
  });
  const key = "2026-10-20|2026-10-20T14:00:00Z|buy|10|100";

  it("is due with no chart, and after its fills change", () => {
    expect(isDue({ closedAt: null, fills, chart: null }, NOW)).toBe(true);
    expect(isDue({ closedAt: "2026-10-21", fills, chart: chart("old", 1) }, NOW)).toBe(true);
    // Not straight away again after a try that did not take.
    expect(isDue({ closedAt: "2026-10-21", fills, chart: chart("old", 0.1) }, NOW)).toBe(false);
  });

  it("keeps an open trade's chart up to date, and leaves a closed one alone", () => {
    expect(isDue({ closedAt: null, fills, chart: chart(key, 7) }, NOW)).toBe(true);
    expect(isDue({ closedAt: null, fills, chart: chart(key, 2) }, NOW)).toBe(false);
    expect(isDue({ closedAt: "2026-10-21", fills, chart: chart(key, 500) }, NOW)).toBe(false);
  });

  it("tries a trade with no history again a day later", () => {
    expect(isDue({ closedAt: "2026-10-21", fills, chart: chart(key, 25, true) }, NOW)).toBe(true);
    expect(isDue({ closedAt: "2026-10-21", fills, chart: chart(key, 5, true) }, NOW)).toBe(false);
  });
});
