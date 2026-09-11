import { describe, expect, it } from "vitest";
import { cleanScreenName, copyName, MAX_SCREEN_NAME } from "./saved-screen-names";

describe("saved screen names", () => {
  it("trims, collapses spacing and drops control characters", () => {
    expect(cleanScreenName("  Canadian   Quality ")).toBe("Canadian Quality");
    expect(cleanScreenName("High\tGrowth\n")).toBe("High Growth");
  });

  it("refuses a name with nothing in it", () => {
    expect(cleanScreenName("   ")).toBeNull();
    expect(cleanScreenName(42)).toBeNull();
    expect(cleanScreenName(null)).toBeNull();
  });

  it("holds a name to the length limit", () => {
    expect(cleanScreenName("x".repeat(200))!.length).toBe(MAX_SCREEN_NAME);
  });
});

describe("naming a copy", () => {
  it("adds (copy), then counts up past names already taken", () => {
    expect(copyName("High Growth", ["High Growth"])).toBe("High Growth (copy)");
    expect(copyName("High Growth", ["High Growth", "High Growth (copy)"])).toBe("High Growth (copy 2)");
  });

  it("treats names that differ only in capitals as taken", () => {
    expect(copyName("High Growth", ["high growth (COPY)"])).toBe("High Growth (copy 2)");
  });

  it("keeps the suffix when the original is already at the length limit", () => {
    const long = "y".repeat(MAX_SCREEN_NAME);
    const copy = copyName(long, [long]);
    expect(copy.length).toBeLessThanOrEqual(MAX_SCREEN_NAME);
    expect(copy.endsWith(" (copy)")).toBe(true);
  });
});
