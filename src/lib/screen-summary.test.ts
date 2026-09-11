import { describe, expect, it } from "vitest";
import { describeFilters } from "./screen-summary";

describe("describing a saved screen", () => {
  it("names the preset and each filter in the order the form shows them", () => {
    expect(
      describeFilters({ preset: "quality", country: "CA", minHealth: 7, minGrowth: 0.15 }),
    ).toBe("Quality · Canada only · health ≥ 7 · growth ≥ 15%");
  });

  it("counts advanced filters rather than spelling each out", () => {
    expect(describeFilters({ maxPb: 3, safeZoneOnly: true })).toBe("2 advanced filters");
    expect(describeFilters({ minRoa: 0.1 })).toBe("1 advanced filter");
  });

  it("does not count a switched-off flag", () => {
    expect(describeFilters({ safeZoneOnly: false as never })).toBe("All companies");
  });

  it("says so when nothing narrows the screen", () => {
    expect(describeFilters({ sort: "health" })).toBe("All companies");
  });
});
