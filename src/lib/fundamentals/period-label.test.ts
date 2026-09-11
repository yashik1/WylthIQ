import { describe, expect, it } from "vitest";
import { periodLabel } from "./period-label";

describe("period labels", () => {
  it("names years and numbered quarters by fiscal year", () => {
    expect(periodLabel({ fiscalYear: 2025, fiscalPeriod: "FY", end: "2025-09-27" })).toBe("FY2025");
    expect(periodLabel({ fiscalYear: 2026, fiscalPeriod: "Q3", end: "2026-06-27" })).toBe("Q3 FY2026");
  });

  it("names a quarter without a number by the date it ends", () => {
    expect(periodLabel({ fiscalYear: 2026, fiscalPeriod: "Q", end: "2026-06-27" })).toBe("Quarter to 2026-06-27");
  });

  it("reads mid-sentence without changing a year or a numbered quarter", () => {
    const opts = { inSentence: true };
    expect(periodLabel({ fiscalYear: 2026, fiscalPeriod: "Q", end: "2026-06-27" }, opts)).toBe("the quarter to 2026-06-27");
    expect(periodLabel({ fiscalYear: 2026, fiscalPeriod: "Q3", end: "2026-06-27" }, opts)).toBe("Q3 FY2026");
    expect(periodLabel({ fiscalYear: 2025, fiscalPeriod: "FY", end: "2025-09-27" }, opts)).toBe("FY2025");
  });
});
