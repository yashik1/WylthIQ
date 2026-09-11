import { describe, expect, it } from "vitest";
import { snapshotFundamentals } from "../fundamentals/as-reported";
import type { CanonicalField, NormalizedFundamentals } from "../fundamentals/types";
import { buildHealthBreakdown } from "./health-breakdown";
import { buildHealthReport } from "./health";

type Values = Partial<Record<CanonicalField, number>>;

function fundamentals(years: Values[]): NormalizedFundamentals {
  return snapshotFundamentals(
    {
      asOf: "2026-02-15",
      fiscalYear: 2025,
      form: "10-K",
      sourceFilingUrl: null,
      periods: years.map((values, i) => ({ fiscalYear: 2025 - i, end: `${2025 - i}-12-31`, currency: "USD", values })),
    },
    { cik: "1", entityName: "Test Co", taxonomy: "us-gaap" },
  );
}

const sound: Values = {
  assets: 1000, liabilities: 400, equity: 600, currentAssets: 500, currentLiabilities: 200,
  cash: 150, longTermDebt: 150, revenue: 1000, grossProfit: 450, operatingIncome: 200,
  netIncome: 150, interestExpense: 10, operatingCashFlow: 220, capex: 60, sharesOutstanding: 100,
  receivables: 100, ppe: 300, depreciation: 40, sga: 150, retainedEarnings: 400,
};

describe("health breakdown", () => {
  it("names each area in a word, with cash generation shown for context", () => {
    const f = fundamentals([sound, { ...sound, revenue: 800, grossProfit: 350 }]);
    const breakdown = buildHealthBreakdown(buildHealthReport(f, "manufacturing", null), f);

    // The same area names and words the investor brief uses.
    expect(breakdown.areas.map((a) => a.label)).toEqual([
      "Profitability", "Growth", "Cash generation", "Debt", "Accounting",
    ]);
    expect(breakdown.areas.find((a) => a.key === "profitability")?.word).toBe("Strong");
    expect(breakdown.areas.find((a) => a.key === "cash")).toMatchObject({ word: "Strong", scored: false });
    expect(breakdown.areas.find((a) => a.key === "debt")?.word).toBe("Strong");
    expect(breakdown.areas.map((a) => a.word)).not.toContain("Moderate");
    expect(breakdown.scoredTotal).toBe(4);
  });

  it("names the areas left out of the average for want of figures", () => {
    // One year: growth and the accounting screen both need the year before.
    const f = fundamentals([sound]);
    const breakdown = buildHealthBreakdown(buildHealthReport(f, "manufacturing", null), f);

    expect(breakdown.unavailable).toContain("Growth");
    expect(breakdown.scoredEvaluated).toBe(4 - breakdown.unavailable.length);
    expect(breakdown.areas.find((a) => a.key === "growth")?.word).toBe("Not enough data");
  });

  it("reads cash generation from operating cash flow and capital spending", () => {
    const burning = fundamentals([{ ...sound, operatingCashFlow: -20 }]);
    expect(buildHealthBreakdown(buildHealthReport(burning, "manufacturing", null), burning).areas[2].rating).toBe("poor");

    const heavy = fundamentals([{ ...sound, capex: 400 }]);
    expect(buildHealthBreakdown(buildHealthReport(heavy, "manufacturing", null), heavy).areas[2].rating).toBe("fair");

    const silent = fundamentals([{ ...sound, operatingCashFlow: undefined }]);
    expect(buildHealthBreakdown(buildHealthReport(silent, "manufacturing", null), silent).areas[2].word).toBe("Not enough data");
  });

  it("keeps each summary to a single sentence", () => {
    const f = fundamentals([sound, sound]);
    for (const area of buildHealthBreakdown(buildHealthReport(f, "manufacturing", null), f).areas) {
      expect(area.summary.split(/(?<=[.!?])\s/).length).toBe(1);
    }
  });
});
