import { describe, expect, it } from "vitest";
import {
  chartHoldings,
  gainStep,
  HAND_ENTERED,
  mapCompanies,
  MAX_SLICES,
  slices,
  squarify,
  UNCLASSIFIED,
  usefulSlicings,
  type PortfolioChart,
} from "./charts";
import type { ValuedHolding } from "./math";

function holding(overrides: Partial<ValuedHolding>): ValuedHolding {
  return {
    key: overrides.symbol ?? "X",
    source: "manual",
    sourceLabel: null,
    reportedAt: null,
    symbol: "X",
    name: null,
    quantity: 1,
    averageCost: 100,
    purchaseDate: null,
    price: 100,
    currency: "USD",
    priceAsOf: null,
    priceSource: "stored",
    cost: 100,
    value: 100,
    gain: 0,
    gainPercent: 0,
    allocation: null,
    ...overrides,
  };
}

const chart = (values: [string, number][], extra: Partial<PortfolioChart> = {}): PortfolioChart => ({
  currency: "USD",
  converted: false,
  leftOut: 0,
  holdings: values.map(([symbol, value]) => ({
    symbol,
    name: `${symbol} Inc.`,
    sector: null,
    broker: HAND_ENTERED,
    accountType: "Type not set",
    currency: "USD",
    value,
    cost: value,
  })),
  ...extra,
});

describe("putting every holding in one currency", () => {
  it("charts a one-currency portfolio in that currency, unconverted", () => {
    const result = chartHoldings(
      [holding({ symbol: "SHOP.TO", currency: "CAD", value: 500, cost: 400 })],
      new Map([["CAD", 0.73]]),
      {},
      "USD",
    );
    expect(result).toMatchObject({ currency: "CAD", converted: false, leftOut: 0 });
    expect(result.holdings[0]).toMatchObject({ value: 500, cost: 400 });
  });

  it("converts a mixed portfolio into the base currency, and says so", () => {
    const result = chartHoldings(
      [holding({ symbol: "AAPL", value: 1000 }), holding({ symbol: "SHOP.TO", currency: "CAD", value: 1000, cost: 800 })],
      new Map<string, number | null>([["USD", 1], ["CAD", 0.75]]),
      {},
      "USD",
    );
    expect(result.currency).toBe("USD");
    expect(result.converted).toBe(true);
    expect(result.holdings.find((h) => h.symbol === "SHOP.TO")).toMatchObject({ value: 750, cost: 600, currency: "CAD" });
  });

  it("leaves out, and counts, what has no price or no exchange rate", () => {
    const result = chartHoldings(
      [
        holding({ symbol: "AAPL", value: 1000 }),
        holding({ symbol: "NOPRICE", value: null, gain: null }),
        holding({ symbol: "BMW.DE", currency: "EUR", value: 900 }),
      ],
      new Map<string, number | null>([["USD", 1], ["EUR", null]]),
      {},
      "USD",
    );
    expect(result.holdings.map((h) => h.symbol)).toEqual(["AAPL"]);
    expect(result.leftOut).toBe(2);
  });

  it("names where each holding came from, its kind of account, and its sector", () => {
    const result = chartHoldings(
      [
        holding({ symbol: "AAPL", accountType: "TFSA" }),
        holding({ symbol: "MSFT", key: "s1", source: "synced", sourceLabel: "Interactive Brokers" }),
      ],
      new Map([["USD", 1]]),
      { AAPL: "Technology" },
      "USD",
    );
    expect(result.holdings.map((h) => [h.broker, h.accountType, h.sector])).toEqual([
      [HAND_ENTERED, "TFSA", "Technology"],
      ["Interactive Brokers", "Type not set", null],
    ]);
  });
});

