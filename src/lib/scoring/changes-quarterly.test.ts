import { describe, expect, it } from "vitest";
import { buildChangeReport, buildQuarterComparisons, comparePeriods } from "./changes";
import { normalizeCompanyFacts } from "../fundamentals/normalize";
import type {
  CanonicalField,
  FinancialPeriod,
  NormalizedFundamentals,
  SecCompanyFacts,
} from "../fundamentals/types";
import aaplRaw from "../fundamentals/__fixtures__/aapl.json";

/**
 * Comparing quarters, and grading every move.
 *
 * The quarterly rules are about refusing: two quarters are compared only when
 * the comparison is a fair one, and a comparison that would need a figure no
 * company files — a standalone fourth quarter — is not made at all.
 */

const period = (
  fiscalYear: number,
  fiscalPeriod: string,
  end: string,
  values: Partial<Record<CanonicalField, number>>,
): FinancialPeriod => ({
  fiscalYear,
  fiscalPeriod,
  end,
  form: fiscalPeriod === "FY" ? "10-K" : "10-Q",
  filedAt: end,
  facts: Object.fromEntries(
    Object.entries(values).map(([field, value]) => [
      field,
      {
        value,
        unit: "USD",
        end,
        fiscalYear,
        fiscalPeriod,
        form: fiscalPeriod === "FY" ? "10-K" : "10-Q",
        sourceConcept: `us-gaap:${field}`,
        sourceFilingUrl: `https://sec.gov/${end}`,
      },
    ]),
  ) as FinancialPeriod["facts"],
});

const Q3_2026 = period(2026, "Q3", "2026-06-27", { revenue: 110, netIncome: 25 });
const Q2_2026 = period(2026, "Q2", "2026-03-28", { revenue: 100, netIncome: 22 });
const Q1_2026 = period(2026, "Q1", "2025-12-27", { revenue: 140, netIncome: 40 });
const Q3_2025 = period(2025, "Q3", "2025-06-28", { revenue: 100, netIncome: 20 });

const FY_2025_END = "2025-09-27";

describe("which quarters are compared", () => {
  it("compares the latest quarter with the same quarter a year earlier and with the one before", () => {
    const comparisons = buildQuarterComparisons([Q3_2026, Q2_2026, Q1_2026, Q3_2025], FY_2025_END);
    expect(comparisons.map((c) => [c.kind, c.toLabel, c.fromLabel])).toEqual([
      ["year-over-year", "Q3 FY2026", "Q3 FY2025"],
      ["sequential", "Q3 FY2026", "Q2 FY2026"],
    ]);
  });

  it("never compares a first quarter with the quarter before it", () => {
    // That quarter is a fourth quarter, which nobody files on its own.
    const Q1_2027 = period(2027, "Q1", "2026-12-26", { revenue: 150 });
    const comparisons = buildQuarterComparisons([Q1_2027, Q3_2026, Q2_2026], "2026-09-26");
    expect(comparisons.map((c) => c.kind)).not.toContain("sequential");
  });

  it("does not compare quarters that are not back to back", () => {
    const comparisons = buildQuarterComparisons([Q3_2026, Q1_2026], FY_2025_END);
    expect(comparisons.map((c) => c.kind)).not.toContain("sequential");
  });

  it("does not compare the same quarter two years apart as if one year apart", () => {
    const Q3_2024 = period(2024, "Q3", "2024-06-29", { revenue: 90 });
    const comparisons = buildQuarterComparisons([Q3_2026, Q2_2026, Q3_2024], FY_2025_END);
    expect(comparisons.map((c) => c.kind)).not.toContain("year-over-year");
  });

  it("has nothing to add when the annual report is newer than every quarter", () => {
    expect(buildQuarterComparisons([Q3_2026, Q2_2026, Q3_2025], "2026-09-26")).toEqual([]);
  });

  it("has nothing to say with fewer than two quarters", () => {
    expect(buildQuarterComparisons([Q3_2026], FY_2025_END)).toEqual([]);
    expect(buildQuarterComparisons(undefined, FY_2025_END)).toEqual([]);
  });
});

