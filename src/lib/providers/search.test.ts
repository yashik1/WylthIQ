import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SymbolSearchResult } from "./types";

/**
 * A ticker used in the US must not hide the same ticker on another exchange.
 *
 * Search returned SEC EDGAR's answer alone whenever EDGAR held the exact
 * ticker, so a Canadian ETF sharing its symbol with a US company could not be
 * found at all: searching CASH offered Pathward Financial and never Global X's
 * savings ETF on the TSX.
 */

const { worldwide } = vi.hoisted(() => ({ worldwide: vi.fn() }));

vi.mock("./twelvedata", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./twelvedata")>()),
  searchGlobalSymbols: worldwide,
}));

import { secEdgar } from "./sec-edgar";
import { getProvider } from "./index";

function listing(symbol: string, exchange: string, country: string, name: string): SymbolSearchResult {
  return { symbol, name, exchange, country, cik: null, type: "etf" };
}

beforeEach(() => {
  // The free stack alone, as on a deployment without EODHD.
  vi.stubEnv("EODHD_API_KEY", "");
  worldwide.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("searching a ticker EDGAR already holds", () => {
  it("still offers that ticker on other exchanges", async () => {
    vi.spyOn(secEdgar, "searchSymbols").mockResolvedValue([
      { symbol: "CASH", name: "PATHWARD FINANCIAL, INC.", exchange: null, cik: "0000907471" },
      { symbol: "CASHX", name: "A prefix match", exchange: null, cik: "0000000001" },
    ]);
    worldwide.mockResolvedValue([
      listing("CASH", "NASDAQ", "United States", "Pathward Financial Inc"),
      listing("CASH", "TSX", "Canada", "Global X High Interest Savings ETF"),
      listing("CASHY", "NYSE", "United States", "A loose match"),
    ]);

    const results = await getProvider().searchSymbols("cash", 8);

    // EDGAR's exact match, then the Toronto listing, then EDGAR's other hits.
    // The directory's own US row for CASH is the same security as EDGAR's, and
    // its loose match stays out.
    expect(results.map((r) => [r.symbol, r.exchange])).toEqual([
      ["CASH", null],
      ["CASH", "TSX"],
      ["CASHX", null],
    ]);
    expect(results[0].supported).toBe(true);
    expect(results[1].supported).toBe(false);
  });

  it("returns EDGAR's results when the directory is unavailable", async () => {
    vi.spyOn(secEdgar, "searchSymbols").mockResolvedValue([
      { symbol: "CASH", name: "PATHWARD FINANCIAL, INC.", exchange: null, cik: "0000907471" },
    ]);
    worldwide.mockRejectedValue(new Error("offline"));

    const results = await getProvider().searchSymbols("CASH", 8);

    expect(results.map((r) => r.symbol)).toEqual(["CASH"]);
  });
});
