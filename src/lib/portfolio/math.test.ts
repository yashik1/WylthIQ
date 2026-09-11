import { describe, expect, it } from "vitest";
import { valueHoldings, type PricedHolding } from "./math";

const holding = (over: Partial<PricedHolding>): PricedHolding => ({
  symbol: "AAPL",
  name: "Apple Inc.",
  quantity: 10,
  averageCost: 100,
  purchaseDate: null,
  price: 150,
  currency: "USD",
  priceAsOf: "2026-09-10",
  priceSource: "stored",
  ...over,
});

describe("valuing holdings", () => {
  it("works out value, gain and allocation", () => {
    const { holdings, totals } = valueHoldings([
      holding({ symbol: "AAPL", quantity: 10, averageCost: 100, price: 150 }),
      holding({ symbol: "MSFT", quantity: 5, averageCost: 400, price: 300 }),
    ]);

    expect(holdings[0]).toMatchObject({ cost: 1000, value: 1500, gain: 500, gainPercent: 0.5, allocation: 0.5 });
    expect(holdings[1]).toMatchObject({ cost: 2000, value: 1500, gain: -500, gainPercent: -0.25, allocation: 0.5 });
    expect(totals).toEqual([
      { currency: "USD", cost: 3000, value: 3000, gain: 0, gainPercent: 0, priced: 2, unpriced: 0 },
    ]);
  });

  it("keeps each currency apart", () => {
    const { holdings, totals } = valueHoldings([
      holding({ symbol: "AAPL", price: 150 }),
      holding({ symbol: "RY.TO", currency: "CAD", quantity: 20, averageCost: 120, price: 180 }),
    ]);
    expect(totals.map((t) => t.currency).sort()).toEqual(["CAD", "USD"]);
    expect(holdings.every((h) => h.allocation === 1)).toBe(true);
  });

  it("lists an unpriced holding at cost with no value, and leaves it out of gains", () => {
    const { holdings, totals } = valueHoldings([
      holding({ symbol: "AAPL", price: 150 }),
      holding({ symbol: "PRIV", price: null, priceSource: null, quantity: 100, averageCost: 10 }),
    ]);
    expect(holdings[1]).toMatchObject({ value: null, gain: null, gainPercent: null, allocation: null, cost: 1000 });
    expect(totals[0]).toMatchObject({ cost: 2000, value: 1500, gain: 500, gainPercent: 0.5, priced: 1, unpriced: 1 });
  });

  it("gives no percentage gain on a zero cost", () => {
    expect(valueHoldings([holding({ averageCost: 0 })]).holdings[0].gainPercent).toBeNull();
  });
});
