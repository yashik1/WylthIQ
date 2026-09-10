import { afterEach, describe, expect, it, vi } from "vitest";
import { searchGlobalSymbols } from "./twelvedata";

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
