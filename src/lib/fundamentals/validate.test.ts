import { describe, expect, it } from "vitest";
import type { CanonicalField, Fact, FinancialPeriod, NormalizedFundamentals } from "./types";
import { validateFundamentals } from "./validate";

const NOW = new Date("2026-09-10T00:00:00Z");

function period(
  fiscalYear: number,
  values: Partial<Record<CanonicalField, number>>,
  { units = {}, derived = [] }: { units?: Partial<Record<CanonicalField, string>>; derived?: CanonicalField[] } = {},
): FinancialPeriod {
  const end = `${fiscalYear}-12-31`;
  const facts: Partial<Record<CanonicalField, Fact>> = {};
  for (const [field, v] of Object.entries(values) as [CanonicalField, number][]) {
    facts[field] = {
      value: v,
      unit: units[field] ?? (field === "sharesOutstanding" ? "shares" : "USD"),
      end,
      fiscalYear,
      fiscalPeriod: "FY",
      form: "10-K",
      sourceConcept: field,
      sourceFilingUrl: null,
      derived: derived.includes(field) || undefined,
    };
  }
  return { fiscalYear, fiscalPeriod: "FY", end, form: "10-K", facts, filedAt: `${fiscalYear + 1}-02-15` };
}

const sound = {
  assets: 1000, liabilities: 600, equity: 400, revenue: 800, netIncome: 80,
  operatingCashFlow: 120, capex: 40, sharesOutstanding: 100,
};

const fundamentals = (annual: FinancialPeriod[]): NormalizedFundamentals => ({
  cik: "1", entityName: "Test Co", taxonomy: "us-gaap", annual, quarterly: [], missingFields: [],
});

const keys = (f: NormalizedFundamentals, sector: "other" | "financial" = "other") =>
  validateFundamentals(f, sector, NOW).map((c) => c.key);

describe("data checks", () => {
  it("finds nothing unusual in consistent figures", () => {
    expect(validateFundamentals(fundamentals([period(2025, sound), period(2024, sound)]), "other", NOW)).toEqual([]);
  });

  it("notes a balance sheet that does not add up, and warns when the gap is large", () => {
    const small = validateFundamentals(fundamentals([period(2025, { ...sound, equity: 370 })]), "other", NOW);
    expect(small).toEqual([expect.objectContaining({ key: "balance-identity", severity: "note", period: "FY2025" })]);
    expect(small[0].message).toContain("3.0%");

    const large = validateFundamentals(fundamentals([period(2025, { ...sound, equity: 200 })]), "other", NOW);
    expect(large[0]).toMatchObject({ key: "balance-identity", severity: "warning" });
  });

  it("does not check the identity when liabilities were derived from it", () => {
    expect(keys(fundamentals([period(2025, { ...sound, equity: 200 }, { derived: ["liabilities"] })]))).toEqual([]);
  });

  it("warns about figures in more than one currency within a period", () => {
    const mixed = validateFundamentals(fundamentals([period(2025, sound, { units: { revenue: "CAD" } })]), "other", NOW);
    expect(mixed[0]).toMatchObject({ key: "mixed-currency", severity: "warning" });
    expect(mixed[0].message).toContain("USD and CAD");
  });

  it("flags implausible cash flow outside financial companies only", () => {
    const odd = fundamentals([period(2025, { ...sound, operatingCashFlow: 5000 })]);
    expect(keys(odd)).toContain("cash-flow-scale");
    expect(keys(odd, "financial")).not.toContain("cash-flow-scale");
  });

  it("notes one-off profits and capital spending above revenue", () => {
    expect(keys(fundamentals([period(2025, { ...sound, netIncome: 2000 })]))).toContain("one-off-income");
    expect(keys(fundamentals([period(2025, { ...sound, capex: 900 })]))).toContain("capex-scale");
  });

  it("warns about a share count that jumps between consecutive years", () => {
    const split = validateFundamentals(
      fundamentals([period(2025, { ...sound, sharesOutstanding: 400 }), period(2024, sound)]),
      "other",
      NOW,
    );
    expect(split[0]).toMatchObject({ key: "share-count", severity: "warning" });
    expect(split[0].message).toContain("+300.0%");

    expect(keys(fundamentals([period(2025, { ...sound, sharesOutstanding: 400 }), period(2022, sound)]))).not.toContain("share-count");
  });

  it("notes when the latest annual report is old, and lists warnings first", () => {
    const old = validateFundamentals(
      fundamentals([period(2023, { ...sound, operatingCashFlow: 5000 })]),
      "other",
      NOW,
    );
    expect(old.map((c) => c.key)).toEqual(["cash-flow-scale", "stale-annual"]);
  });

  it("never changes a figure", () => {
    const f = fundamentals([period(2025, { ...sound, equity: 200 })]);
    const before = JSON.stringify(f);
    validateFundamentals(f, "other", NOW);
    expect(JSON.stringify(f)).toBe(before);
  });
});