describe("the allocation ring", () => {
  it("draws every group when there are six or fewer, largest first", () => {
    const result = slices(chart([["B", 200], ["A", 500], ["C", 300]]), "company");
    expect(result.map((s) => s.label)).toEqual(["A", "C", "B"]);
    expect(result.map((s) => s.share)).toEqual([0.5, 0.3, 0.2]);
    expect(result[0].detail).toBe("A Inc.");
    expect(result.some((s) => s.other)).toBe(false);
  });

  it("folds everything past the five largest into Other, never a seventh colour", () => {
    const values: [string, number][] = [["A", 90], ["B", 80], ["C", 70], ["D", 60], ["E", 50], ["F", 40], ["G", 30], ["H", 20]];
    const result = slices(chart(values), "company");
    expect(result).toHaveLength(MAX_SLICES);
    expect(result.map((s) => s.label)).toEqual(["A", "B", "C", "D", "E", "Other"]);
    expect(result[5]).toMatchObject({ other: true, value: 90, detail: "3 more companies" });
    expect(result.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1);
  });

  it("adds a company held in two rows together", () => {
    const result = slices(chart([["AAPL", 100], ["AAPL", 50], ["MSFT", 50]]), "company");
    expect(result.map((s) => [s.label, s.value])).toEqual([["AAPL", 150], ["MSFT", 50]]);
  });

  it("groups by sector, with the unscored under their own name", () => {
    const base = chart([["AAPL", 100], ["MSFT", 100], ["VFV.TO", 50]]);
    base.holdings[0].sector = "Technology";
    base.holdings[1].sector = "Technology";
    expect(slices(base, "sector").map((s) => [s.label, s.value])).toEqual([["Technology", 200], [UNCLASSIFIED, 50]]);
  });

  it("offers only the slicings that split the portfolio", () => {
    const base = chart([["AAPL", 100], ["MSFT", 100]]);
    expect(usefulSlicings(base)).toEqual(["company"]);
    base.holdings[1].broker = "Interactive Brokers";
    base.holdings[1].currency = "CAD";
    expect(usefulSlicings(base)).toEqual(["company", "broker", "currency"]);
    base.holdings[0].accountType = "TFSA";
    expect(usefulSlicings(base)).toEqual(["company", "account", "broker", "currency"]);
  });

  it("groups by kind of account, one ETF in two accounts counted in each", () => {
    const base = chart([["XEQT.TO", 300], ["XEQT.TO", 200], ["AAPL", 100]]);
    base.holdings[0].accountType = "TFSA";
    base.holdings[1].accountType = "RRSP";
    expect(slices(base, "account").map((s) => [s.label, s.value])).toEqual([
      ["TFSA", 300],
      ["RRSP", 200],
      ["Type not set", 100],
    ]);
  });
});

describe("the map", () => {
  it("has one tile per company, with its gain against what was paid", () => {
    const base = chart([["AAPL", 150], ["AAPL", 50], ["MSFT", 100]]);
    base.holdings[0].cost = 100;
    base.holdings[1].cost = 60;
    const tiles = mapCompanies(base);
    expect(tiles.map((t) => t.symbol)).toEqual(["AAPL", "MSFT"]);
    expect(tiles[0].gainPercent).toBeCloseTo(0.25);
    expect(tiles[0].share).toBeCloseTo(2 / 3);
  });

  it("shades gains and losses by size, with small moves flat", () => {
    for (const flat of [null, 0, 0.019, -0.019]) expect(Object.is(gainStep(flat), 0)).toBe(true);
    expect([0.02, 0.099, 0.1, 0.25, 3].map(gainStep)).toEqual([1, 1, 2, 3, 3]);
    expect([-0.05, -0.12, -0.6].map(gainStep)).toEqual([-1, -2, -3]);
  });

  describe("laying out the tiles", () => {
    const area = (r: { w: number; h: number }) => r.w * r.h;

    it("gives each value an area in proportion, filling the space exactly", () => {
      const values = [50, 25, 12, 8, 5];
      const rects = squarify(values, 400, 200);
      const total = values.reduce((a, b) => a + b, 0);
      rects.forEach((r, i) => expect(area(r)).toBeCloseTo((values[i] / total) * 400 * 200, 6));
      expect(rects.reduce((sum, r) => sum + area(r), 0)).toBeCloseTo(400 * 200, 6);
    });

    it("keeps every tile inside the space, with no two overlapping", () => {
      const values = [30, 22, 18, 11, 9, 6, 3, 1];
      const rects = squarify(values, 640, 360);
      for (const r of rects) {
        expect(r.x).toBeGreaterThanOrEqual(-1e-9);
        expect(r.y).toBeGreaterThanOrEqual(-1e-9);
        expect(r.x + r.w).toBeLessThanOrEqual(640 + 1e-9);
        expect(r.y + r.h).toBeLessThanOrEqual(360 + 1e-9);
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i];
          const b = rects[j];
          const overlapW = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
          const overlapH = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
          expect(overlapW <= 1e-9 || overlapH <= 1e-9).toBe(true);
        }
      }
    });

    it("keeps tiles near square, so sizes can be compared by eye", () => {
      const rects = squarify([1, 1, 1, 1], 200, 200);
      for (const r of rects) expect(r.w / r.h).toBeCloseTo(1);
    });

    it("draws nothing for an empty or zero portfolio", () => {
      expect(squarify([], 100, 100)).toEqual([]);
      expect(squarify([0, 0], 100, 100)).toEqual([
        { x: 0, y: 0, w: 0, h: 0 },
        { x: 0, y: 0, w: 0, h: 0 },
      ]);
    });
  });
});