describe("the annual report carries its quarters", () => {
  const fundamentals = (quarterly?: FinancialPeriod[]): NormalizedFundamentals => ({
    cik: "0000000001",
    entityName: "Test Co",
    taxonomy: "us-gaap",
    annual: [
      period(2025, "FY", FY_2025_END, { revenue: 400 }),
      period(2024, "FY", "2024-09-28", { revenue: 300 }),
    ],
    quarterly,
    missingFields: [],
  });

  it("includes quarterly comparisons when there are quarters since the annual report", () => {
    const report = buildChangeReport(fundamentals([Q3_2026, Q2_2026, Q3_2025]))!;
    expect(report.quarterly.map((q) => q.kind)).toEqual(["year-over-year", "sequential"]);
    expect(report.quarterly[0].changes.find((c) => c.key === "revenue")?.delta).toBe("+10.0%");
  });

  it("works for a provider that supplies no quarters at all", () => {
    expect(buildChangeReport(fundamentals(undefined))!.quarterly).toEqual([]);
  });

  it("finds Apple's latest quarter against a year earlier in its real filings", () => {
    const aapl = normalizeCompanyFacts(aaplRaw as unknown as SecCompanyFacts);
    const report = buildChangeReport(aapl)!;
    const yearOverYear = report.quarterly.find((q) => q.kind === "year-over-year");
    expect(yearOverYear).toMatchObject({ toLabel: "Q3 FY2026", fromLabel: "Q3 FY2025" });
  });
});

describe("grading", () => {
  const compare = (
    latest: Partial<Record<CanonicalField, number>>,
    prior: Partial<Record<CanonicalField, number>>,
  ) => comparePeriods(period(2025, "FY", "2025-12-31", latest), period(2024, "FY", "2024-12-31", prior));

  it("grades moves by size on the shared bands", () => {
    const { changes } = compare({ revenue: 110, cash: 150, longTermDebt: 120 }, { revenue: 100, cash: 100, longTermDebt: 100 });
    const grade = (key: string) => changes.find((c) => c.key === key)?.severity;
    expect(grade("revenue")).toBe("notable");
    expect(grade("longTermDebt")).toBe("significant");
    expect(grade("cash")).toBe("critical");
  });

  it("grades any figure that crossed zero as critical", () => {
    const { changes } = compare({ netIncome: 1 }, { netIncome: -1 });
    expect(changes[0]).toMatchObject({ key: "netIncome", delta: "turned positive", severity: "critical" });
  });

  it("lists the largest moves first", () => {
    const { changes } = compare(
      { revenue: 106, cash: 130, longTermDebt: 50 },
      { revenue: 100, cash: 100, longTermDebt: 100 },
    );
    expect(changes.map((c) => [c.key, c.severity])).toEqual([
      ["longTermDebt", "critical"],
      ["cash", "significant"],
      ["revenue", "notable"],
    ]);
  });

  it("reports operating margin in points", () => {
    const { changes } = compare({ revenue: 100, operatingIncome: 25 }, { revenue: 100, operatingIncome: 20 });
    expect(changes.find((c) => c.key === "operatingMargin")).toMatchObject({
      delta: "+5.0 pts",
      severity: "significant",
      direction: "better",
    });
  });

  it("works out earnings per share only where both periods have a share count", () => {
    const withShares = compare({ netIncome: 120, sharesOutstanding: 100 }, { netIncome: 100, sharesOutstanding: 100 });
    expect(withShares.changes.find((c) => c.key === "eps")).toMatchObject({ from: "$1.00", to: "$1.20", delta: "+20.0%" });

    const withoutShares = compare({ netIncome: 120 }, { netIncome: 100, sharesOutstanding: 100 });
    expect(withoutShares.changes.find((c) => c.key === "eps")).toBeUndefined();
  });

  it("reports dividends paid without rating them", () => {
    const { changes } = compare({ dividendsPaid: -150 }, { dividendsPaid: -100 });
    expect(changes.find((c) => c.key === "dividendsPaid")).toMatchObject({ direction: "neutral", delta: "+50.0%" });
  });
});
