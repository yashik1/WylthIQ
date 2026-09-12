import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { yahoo, yahooSymbol } from "./yahoo";

// The exchange lookup behind a bare ticker, so these tests exercise the
// fallback without reaching the symbol directory.
vi.mock("./twelvedata", () => ({
  searchGlobalSymbols: vi.fn(async () => [
    { symbol: "ZDV", name: "BMO Canadian Dividend ETF", exchange: "TSX", country: "Canada" },
  ]),
}));

/**
 * Yahoo keys every non-US listing by an exchange suffix. Passing the bare
 * ticker returns nothing at all — `ATZ` is empty while `ATZ.TO` is Aritzia —
 * so a company outside SEC coverage silently produced no fundamentals even
 * with the fallback enabled.
 */
describe("Yahoo exchange suffixes", () => {
  it.each([
    ["ATZ", "TSX", "ATZ.TO"],
    ["ATZ", "NEO", "ATZ.NE"],
    ["SHOP", "TSXV", "SHOP.V"],
    ["TSCO", "LSE", "TSCO.L"],
    ["SAP", "XETRA", "SAP.DE"],
    ["7203", "TSE", "7203.T"],
    ["BHP", "ASX", "BHP.AX"],
    ["0700", "HKEX", "0700.HK"],
  ])("maps %s on %s to %s", (symbol, exchange, expected) => {
    expect(yahooSymbol(symbol, exchange)).toBe(expected);
  });

  it("leaves US listings bare", () => {
    for (const exchange of ["NYSE", "NASDAQ", "AMEX", "OTC", "BATS"]) {
      expect(yahooSymbol("AAPL", exchange)).toBe("AAPL");
    }
  });

  it("matches exchange names case-insensitively", () => {
    expect(yahooSymbol("ATZ", "tsx")).toBe("ATZ.TO");
    expect(yahooSymbol("PETR4", "Bovespa")).toBe("PETR4.SA");
  });

  it("keeps a suffix that is already present", () => {
    expect(yahooSymbol("ATZ.TO", "TSX")).toBe("ATZ.TO");
    expect(yahooSymbol("atz.to", null)).toBe("ATZ.TO");
  });

  // Guessing a suffix is worse than omitting one: a wrong guess can silently
  // return a different company's figures rather than failing.
  it("does not invent a suffix for an unknown exchange", () => {
    expect(yahooSymbol("ABC", "SOME-NEW-VENUE")).toBe("ABC");
    expect(yahooSymbol("ABC", null)).toBe("ABC");
    expect(yahooSymbol("ABC", "")).toBe("ABC");
  });

  it("upper-cases the ticker", () => {
    expect(yahooSymbol("atz", "TSX")).toBe("ATZ.TO");
  });
});

/**
 * Yahoo's answer to a bare foreign ticker.
 *
 * It is not a 404 but a stub — an "ECNQUOTE" row on NasdaqGS with no currency
 * — which sometimes carries a single stray print. Taken as data, that print
 * stopped the exchange-suffixed lookup from ever running, and ZDV charted as
 * one dot beside a year of VDY and XEI.
 */
describe("Yahoo's placeholder rows", () => {
  const stub = {
    chart: {
      result: [
        {
          meta: { instrumentType: "ECNQUOTE", regularMarketPrice: 33.07, regularMarketTime: 1_757_683_800 },
          timestamp: [1_757_683_800],
          indicators: { quote: [{ open: [33.07], high: [33.08], low: [33.06], close: [33.07], volume: [0] }] },
        },
      ],
    },
  };

  const toronto = {
    chart: {
      result: [
        {
          meta: { instrumentType: "ETF", currency: "CAD", regularMarketPrice: 33.1, regularMarketTime: 1_757_683_800 },
          timestamp: [1_757_597_400, 1_757_683_800],
          indicators: { quote: [{ open: [32.9, 33], high: [33, 33.2], low: [32.8, 32.95], close: [32.95, 33.1], volume: [1000, 1200] }] },
        },
      ],
    },
  };

  const json = (body: unknown) => ({ ok: true, json: async () => body }) as Response;
  let calls: string[];

  beforeEach(() => {
    process.env.ENABLE_YAHOO_FALLBACK = "true";
    calls = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      calls.push(String(url));
      return json(String(url).includes("ZDV.TO") ? toronto : stub);
    }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.ENABLE_YAHOO_FALLBACK;
  });

  it("charts the Toronto listing rather than the stub's stray print", async () => {
    const bars = await yahoo.getBars("ZDV", "1Day", new Date("2025-09-11"), new Date("2026-09-11"));

    expect(bars).toHaveLength(2);
    expect(bars.at(-1)?.close).toBe(33.1);
    expect(calls.some((url) => url.includes("ZDV.TO"))).toBe(true);
  });

  it("does not quote a stub, whose price carries no currency", async () => {
    const quote = await yahoo.getQuote("ZDV");

    expect(quote?.symbol).toBe("ZDV.TO");
    expect(quote?.currency).toBe("CAD");
    expect(quote?.price).toBe(33.1);
  });
});
