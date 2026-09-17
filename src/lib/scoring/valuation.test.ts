import { describe, expect, it } from "vitest";
import { buildValuationMetrics } from "./valuation";
import type { NormalizedFundamentals } from "../fundamentals/types";

function fundamentals(overrides: Record<string, number | undefined> = {}): NormalizedFundamentals {
  const facts = {
    revenue: 1_000,
    netIncome: 10,
    equity: 200,
    cash: 100,
    longTermDebt: 50,
    shortTermDebt: 10,
    operatingIncome: 20,
    depreciation: 5,
    operatingCashFlow: 30,
    capex: 10,
    ...overrides,
  };

  return {
    cik: "123",
    entityName: "Test Co",
    taxonomy: "us-gaap",
    annual: [
      {
        fiscalYear: 2025,
        fiscalPeriod: "FY",
        end: "2025-12-31",
        form: "10-K",
        filedAt: "2026-02-01",
        facts: Object.fromEntries(
          Object.entries(facts).map(([key, value]) => [
            key,
            value == null
              ? undefined
              : {
                  value,
                  unit: "USD",
                  end: "2025-12-31",
                  fiscalYear: 2025,
                  fiscalPeriod: "FY",
                  form: "10-K",
                  sourceConcept: `test:${key}`,
                  sourceFilingUrl: null,
                },
          ]),
        ),
      },
    ],
    missingFields: [],
  };
}

describe("buildValuationMetrics", () => {
  it("calculates trailing P/E locally when the provider has no ratio", () => {
    const result = buildValuationMetrics(fundamentals(), 500);
    expect(result.trailingPE.value).toBe(50);
    expect(result.trailingPE.status).toBe("calculated");
    expect(result.trailingPE.source).toBe("local calculation");
  });

  it("preserves an extreme but valid P/E instead of hiding it", () => {
    const result = buildValuationMetrics(fundamentals({ netIncome: 0.01 }), 50_000);
    expect(result.trailingPE.value).toBe(5_000_000);
    expect(result.trailingPE.status).toBe("calculated");
  });

  it("marks loss-making companies as not meaningful rather than a fake negative multiple", () => {
    const result = buildValuationMetrics(fundamentals({ netIncome: -10 }), 500);
    expect(result.trailingPE.value).toBeNull();
    expect(result.trailingPE.status).toBe("not_meaningful");
  });

  it("marks financial-company EV multiples as not meaningful", () => {
    const result = buildValuationMetrics(fundamentals(), 500, "financial");
    expect(result.enterpriseValueToRevenue.status).toBe("not_meaningful");
    expect(result.enterpriseValueToEbitda.status).toBe("not_meaningful");
  });
});
