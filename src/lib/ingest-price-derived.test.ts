import { describe, expect, it } from "vitest";
import { __testing } from "./ingest";

const { priceDerived } = __testing;

/**
 * The figures a share price implies.
 *
 * These were null for every one of the 542 companies on the live deployment
 * while the dashboard showed current prices for the same symbols, so the
 * screener printed a column of dashes. Recomputing them on each quote refresh
 * is what repairs that, and the cases below are the ones where the obvious
 * implementation does the wrong thing.
 */

const latest = (over: Record<string, number | null> = {}) => ({
  shares_outstanding: 1_000,
  net_income: 500,
  equity: 2_000,
  revenue: 4_000,
  dividends_paid: 100,
  ...over,
});

describe("recomputing from a fresh price", () => {
  it("derives market value and every ratio built on it", () => {
    const out = priceDerived(10, latest());

    expect(out.marketCap).toBe(10_000);
    expect(out.peRatio).toBeCloseTo(20, 5);
    expect(out.pbRatio).toBeCloseTo(5, 5);
    expect(out.psRatio).toBeCloseTo(2.5, 5);
    expect(out.dividendYield).toBeCloseTo(0.01, 5);
  });

  it("tracks the price, which is the point of recomputing at all", () => {
    expect(priceDerived(10, latest()).marketCap).toBe(10_000);
    expect(priceDerived(25, latest()).marketCap).toBe(25_000);
  });

  /*
    The rule that keeps this safe to run every few minutes. The result is
    spread over the existing row, so an empty object leaves whatever is stored
    untouched. Returning nulls instead would wipe out a good market cap — one
    Finnhub reported directly, say — the first time a filer failed to tag its
    share count.
  */
  it("changes nothing when the share count is unknown", () => {
    expect(priceDerived(10, latest({ shares_outstanding: null }))).toEqual({});
    expect(priceDerived(10, latest({ shares_outstanding: 0 }))).toEqual({});
    expect(priceDerived(10, undefined)).toEqual({});
  });

  /*
    A loss makes a P/E meaningless rather than negative. A negative P/E sorts
    to the top of "lowest P/E" and reads as the cheapest company on the
    screen, which is the exact opposite of what it means.
  */
  /*
    The filing and the price need not be in the same money.

    Royal Bank files in Canadian dollars and is quoted in New York in US ones.
    Dividing straight through published it at 19 times earnings while the stock
    page, which converts, said 27 — and the whole difference was the exchange
    rate rather than anything about the bank.
  */
  describe("when the filing is in another currency", () => {
    const cad = { from: "CAD", to: "USD", rate: 0.72 };

    it("restates the filing before dividing into it", () => {
      const out = priceDerived(10, latest(), cad);

      expect(out.marketCap).toBe(10_000);
      // 10,000 USD over 500 CAD of profit, which is 360 USD.
      expect(out.peRatio).toBeCloseTo(10_000 / 360, 5);
      expect(out.pbRatio).toBeCloseTo(10_000 / 1_440, 5);
      expect(out.psRatio).toBeCloseTo(10_000 / 2_880, 5);
      expect(out.dividendYield).toBeCloseTo(72 / 10_000, 5);
    });

    it("leaves the market value in the currency it was quoted in", () => {
      // The share count is a count, so no rate touches it.
      expect(priceDerived(10, latest(), cad).marketCap).toBe(10_000);
    });

    it("publishes no ratio at all when the rate is unknown", () => {
      const out = priceDerived(10, latest(), { from: "CAD", to: "USD", rate: null });

      expect(out.marketCap).toBe(10_000);
      expect(out.peRatio).toBeNull();
      expect(out.pbRatio).toBeNull();
      expect(out.psRatio).toBeNull();
      expect(out.dividendYield).toBeNull();
    });

    it("divides as before when both are the same currency", () => {
      const out = priceDerived(10, latest(), { from: "USD", to: "USD", rate: 1 });
      expect(out.peRatio).toBeCloseTo(20, 5);
    });
  });

  /*
    The vendor's valuation, when the filing's share count is not counting the
    thing being priced. On the live site this was Visa and eleven others with
    no market value at all, Booking at a twenty-third of its size across a
    share split, and Brookfield Renewable at $174m against $12bn.
  */
  describe("with a second opinion on the market value", () => {
    it("uses the vendor's figure when the two are far apart", () => {
      const out = priceDerived(10, latest(), undefined, { marketCap: 1_000_000, shares: null });

      // 10 x 1,000 shares would be 10,000 — a hundredth of what it is worth.
      expect(out.marketCap).toBe(1_000_000);
      expect(out.peRatio).toBeCloseTo(2_000, 5);
    });

    it("keeps the arithmetic when they roughly agree", () => {
      const out = priceDerived(10, latest(), undefined, { marketCap: 9_000, shares: null });
      expect(out.marketCap).toBe(10_000);
    });

    it("counts shares the filing never tagged", () => {
      const out = priceDerived(
        10,
        latest({ shares_outstanding: null }),
        undefined,
        { marketCap: 20_500, shares: 2_000 },
      );

      expect(out.marketCap).toBe(20_000);
      expect(out.peRatio).toBeCloseTo(40, 5);
    });

    it("still changes nothing when neither can be had", () => {
      expect(priceDerived(10, latest({ shares_outstanding: null }))).toEqual({});
    });
  });

  it("refuses a P/E against a loss", () => {
    expect(priceDerived(10, latest({ net_income: -500 })).peRatio).toBeNull();
    expect(priceDerived(10, latest({ net_income: 0 })).peRatio).toBeNull();
  });

  it("still reports the other ratios when earnings are negative", () => {
    const out = priceDerived(10, latest({ net_income: -500 }));
    expect(out.marketCap).toBe(10_000);
    expect(out.pbRatio).toBeCloseTo(5, 5);
    expect(out.psRatio).toBeCloseTo(2.5, 5);
  });

  it("divides by nothing when a figure was never reported", () => {
    const out = priceDerived(10, latest({ equity: null, revenue: null, net_income: null }));
    expect(out.pbRatio).toBeNull();
    expect(out.psRatio).toBeNull();
    expect(out.peRatio).toBeNull();
    expect(out.marketCap).toBe(10_000);
  });

  it("does not divide by a zero denominator", () => {
    const out = priceDerived(10, latest({ equity: 0, revenue: 0 }));
    expect(out.pbRatio).toBeNull();
    expect(out.psRatio).toBeNull();
  });

  /*
    Dividends are a cash outflow and filers disagree about the sign. Taken as
    tagged, a negatively-tagged filer would report a negative yield — an
    income screen would then rank the payers last.
  */
  it("reads a negatively-tagged dividend as a payment", () => {
    expect(priceDerived(10, latest({ dividends_paid: -100 })).dividendYield).toBeCloseTo(0.01, 5);
  });

  it("leaves the yield null for a company that pays nothing", () => {
    expect(priceDerived(10, latest({ dividends_paid: null })).dividendYield).toBeNull();
  });
});
