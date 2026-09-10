import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPriceCache, fetchQuoteWithFailover, type PriceSource } from "./failover";
import { eodhd } from "./eodhd";
import { getProvider, layerSources, quoteSourcesFor } from "./index";
import type { Quote } from "./types";

/**
 * A supplementary provider must never remove what the app had without it.
 *
 * Setting EODHD_API_KEY once made `getProvider()` return EODHD whole. Its quote
 * call failed quietly on a key it would not serve, nothing stood behind it, and
 * every price on the live site disappeared at once — header prices, the index
 * strip, Compare, the nightly ingest — while the filings list emptied too.
 * These tests pin the rule that fixed it: the free stack answers first, and
 * the supplement is only ever asked after it.
 */

const QUOTE: Quote = {
  symbol: "AAPL", price: 100, change: 1, changePercent: 0.01, previousClose: 99,
  dayHigh: 101, dayLow: 98, volume: 1000, freshness: "delayed-15min", asOf: null,
};

function source(
  name: string,
  quote: Quote | null | Error,
): PriceSource & { quoteCalls: number } {
  const s = {
    name,
    quoteCalls: 0,
    isConfigured: () => true,
    async getBars() {
      return [];
    },
    async getQuote() {
      s.quoteCalls++;
      if (quote instanceof Error) throw quote;
      return quote;
    },
  };
  return s;
}

beforeEach(() => clearPriceCache());
afterEach(() => vi.unstubAllEnvs());

describe("layering an optional source", () => {
  it("puts the supplement after every trusted source", () => {
    expect(layerSources(["a", "b"], "extra")).toEqual(["a", "b", "extra"]);
  });

  it("changes nothing when there is no supplement", () => {
    const free = ["a", "b"];
    expect(layerSources(free, null)).toBe(free);
  });

  it("does not add a source twice", () => {
    expect(layerSources(["a", "extra"], "extra")).toEqual(["a", "extra"]);
  });
});

describe("a failing supplement cannot take away a price", () => {
  it("never asks the supplement when a free source answers", async () => {
    // The production outage in miniature: a key the supplement refuses, with
    // a free source that still works.
    const free = source("Yahoo", QUOTE);
    const broken = source("EODHD", new Error("HTTP 401"));

    const result = await fetchQuoteWithFailover(layerSources([free], broken), "AAPL");

    expect(result.value?.price).toBe(100);
    expect(result.source).toBe("Yahoo");
    expect(broken.quoteCalls).toBe(0);
  });

  it("still asks the supplement when every free source comes up empty", async () => {
    // What the supplement is for: a symbol the free stack does not cover.
    const free = source("Twelve Data", null);
    const worldwide = source("EODHD", { ...QUOTE, symbol: "RIO.L" });

    const result = await fetchQuoteWithFailover(layerSources([free], worldwide), "RIO.L");

    expect(result.source).toBe("EODHD");
    expect(free.quoteCalls).toBe(1);
  });
});

describe("the real provider wiring", () => {
  it("leaves EODHD out of the quote chain when no key is set", () => {
    vi.stubEnv("EODHD_API_KEY", "");
    expect(quoteSourcesFor("AAPL")).not.toContain(eodhd);
  });

  it("puts EODHD last in the quote chain when a key is set", () => {
    vi.stubEnv("EODHD_API_KEY", "any-key");
    const chain = quoteSourcesFor("AAPL");
    expect(chain.at(-1)).toBe(eodhd);
    expect(chain.length).toBeGreaterThan(1);
  });

  it("never hands pages the bare EODHD provider", () => {
    // The exact regression: with a key set, getProvider() returned `eodhd`
    // itself, so nothing the free stack did survived.
    vi.stubEnv("EODHD_API_KEY", "any-key");
    const provider = getProvider();
    expect(provider).not.toBe(eodhd);
    expect(provider.name).toContain("EODHD");
  });

  it("names only the free stack when EODHD is not configured", () => {
    vi.stubEnv("EODHD_API_KEY", "");
    expect(getProvider().name).not.toContain("EODHD");
  });
});
