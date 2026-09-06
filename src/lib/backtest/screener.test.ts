import { describe, expect, it } from "vitest";
import { runScreenerBacktest, type CandidateData } from "./screener";
import type { FinancialsRow } from "./point-in-time";
import type { Bar } from "../providers/types";

/**
 * Building a basket at each rebalance date and chaining the results into one
 * equity curve — the part of the backtest that actually tests WylthIQ's
 * premise, so its arithmetic gets the same hand-verified treatment as
 * Phase 1's return math.
 */

const DAY = 86_400;

function financialsRow(over: Partial<FinancialsRow>): FinancialsRow {
  return {
    id: 1, companyId: 1, fiscalYear: 2022, endDate: "2022-12-31", form: "10-K",
    currency: "USD", filedAt: "2023-02-15",
    assets: 100_000, liabilities: 40_000, equity: 60_000,
    currentAssets: 50_000, currentLiabilities: 20_000,
    cash: 30_000, receivables: 5_000, inventory: 2_000, ppe: 40_000,
    longTermDebt: 20_000, shortTermDebt: 5_000, retainedEarnings: 30_000,
    revenue: 80_000, costOfRevenue: 40_000, grossProfit: 40_000,
    operatingIncome: 20_000, netIncome: 15_000, incomeBeforeTax: 18_000,
    interestExpense: 1_000, sga: 15_000, depreciation: 3_000,
    operatingCashFlow: 18_000, capex: 5_000, dividendsPaid: 2_000,
    sharesOutstanding: 1_000_000,
    sourceFilingUrl: null, createdAt: new Date(),
    ...over,
  };
}

const bars = (start: number, days: number, price: (i: number) => number): Bar[] =>
  Array.from({ length: days }, (_, i) => {
    const close = price(i);
    return { time: start + i * DAY, open: close, high: close, low: close, close, volume: 1_000_000 };
  });

/** A company with strong, improving fundamentals every year, filed on time. */
function healthyCandidate(symbol: string, priceFn: (i: number) => number, start: number, days: number): CandidateData {
  const rows: FinancialsRow[] = [2020, 2021, 2022].map((year, idx) =>
    financialsRow({
      fiscalYear: year,
      endDate: `${year}-12-31`,
      filedAt: `${year + 1}-02-15`,
      revenue: 60_000 + idx * 10_000,
      netIncome: 10_000 + idx * 3_000,
      assets: 90_000 + idx * 5_000,
      equity: 55_000 + idx * 5_000,
      cash: 30_000,
      longTermDebt: 5_000,
      shortTermDebt: 1_000,
    }),
  );
  return {
    symbol, cik: symbol, entityName: symbol, sector: "other",
    financialsRows: rows, bars: bars(start, days, priceFn), dividends: [],
  };
}

/** A company losing money on shrinking sales, buried in debt. */
function unhealthyCandidate(symbol: string, priceFn: (i: number) => number, start: number, days: number): CandidateData {
  const rows: FinancialsRow[] = [2020, 2021, 2022].map((year, idx) =>
    financialsRow({
      fiscalYear: year,
      endDate: `${year}-12-31`,
      filedAt: `${year + 1}-02-15`,
      revenue: 60_000 - idx * 8_000,
      netIncome: -5_000 - idx * 2_000,
      assets: 90_000,
      equity: 5_000,
      cash: 1_000,
      longTermDebt: 60_000,
      shortTermDebt: 20_000,
    }),
  );
  return {
    symbol, cik: symbol, entityName: symbol, sector: "other",
    financialsRows: rows, bars: bars(start, days, priceFn), dividends: [],
  };
}

const YEAR_DAYS = 366; // covers a leap year safely for the fixtures below

