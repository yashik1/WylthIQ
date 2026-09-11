import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearPriceCache,
  fetchBarsWithFailover,
  fetchQuoteWithFailover,
  markStaleQuote,
  PROVIDER_TIMEOUT_MS,
  type PriceSource,
} from "./failover";
import type { Quote } from "./types";

/**
 * Reliability: every failure is categorised, a hung provider is abandoned,
 * and a stale quote is never passed off as current.
 */

const NOW = Date.parse("2026-09-10T15:00:00Z");

const quote = (over: Partial<Quote> = {}): Quote => ({
  symbol: "AAPL",
  price: 100,
  change: 1,
  changePercent: 0.01,
  previousClose: 99,
  dayHigh: 101,
  dayLow: 98,
  volume: 1000,
  freshness: "delayed-15min",
  asOf: "2026-09-10T14:45:00Z",
  ...over,
});

function source(name: string, getQuote: PriceSource["getQuote"], getBars?: PriceSource["getBars"]): PriceSource {
  return {
    name,
    isConfigured: () => true,
    getQuote,
    getBars: getBars ?? (async () => []),
  };
}

beforeEach(() => {
  clearPriceCache();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("categorised failures", () => {
  it("names why each provider failed", async () => {
    const limited = source("A", async () => {
      throw new Error("You have run out of API credits");
    });
    const missing = source("B", async () => null);
    const good = source("C", async () => quote());

    const result = await fetchQuoteWithFailover([limited, missing, good], "AAPL");
    expect(result.source).toBe("C");
    expect(result.attempts.map((a) => [a.provider, a.category])).toEqual([
      ["A", "RATE_LIMITED"],
      ["B", "NO_DATA"],
    ]);
  });

  it("calls a thin bar series invalid data rather than an answer", async () => {
    const from = new Date("2025-09-10T00:00:00Z");
    const to = new Date("2026-09-10T00:00:00Z");
    const thin = source("Thin", async () => null, async () => [
      { time: Date.parse("2026-09-01T00:00:00Z") / 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
      { time: Date.parse("2026-09-02T00:00:00Z") / 1000, open: 1, high: 1, low: 1, close: 1, volume: 1 },
    ]);
    const result = await fetchBarsWithFailover([thin], "XEQT", "1Day", from, to);
    expect(result.attempts[0].category).toBe("INVALID_DATA");
  });
});

describe("timeouts", () => {
  it("abandons a provider that hangs and moves on", async () => {
    const hung = source("Hung", () => new Promise<Quote | null>(() => {}));
    const good = source("Good", async () => quote());

    const pending = fetchQuoteWithFailover([hung, good], "AAPL");
    await vi.advanceTimersByTimeAsync(PROVIDER_TIMEOUT_MS.quote + 1);
    const result = await pending;

    expect(result.source).toBe("Good");
    expect(result.attempts).toEqual([
      expect.objectContaining({ provider: "Hung", category: "TIMEOUT" }),
    ]);
  });
});

describe("stale quotes", () => {
  it("marks a quote days old as stale, and leaves a recent one alone", () => {
    expect(markStaleQuote(quote({ asOf: "2026-09-01T20:00:00Z" }), NOW).freshness).toBe("stale");
    expect(markStaleQuote(quote({ asOf: "2026-09-06" }), NOW).freshness).toBe("delayed-15min");
    expect(markStaleQuote(quote({ asOf: null }), NOW).freshness).toBe("delayed-15min");
  });

  it("prefers a current quote from a later provider over a stale one", async () => {
    const old = source("Old", async () => quote({ price: 90, asOf: "2026-08-20T20:00:00Z" }));
    const fresh = source("Fresh", async () => quote({ price: 100 }));

    const result = await fetchQuoteWithFailover([old, fresh], "AAPL");
    expect(result).toMatchObject({ source: "Fresh", value: { price: 100 } });
  });

  it("falls back to the stale quote, labelled stale, when nothing current exists", async () => {
    const old = source("Old", async () => quote({ price: 90, asOf: "2026-08-20T20:00:00Z" }));
    const result = await fetchQuoteWithFailover([old], "AAPL");
    expect(result.value).toMatchObject({ price: 90, freshness: "stale" });
  });
});
