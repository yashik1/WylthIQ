import { describe, expect, it } from "vitest";
import type { CanonicalField, Fact, FinancialPeriod } from "../fundamentals/types";
import {
  debtToEbitda,
  ebitda,
  freeCashFlow,
  freeCashFlowOf,
  effectiveTaxRate,
  enterpriseValueToEbitda,
  returnOnInvestedCapital,
  totalDebt,
} from "./returns";

function period(values: Partial<Record<CanonicalField, number>>): FinancialPeriod {
  const facts: Partial<Record<CanonicalField, Fact>> = {};
  for (const [field, value] of Object.entries(values) as [CanonicalField, number][]) {
    facts[field] = { value, unit: "USD", end: "2025-12-31", fiscalYear: 2025, fiscalPeriod: "FY", form: "10-K", sourceConcept: field, sourceFilingUrl: null };
  }
  return { fiscalYear: 2025, fiscalPeriod: "FY", end: "2025-12-31", form: "10-K", facts, filedAt: "2026-02-01" };
}

describe("returns and enterprise value", () => {
  it("adds short- and long-term debt, treating one missing as zero only when the other exists", () => {
    expect(totalDebt(period({ longTermDebt: 100, shortTermDebt: 20 }))).toBe(120);
    expect(totalDebt(period({ longTermDebt: 100 }))).toBe(100);
    expect(totalDebt(period({}))).toBeNull();
  });

  it("uses the filings' own tax rate, and falls back to 21% when it makes no sense", () => {
    expect(effectiveTaxRate(period({ incomeBeforeTax: 100, netIncome: 80 }))).toBeCloseTo(0.2);
    expect(effectiveTaxRate(period({ incomeBeforeTax: -50, netIncome: -40 }))).toBe(0.21);
    expect(effectiveTaxRate(period({ incomeBeforeTax: 100, netIncome: 120 }))).toBe(0.21);
  });

  it("computes return on invested capital after tax", () => {
    // NOPAT 200 × (1 − 0.2) = 160; invested capital 600 + 300 − 100 = 800.
    const p = period({ operatingIncome: 200, incomeBeforeTax: 190, netIncome: 152, equity: 600, longTermDebt: 300, cash: 100 });
    expect(returnOnInvestedCapital(p)).toBeCloseTo(0.2);
  });

  it("has no return on capital when the capital is not positive", () => {
    expect(returnOnInvestedCapital(period({ operatingIncome: 50, equity: 10, cash: 500 }))).toBeNull();
  });

  it("computes EV/EBITDA only with a debt figure and positive EBITDA", () => {
    const p = period({ operatingIncome: 80, depreciation: -20, longTermDebt: 200, cash: 100 });
    expect(ebitda(p)).toBe(100);
    expect(enterpriseValueToEbitda(p, 1000)).toBeCloseTo(11);
    expect(enterpriseValueToEbitda(period({ operatingIncome: 80, depreciation: 20 }), 1000)).toBeNull();
    expect(enterpriseValueToEbitda(period({ operatingIncome: -80, depreciation: 20, longTermDebt: 1 }), 1000)).toBeNull();
    expect(debtToEbitda(p)).toBe(2);
  });
});

describe("free cash flow", () => {
  it("subtracts capital spending as an outflow, whichever sign it was filed with", () => {
    expect(freeCashFlowOf(220, 60)).toBe(160);
    expect(freeCashFlowOf(220, -60)).toBe(160);
    expect(freeCashFlow(period({ operatingCashFlow: 130, capex: -30 }))).toBe(100);
  });

  it("is unknown when either half is missing", () => {
    expect(freeCashFlowOf(null, 60)).toBeNull();
    expect(freeCashFlowOf(220, undefined)).toBeNull();
    expect(freeCashFlow(period({ operatingCashFlow: 130 }))).toBeNull();
    expect(freeCashFlow(undefined)).toBeNull();
  });
});