describe("choosing the basket", () => {
  const start = 1_700_000_000;

  it("picks the financially healthier company when only one slot is available", () => {
    const good = healthyCandidate("GOOD", () => 100, start, YEAR_DAYS * 2);
    const bad = unhealthyCandidate("BAD", () => 100, start, YEAR_DAYS * 2);

    const result = runScreenerBacktest(
      [good, bad],
      [new Date(start * 1000), new Date((start + YEAR_DAYS * DAY) * 1000)],
      10_000,
      1,
    );

    if ("error" in result) throw new Error(result.error);
    expect(result.periods[0].basket.map((b) => b.symbol)).toEqual(["GOOD"]);
    expect(result.periods[0].skipped.some((s) => s.symbol === "BAD")).toBe(true);
  });

  it("caps the basket at topN and records why the rest were left out", () => {
    const candidates = ["A", "B", "C"].map((s) => healthyCandidate(s, () => 100, start, YEAR_DAYS * 2));
    const result = runScreenerBacktest(
      candidates,
      [new Date(start * 1000), new Date((start + YEAR_DAYS * DAY) * 1000)],
      9_000,
      2,
    );

    if ("error" in result) throw new Error(result.error);
    expect(result.periods[0].basket).toHaveLength(2);
    expect(result.periods[0].skipped.some((s) => s.reason.includes("top 2"))).toBe(true);
  });

  it("equal-weights the starting allocation across the basket", () => {
    const candidates = ["A", "B"].map((s) => healthyCandidate(s, () => 100, start, YEAR_DAYS * 2));
    const result = runScreenerBacktest(
      candidates,
      [new Date(start * 1000), new Date((start + YEAR_DAYS * DAY) * 1000)],
      10_000,
      2,
    );

    if ("error" in result) throw new Error(result.error);
    for (const holding of result.periods[0].basket) {
      expect(holding.startValue).toBeCloseTo(5_000, 6);
    }
  });

  it("skips a candidate with no financial history public yet, without crashing", () => {
    const noHistory: CandidateData = {
      symbol: "NEW", cik: "2", entityName: "NEW",
      sector: "other", financialsRows: [], bars: bars(start, YEAR_DAYS * 2, () => 50), dividends: [],
    };
    const good = healthyCandidate("GOOD", () => 100, start, YEAR_DAYS * 2);

    const result = runScreenerBacktest(
      [good, noHistory],
      [new Date(start * 1000), new Date((start + YEAR_DAYS * DAY) * 1000)],
      10_000,
      2,
    );

    if ("error" in result) throw new Error(result.error);
    expect(result.periods[0].basket.map((b) => b.symbol)).toEqual(["GOOD"]);
    expect(result.periods[0].skipped[0]).toMatchObject({ symbol: "NEW" });
  });

  it("holds the portfolio flat in cash for a period where nothing qualifies", () => {
    const noHistory: CandidateData = {
      symbol: "NEW", cik: "2", entityName: "NEW",
      sector: "other", financialsRows: [], bars: bars(start, YEAR_DAYS * 2, () => 50), dividends: [],
    };

    const result = runScreenerBacktest(
      [noHistory],
      [new Date(start * 1000), new Date((start + YEAR_DAYS * DAY) * 1000)],
      10_000,
      1,
    );

    if ("error" in result) throw new Error(result.error);
    expect(result.periods[0].portfolioValueEnd).toBe(10_000);
    expect(result.finalValue).toBe(10_000);
  });
});

