import { describe, expect, it } from "vitest";
import { buildStatements } from "./statements";
import { describeChange } from "./statement-change";
import type { CanonicalField, Fact, FinancialPeriod, NormalizedFundamentals } from "./types";

function period(
  fiscalYear: number,
  fiscalPeriod: string,
  end: string,
  values: Partial<Record<CanonicalField, number>>,
  derived: CanonicalField[] = [],
): FinancialPeriod {
  const facts: Partial<Record<CanonicalField, Fact>> = {};
  for (const [field, value] of Object.entries(values) as [CanonicalField, number][]) {
    facts[field] = {
      value,
      unit: field === "sharesOutstanding" ? "shares" : "USD",
      end,
      fiscalYear,
      fiscalPeriod,
      form: fiscalPeriod === "FY" ? "10-K" : "10-Q",
      sourceConcept: `us-gaap:${field}`,
      sourceFilingUrl: `https://www.sec.gov/${end}`,
      derived: derived.includes(field) || undefined,
    };
  }
  return { fiscalYear, fiscalPeriod, end, form: fiscalPeriod === "FY" ? "10-K" : "10-Q", facts, filedAt: end };
}

const fundamentals: NormalizedFundamentals = {
  cik: "1",
  entityName: "Test Co",
  taxonomy: "us-gaap",
  missingFields: [],
  annual: [
    period(2025, "FY", "2025-09-27", { revenue: 400, grossProfit: 180, operatingIncome: 120, netIncome: 90, operatingCashFlow: 130, capex: -30, liabilities: 300, equity: 200, sharesOutstanding: 30 }, ["liabilities"]),
    period(2024, "FY", "2024-09-28", { revenue: 360, grossProfit: 150, operatingIncome: 90, netIncome: 70, operatingCashFlow: 110, capex: 25, liabilities: 280, equity: 180, sharesOutstanding: 31 }),
  ],
  quarterly: [
    period(2026, "Q3", "2026-06-27", { revenue: 110, netIncome: 25 }),
    period(2026, "Q2", "2026-03-28", { revenue: 100, netIncome: 22 }),
    period(2026, "Q1", "2025-12-27", { revenue: 130, netIncome: 35 }),
    period(2025, "Q3", "2025-06-28", { revenue: 100, netIncome: 24 }),
  ],
};

describe("the statement explorer", () => {
  const data = buildStatements(fundamentals, "USD");

  it("labels columns by fiscal period, newest first, and links each to its filing", () => {
    expect(data.annual.map((c) => c.label)).toEqual(["FY2025", "FY2024"]);
    expect(data.quarterly.map((c) => c.label)).toEqual(["Q3 FY2026", "Q2 FY2026", "Q1 FY2026", "Q3 FY2025"]);
    expect(data.annual[0].sourceUrl).toBe("https://www.sec.gov/2025-09-27");
  });

  it("carries each reported figure's concept and marks calculated ones", () => {
    const latest = data.annual[0].cells;
    expect(latest.revenue).toEqual({ value: 400, concept: "us-gaap:revenue", derived: false });
    expect(latest.liabilities.derived).toBe(true);
    expect(latest.grossMargin).toMatchObject({ value: 0.45, concept: null, derived: true });
  });

  it("shows capital spending as a magnitude, whatever sign the filer used", () => {
    expect(data.annual[0].cells.capex.value).toBe(30);
    expect(data.annual[0].cells.freeCashFlow.value).toBe(100);
    expect(data.annual[1].cells.freeCashFlow.value).toBe(85);
  });

  it("compares the latest year with the one before, and the latest quarter with a year earlier", () => {
    expect(data.annualBase).toBe(1);
    expect(data.quarterlyBase).toBe(3);
  });

  it("gives every calculated row its formula and sends nothing unserialisable", () => {
    for (const table of data.tables) {
      for (const row of table.rows) {
        expect(Object.values(row).some((v) => typeof v === "function")).toBe(false);
      }
    }
    const income = data.tables.find((t) => t.key === "income")!;
    expect(income.rows.find((r) => r.key === "netMargin")?.formula).toBe("Net income ÷ revenue");
  });

  it("has no comparison without a consecutive earlier period", () => {
    const gap = buildStatements({ ...fundamentals, annual: [fundamentals.annual[0], { ...fundamentals.annual[1], fiscalYear: 2022 }], quarterly: [] }, "USD");
    expect(gap.annualBase).toBeNull();
    expect(gap.quarterlyBase).toBeNull();
  });
});

describe("the change column", () => {
  it("moves amounts in per cent, ratios in points and multiples in turns", () => {
    expect(describeChange(400, 360, "money")).toBe("+11.1%");
    expect(describeChange(0.45, 0.4167, "percent")).toBe("+3.3 pts");
    expect(describeChange(1.5, 1.8, "multiple")).toBe("−0.30x");
  });

  it("gives no percentage across zero or from zero", () => {
    expect(describeChange(-10, 20, "money")).toBe("n/m");
    expect(describeChange(10, 0, "money")).toBe("n/m");
    expect(describeChange(0, 20, "money")).toBe("−100.0%");
  });

  it("says nothing when either figure is missing", () => {
    expect(describeChange(null, 20, "money")).toBeNull();
    expect(describeChange(10, null, "percent")).toBeNull();
  });
});
