import { describe, expect, it } from "vitest";
import {
  atLeast,
  bySeverity,
  CHANGE_BANDS,
  classifyChange,
  type ChangeSeverity,
} from "./change-thresholds";

/**
 * The grades every "what moved" panel shares.
 *
 * The edges are what matter: a move exactly on a line has to land on one side
 * of it every time, and the lines must stay in order, or a larger move could
 * be graded as a smaller one.
 */

describe("the bands themselves", () => {
  it("rise from notable to critical for every measure", () => {
    for (const [measure, band] of Object.entries(CHANGE_BANDS)) {
      expect(band.notable, measure).toBeLessThan(band.significant);
      expect(band.significant, measure).toBeLessThan(band.critical);
    }
  });

  it("keeps the lines What Changed has always used as the notable line", () => {
    // A 5% move in money, a one-point margin move and a 1% share change were
    // the materiality lines before grades existed. Moving them would change
    // which companies' panels say "nothing moved".
    expect(CHANGE_BANDS.amount.notable).toBe(0.05);
    expect(CHANGE_BANDS.margin.notable).toBe(0.01);
    expect(CHANGE_BANDS.shares.notable).toBe(0.01);
  });
});

describe("grading a move", () => {
  it.each([
    ["amount", 0.049, "normal"],
    ["amount", 0.05, "notable"],
    ["amount", 0.149, "notable"],
    ["amount", 0.15, "significant"],
    ["amount", 0.4, "critical"],
    ["margin", 0.0099, "normal"],
    ["margin", 0.01, "notable"],
    ["margin", 0.03, "significant"],
    ["margin", 0.08, "critical"],
    ["shares", 0.009, "normal"],
    ["shares", 0.01, "notable"],
    ["shares", 0.05, "significant"],
    ["shares", 0.1, "critical"],
  ] as const)("grades a %s move of %s as %s", (measure, magnitude, grade) => {
    expect(classifyChange(measure, magnitude)).toBe(grade);
  });

  it("grades a fall the same as a rise of the same size", () => {
    expect(classifyChange("amount", -0.2)).toBe(classifyChange("amount", 0.2));
    expect(classifyChange("margin", -0.05)).toBe("significant");
  });

  it("never grades a number it cannot read", () => {
    expect(classifyChange("amount", Number.NaN)).toBe("normal");
    expect(classifyChange("amount", Number.POSITIVE_INFINITY)).toBe("normal");
  });
});

describe("ordering", () => {
  it("puts the largest moves first and keeps equal grades in their order", () => {
    const moves: { key: string; severity: ChangeSeverity }[] = [
      { key: "a", severity: "notable" },
      { key: "b", severity: "critical" },
      { key: "c", severity: "notable" },
      { key: "d", severity: "significant" },
    ];
    expect([...moves].sort(bySeverity).map((m) => m.key)).toEqual(["b", "d", "a", "c"]);
  });

  it("raises a grade to a floor but never lowers it", () => {
    expect(atLeast("normal", "notable")).toBe("notable");
    expect(atLeast("critical", "notable")).toBe("critical");
  });
});
