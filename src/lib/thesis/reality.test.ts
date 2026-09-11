import { describe, expect, it } from "vitest";
import { snapshotFundamentals } from "../fundamentals/as-reported";
import type { AsReportedSnapshot, CanonicalField, NormalizedFundamentals } from "../fundamentals/types";
import { buildThesisReality, evaluateCondition, metricValue } from "./reality";

/**
 * Thesis vs reality.
 *
 * The starting point is what was on file the day the thesis was written, as
 * first filed — not today's restated view of that year.
 */

type Values = Partial<Record<CanonicalField, number>>;
const identity = { cik: "1", entityName: "Test Co", taxonomy: "us-gaap" as const };

function snapshot(fiscalYear: number, asOf: string, years: Values[]): AsReportedSnapshot {
  return {
    asOf,
    fiscalYear,
    form: "10-K",
    sourceFilingUrl: null,
    periods: years.map((values, i) => ({ fiscalYear: fiscalYear - i, end: `${fiscalYear - i}-12-31`, currency: "USD", values })),
  };
}

const y2022: Values = { revenue: 1000, operatingIncome: 150, netIncome: 100 };
const y2023: Values = { revenue: 1100, operatingIncome: 220, netIncome: 150 }; // 20% margin as filed
const y2023restated: Values = { revenue: 1100, operatingIncome: 110, netIncome: 60 }; // 10% after restatement
const y2024: Values = { revenue: 1210, operatingIncome: 290.4, netIncome: 200 }; // 24% margin

const liveAnnual = snapshotFundamentals(snapshot(2024, "2025-02-01", [y2024, y2023restated, y2022]), identity).annual
  .map((period, i) => ({ ...period, filedAt: ["2025-02-01", "2025-02-01", "2023-02-01"][i] }));

const fundamentals: NormalizedFundamentals = {
  ...identity,
  missingFields: [],
  annual: liveAnnual,
  asReported: [
    snapshot(2024, "2025-02-01", [y2024, y2023restated, y2022]),
    snapshot(2023, "2024-02-01", [y2023, y2022]),
  ],
};

describe("evaluating a condition", () => {
  it("reads above-targets as below, on track or comfortably above", () => {
    const growth = { metric: "revenueGrowth" as const, operator: "above" as const, target: 8 };
    expect(evaluateCondition(growth, 6)).toBe("below");
    expect(evaluateCondition(growth, 9)).toBe("on-track");
    expect(evaluateCondition(growth, 10.2)).toBe("above");
  });

  it("reads a ceiling the other way round", () => {
    const leverage = { metric: "debtToEbitda" as const, operator: "below" as const, target: 2 };
    expect(evaluateCondition(leverage, 2.4)).toBe("below");
    expect(evaluateCondition(leverage, 1.9)).toBe("on-track");
    expect(evaluateCondition(leverage, 1.2)).toBe("above");
  });

  it("treats a sign as met or not, and missing data as missing", () => {
    const fcf = { metric: "freeCashFlow" as const, operator: "positive" as const, target: null };
    expect(evaluateCondition(fcf, 10)).toBe("on-track");
    expect(evaluateCondition(fcf, -1)).toBe("below");
    expect(evaluateCondition(fcf, null)).toBe("no-data");
  });
});

describe("thesis vs reality", () => {
  const conditions = [
    { metric: "operatingMargin" as const, operator: "above" as const, target: 20 },
    { metric: "revenueGrowth" as const, operator: "above" as const, target: 8 },
    { metric: "debtToEbitda" as const, operator: "below" as const, target: 2 },
  ];

  it("starts from the report as first filed on the day the thesis was written", () => {
    const reality = buildThesisReality(conditions, new Date("2024-06-01T12:00:00Z"), fundamentals);

    expect(reality.baseline).toEqual({ fiscalYear: 2023, asOf: "2024-02-01" });
    const margin = reality.results[0];
    expect(margin.then).toMatchObject({ fiscalYear: 2023, text: "20.0%" }); // not the restated 10%
    expect(margin.now).toMatchObject({ fiscalYear: 2024, text: "24.0%" });
    // Past the 20% target, but inside the margin that counts as comfortably past it.
    expect(margin.status).toBe("on-track");
  });

  it("flags a report filed since the thesis, and counts each outcome", () => {
    const reality = buildThesisReality(conditions, new Date("2024-06-01T12:00:00Z"), fundamentals);
    expect(reality.latest).toEqual({ fiscalYear: 2024, filedAt: "2025-02-01", newSinceThesis: true });
    expect(reality.results[1].status).toBe("above"); // 10% growth against 8%
    expect(reality.results[2].status).toBe("no-data"); // no debt reported
    expect(reality.counts).toEqual({ "on-track": 1, above: 1, below: 0, "no-data": 1 });
  });

  it("has no starting point for a thesis written before anything was filed", () => {
    const reality = buildThesisReality(conditions, new Date("2020-01-01"), fundamentals);
    expect(reality.baseline).toBeNull();
    expect(reality.results[0].then).toBeNull();
  });

  it("without snapshots, uses only years already filed by the day it was written", () => {
    const reality = buildThesisReality(conditions, new Date("2024-06-01"), { ...fundamentals, asReported: undefined });
    expect(reality.baseline?.fiscalYear).toBe(2022);
  });

  it("measures growth only against the year immediately before", () => {
    const [latest, , older] = liveAnnual;
    expect(metricValue("revenueGrowth", latest, older)).toBeNull();
  });
});
