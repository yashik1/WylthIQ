import { afterEach, describe, expect, it, vi } from "vitest";
import { searchGlobalSymbols, twelveData } from "./twelvedata";

/**
 * Search must not wait on a directory that has stopped answering.
 *
 * The directory once closed a connection mid-response and the search box sat
 * on "Searching…" for a full minute, because nothing bounded the wait. Every
 * search for a ticker EDGAR also holds now asks the directory too, so a stall
 * there would freeze some of the commonest searches.
 */

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the worldwide symbol directory", () => {
  it("answers with nothing once the directory takes too long", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => {})));

    const pending = searchGlobalSymbols("cash");
    await vi.advanceTimersByTimeAsync(5000);

    await expect(pending).resolves.toEqual([]);
  });

  it("still returns what a prompt directory sends", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              data: [
                {
                  symbol: "CASH",
                  instrument_name: "Global X High Interest Savings ETF",
                  exchange: "TSX",
                  instrument_type: "ETF",
                  country: "Canada",
                },
              ],
            }),
          ),
      ),
    );

    const results = await searchGlobalSymbols("cash");

    expect(results).toEqual([
      {
        symbol: "CASH",
        name: "Global X High Interest Savings ETF",
        exchange: "TSX",
        country: "Canada",
        cik: null,
        type: "etf",
      },
    ]);
  });
});

describe("what kind of instrument a listing is", () => {
  const directory = (data: Record<string, string>[]) =>
    vi.fn(async () => new Response(JSON.stringify({ data })));

  it("classifies a Toronto listing by the bare ticker the directory lists", async () => {
    // Searched as typed, "VCN.TO" matched no row, and the fund's page was laid
    // out as a company.
    vi.stubGlobal(
      "fetch",
      directory([
        { symbol: "VCN", instrument_name: "Vanguard FTSE Canada All Cap Index ETF", exchange: "TSX", instrument_type: "ETF", country: "Canada" },
        { symbol: "VCN", instrument_name: "Vanguard FTSE Canada All Cap ETF", exchange: "NEO", instrument_type: "ETF", country: "Canada" },
      ]),
    );

    expect(await twelveData.getInstrumentType("VCN.TO")).toBe("etf");
  });

  it("classifies a bare ticker as its US listing", async () => {
    // CASH is a savings ETF in Toronto and Pathward Financial in New York.
    vi.stubGlobal(
      "fetch",
      directory([
        { symbol: "CASH", instrument_name: "Global X High Interest Savings ETF", exchange: "TSX", instrument_type: "ETF", country: "Canada" },
        { symbol: "CASH", instrument_name: "Pathward Financial Inc", exchange: "NASDAQ", instrument_type: "Common Stock", country: "United States" },
      ]),
    );

    expect(await twelveData.getInstrumentType("CASH")).toBe("stock");
    expect(await twelveData.getInstrumentType("CASH.TO")).toBe("etf");
  });
});
