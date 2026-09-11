import { describe, expect, it } from "vitest";
import { healthRating, RATING_WORD } from "./ratings";

describe("health ratings", () => {
  it("bands a score at the published thresholds", () => {
    expect(healthRating(7.5)).toBe("good");
    expect(healthRating(7.49)).toBe("fair");
    expect(healthRating(5)).toBe("fair");
    expect(healthRating(4.99)).toBe("poor");
  });

  it("has no rating without a score", () => {
    expect(healthRating(null)).toBe("unknown");
    expect(healthRating(undefined)).toBe("unknown");
    expect(healthRating(Number.NaN)).toBe("unknown");
  });

  it("names every rating in one word, and never the same word twice", () => {
    expect(RATING_WORD).toEqual({ good: "Strong", fair: "Mixed", poor: "Weak", unknown: "Not enough data" });
    expect(new Set(Object.values(RATING_WORD)).size).toBe(4);
  });
});
