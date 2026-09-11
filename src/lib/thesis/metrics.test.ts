import { describe, expect, it } from "vitest";
import {
  MAX_CONDITIONS,
  cleanHorizon,
  cleanStatus,
  cleanThesisText,
  describeTarget,
  parseConditions,
} from "./metrics";

describe("thesis conditions", () => {
  it("keeps measurable conditions and coerces a typed target", () => {
    expect(
      parseConditions([
        { metric: "revenueGrowth", operator: "above", target: "8" },
        { metric: "freeCashFlow", operator: "positive" },
        { metric: "debtToEbitda", operator: "below", target: 2 },
      ]),
    ).toEqual([
      { metric: "revenueGrowth", operator: "above", target: 8 },
      { metric: "freeCashFlow", operator: "positive", target: null },
      { metric: "debtToEbitda", operator: "below", target: 2 },
    ]);
  });

  it("drops anything that cannot be measured", () => {
    expect(
      parseConditions([
        { metric: "vibes", operator: "above", target: 1 },
        { metric: "operatingMargin", operator: "positive" },
        { metric: "freeCashFlow", operator: "above", target: 5 },
        { metric: "netMargin", operator: "above", target: "lots" },
        { metric: "netMargin", operator: "above", target: 1e9 },
        null,
        "revenueGrowth",
      ]),
    ).toEqual([]);
    expect(parseConditions("not a list")).toEqual([]);
  });

  it("caps how many a thesis can hold", () => {
    const many = Array.from({ length: 20 }, () => ({ metric: "netMargin", operator: "above", target: 5 }));
    expect(parseConditions(many)).toHaveLength(MAX_CONDITIONS);
  });

  it("describes a target in the units it was entered in", () => {
    expect(describeTarget({ metric: "revenueGrowth", operator: "above", target: 8 })).toBe("above 8%");
    expect(describeTarget({ metric: "debtToEbitda", operator: "below", target: 2 })).toBe("below 2.0x");
    expect(describeTarget({ metric: "freeCashFlow", operator: "positive", target: null })).toBe("positive");
  });
});

describe("thesis fields", () => {
  it("keeps the reader's status and horizon only when they are known values", () => {
    expect(cleanStatus("at-risk")).toBe("at-risk");
    expect(cleanStatus("buy")).toBe("active");
    expect(cleanHorizon("3-5y")).toBe("3-5y");
    expect(cleanHorizon("forever")).toBeNull();
  });

  it("trims text, keeps line breaks and drops control characters", () => {
    expect(cleanThesisText("  Services keep growing.\r\nMargins hold. ")).toBe(
      "Services keep growing.\nMargins hold.",
    );
    expect(cleanThesisText(42)).toBe("");
  });
});