describe("chaining returns across rebalance periods", () => {
  it("compounds: doubling in year one, doubling again in year two", () => {
    // A single candidate, always the only choice, on one continuous price
    // series that exactly doubles over each of two consecutive one-year
    // windows: $100 at the start, $200 a year in, $400 a year after that.
    // Built as one exponential curve rather than two independently-reset
    // segments — two segments each restarting at $100 would put a
    // discontinuity exactly on the rebalance boundary, understating the
    // first period's return by however much the "reset" clawed back.
    const start = 1_700_000_000;
    const twoYears = bars(start, 2 * YEAR_DAYS + 1, (i) => 100 * 2 ** (i / YEAR_DAYS));
    const only: CandidateData = {
      symbol: "ONE", cik: "1", entityName: "ONE", sector: "other",
      financialsRows: [2020, 2021].map((y) =>
        financialsRow({ fiscalYear: y, endDate: `${y}-12-31`, filedAt: `${y + 1}-02-01` }),
      ),
      bars: twoYears, dividends: [],
    };

    const dates = [
      new Date(start * 1000),
      new Date((start + YEAR_DAYS * DAY) * 1000),
      new Date((start + 2 * YEAR_DAYS * DAY) * 1000),
    ];

    const result = runScreenerBacktest([only], dates, 1_000, 1);
    if ("error" in result) throw new Error(result.error);

    // $1,000 -> ~$2,000 after year one -> ~$4,000 after year two.
    expect(result.periods[0].portfolioValueEnd).toBeCloseTo(2_000, -1);
    expect(result.periods[1].portfolioValueStart).toBeCloseTo(result.periods[0].portfolioValueEnd, 6);
    expect(result.finalValue).toBeCloseTo(4_000, -1);
    expect(result.totalReturn).toBeCloseTo(3, 1); // +300%
  });
});

describe("max drawdown", () => {
  it("finds the exact peak-to-trough decline on a known series", () => {
    // A single holding whose price rises 50%, then falls to half of that
    // peak, then partially recovers. Peak is 150, trough is 75 -> a 50% draw.
    const start = 1_700_000_000;
    const shape = [100, 150, 120, 75, 90, 110];
    const priceBars = shape.map((p, i) => ({
      time: start + i * YEAR_DAYS * DAY, open: p, high: p, low: p, close: p, volume: 1,
    }));

    const only: CandidateData = {
      symbol: "ONE", cik: "1", entityName: "ONE", sector: "other",
      financialsRows: [2020].map((y) =>
        financialsRow({ fiscalYear: y, endDate: `${y}-12-31`, filedAt: `${y + 1}-02-01` }),
      ),
      bars: priceBars, dividends: [],
    };

    const dates = shape.map((_, i) => new Date((start + i * YEAR_DAYS * DAY) * 1000));
    const result = runScreenerBacktest([only], dates, 1_000, 1);

    if ("error" in result) throw new Error(result.error);
    expect(result.maxDrawdown).toBeCloseTo(0.5, 2);
  });

  it("is zero for a portfolio that only ever goes up", () => {
    const start = 1_700_000_000;
    const shape = [100, 110, 125, 140];
    const priceBars = shape.map((p, i) => ({
      time: start + i * YEAR_DAYS * DAY, open: p, high: p, low: p, close: p, volume: 1,
    }));
    const only: CandidateData = {
      symbol: "ONE", cik: "1", entityName: "ONE", sector: "other",
      financialsRows: [financialsRow({ fiscalYear: 2020, endDate: "2020-12-31", filedAt: "2021-02-01" })],
      bars: priceBars, dividends: [],
    };
    const dates = shape.map((_, i) => new Date((start + i * YEAR_DAYS * DAY) * 1000));
    const result = runScreenerBacktest([only], dates, 1_000, 1);

    if ("error" in result) throw new Error(result.error);
    expect(result.maxDrawdown).toBe(0);
  });
});

describe("input validation", () => {
  const start = 1_700_000_000;
  const candidate = healthyCandidate("A", () => 100, start, YEAR_DAYS);

  it("rejects fewer than two rebalance dates", () => {
    const result = runScreenerBacktest([candidate], [new Date(start * 1000)], 1_000, 1);
    expect("error" in result).toBe(true);
  });

  it("rejects a non-positive amount", () => {
    const result = runScreenerBacktest(
      [candidate],
      [new Date(start * 1000), new Date((start + YEAR_DAYS * DAY) * 1000)],
      0,
      1,
    );
    expect("error" in result).toBe(true);
  });

  it("rejects an empty candidate list", () => {
    const result = runScreenerBacktest(
      [],
      [new Date(start * 1000), new Date((start + YEAR_DAYS * DAY) * 1000)],
      1_000,
      1,
    );
    expect("error" in result).toBe(true);
  });
});
