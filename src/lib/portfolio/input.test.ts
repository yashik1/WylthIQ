import { describe, expect, it } from "vitest";
import { parseHoldingInput } from "./input";

const TODAY = new Date("2026-09-10T12:00:00Z");

describe("a holding as entered", () => {
  it("accepts a ticker, a quantity, a cost and an optional date", () => {
    expect(parseHoldingInput({ symbol: " ry.to ", quantity: "1,200", averageCost: "$98.50", purchaseDate: "2024-03-01" }, TODAY)).toEqual({
      ok: true,
      holding: { symbol: "RY.TO", quantity: 1200, averageCost: 98.5, purchaseDate: "2024-03-01" },
    });
    expect(parseHoldingInput({ symbol: "AAPL", quantity: 10, averageCost: 150, purchaseDate: "" }, TODAY)).toMatchObject({
      ok: true,
      holding: { purchaseDate: null },
    });
  });

  it("refuses what cannot be a holding", () => {
    expect(parseHoldingInput({ symbol: "AAPL; DROP", quantity: 1, averageCost: 1 }, TODAY).ok).toBe(false);
    expect(parseHoldingInput({ symbol: "AAPL", quantity: 0, averageCost: 1 }, TODAY).ok).toBe(false);
    expect(parseHoldingInput({ symbol: "AAPL", quantity: "lots", averageCost: 1 }, TODAY).ok).toBe(false);
    expect(parseHoldingInput({ symbol: "AAPL", quantity: 1, averageCost: -5 }, TODAY).ok).toBe(false);
  });

  it("refuses a purchase date in the future or in the wrong shape", () => {
    expect(parseHoldingInput({ symbol: "AAPL", quantity: 1, averageCost: 1, purchaseDate: "2026-09-11" }, TODAY).ok).toBe(false);
    expect(parseHoldingInput({ symbol: "AAPL", quantity: 1, averageCost: 1, purchaseDate: "10/09/2026" }, TODAY).ok).toBe(false);
    expect(parseHoldingInput({ symbol: "AAPL", quantity: 1, averageCost: 1, purchaseDate: "2026-09-10" }, TODAY).ok).toBe(true);
  });
});
