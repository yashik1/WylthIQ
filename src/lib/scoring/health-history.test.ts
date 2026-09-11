import { describe, expect, it } from "vitest";
import { snapshotFundamentals } from "../fundamentals/as-reported";
import type {
  AsReportedSnapshot,
  CanonicalField,
  FinancialPeriod,
  NormalizedFundamentals,
} from "../fundamentals/types";
import { buildHealthHistory } from "./health-history";
import { buildHealthReport } from "./health";

/**
 * Health over time, scored only from what was public at each point.
 */

type Values = Partial<Record<CanonicalField, number>>;

const sound: Values = {
  assets: 1000, liabilities: 400, equity: 600, currentAssets: 500, currentLiabilities: 200,
  cash: 150, receivables: 100, inventory: 80, ppe: 300, longTermDebt: 150,
  retainedEarnings: 400, revenue: 1000, costOfRevenue: 550, grossProfit: 450,
  operatingIncome: 200, netIncome: 150, incomeBeforeTax: 190, interestExpense: 10, sga: 150,
  depreciation: 40, operatingCashFlow: 220, capex: 60, sharesOutstanding: 100,
};

const struggling: Values = {
  ...sound,
  liabilities: 900, equity: 250, currentLiabilities: 520, cash: 40, longTermDebt: 600,
  revenue: 800, grossProfit: 250, operatingIncome: -80, netIncome: -120, incomeBeforeTax: -110,
  operatingCashFlow: -50, sharesOutstanding: 130,
};

const grown = (values: Values, factor: number): Values =>
  Object.fromEntries(Object.entries(values).map(([k, v]) => [k, (v as number) * factor]));

function snapshot(fiscalYear: number, years: Values[]): AsReportedSnapshot {
  return {
    asOf: `${fiscalYear + 1}-02-15`,
    fiscalYear,
    form: "10-K",
    sourceFilingUrl: `https://www.sec.gov/${fiscalYear}`,
    periods: years.map((values, i) => ({
      fiscalYear: fiscalYear - i,
      end: `${fiscalYear - i}-12-31`,
      currency: "USD",
      values,
    })),
  };
}

function livePeriod(fiscalYear: number, values: Values): FinancialPeriod {
  return snapshotFundamentals(snapshot(fiscalYear, [values]), {
    cik: "1",
    entityName: "Test Co",
    taxonomy: "us-gaap",
  }).annual[0];
}

const base = { cik: "0000000001", entityName: "Test Co", taxonomy: "us-gaap" as const, missingFields: [] };

describe("health score history", () => {
  const snapshots = [
    snapshot(2025, [struggling, grown(sound, 1.1), sound]),
    snapshot(2024, [grown(sound, 1.1), sound, grown(sound, 0.9)]),
    snapshot(2023, [sound, grown(sound, 0.9), grown(sound, 0.8)]),
  ];

  const fundamentals: NormalizedFundamentals = {
    ...base,
    annual: [livePeriod(2025, struggling), livePeriod(2024, grown(sound, 1.1))],
    asReported: snapshots,
  };

  it("lists points oldest first, and measures the change on a year earlier", () => {
    const history = buildHealthHistory(fundamentals, "manufacturing")!;
    expect(history.points.map((p) => p.fiscalYear)).toEqual([2023, 2024, 2025]);
    expect(history.latest.fiscalYear).toBe(2025);
    expect(history.yearEarlier?.fiscalYear).toBe(2024);
    expect(history.change).toBeLessThan(0);
    expect(history.change).toBe(Math.round((history.latest.score - history.yearEarlier!.score) * 10) / 10);
  });

  it("scores each year from its own snapshot, not from today's figures", () => {
    // Today's figures restate FY2024 as a bad year. Its point must not move.
    const restated: NormalizedFundamentals = {
      ...fundamentals,
      annual: [livePeriod(2025, struggling), livePeriod(2024, struggling)],
    };
    const fromSnapshot = buildHealthReport(snapshotFundamentals(snapshots[1], base), "manufacturing", null).score;

    const point = buildHealthHistory(restated, "manufacturing")!.points.find((p) => p.fiscalYear === 2024)!;
    expect(point.score).toBe(fromSnapshot);
    expect(point.asOf).toBe("2025-02-15");
  });

  it("is not a history with fewer than two scored years", () => {
    expect(buildHealthHistory({ ...fundamentals, asReported: [snapshots[0]] }, "manufacturing")).toBeNull();
    expect(buildHealthHistory({ ...fundamentals, asReported: undefined }, "manufacturing")).toBeNull();
    expect(buildHealthHistory(null, "manufacturing")).toBeNull();
  });

  it("reports no change when the year before the latest is missing", () => {
    const gap = buildHealthHistory({ ...fundamentals, asReported: [snapshots[0], snapshots[2]] }, "manufacturing")!;
    expect(gap.yearEarlier).toBeNull();
    expect(gap.change).toBeNull();
  });
});
