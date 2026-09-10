import { describe, expect, it } from "vitest";
import { feeOn, summariseIncome, type Distribution } from "./income";

/**
 * What a fund paid, derived from its own dividend dates.
 *
 * The figures are checked against a real VOO history, because the point of
 * computing these rather than taking a vendor's summary field is that the
 * result has a stated basis — and a stated basis is only worth anything if it
 * produces the same number a reader would get counting by hand.
 */

/** Vanguard S&P 500 ETF, two years of ex-dividend dates. */
const VOO: Distribution[] = [
  { date: "2024-09-27", amount: 1.639 },
  { date: "2024-12-23", amount: 1.739 },
  { date: "2025-03-27", amount: 1.812 },
  { date: "2025-06-30", amount: 1.745 },
  { date: "2025-09-29", amount: 1.74 },
  { date: "2025-12-22", amount: 1.771 },
  { date: "2026-03-27", amount: 1.872 },
  { date: "2026-06-26", amount: 1.962 },
];

const ASOF = new Date("2026-09-09T00:00:00Z");

describe("what it paid over the year", () => {
  it("sums the last twelve months and nothing older", () => {
    const s = summariseIncome(VOO, 700.87, ASOF);
    // The four payments from Sep 2025 on: 1.74 + 1.771 + 1.872 + 1.962.
    expect(s.trailingTwelveMonths).toBeCloseTo(7.345, 3);
    expect(s.paymentsCounted).toBe(4);
  });

  it("computes the yield against the price it was given", () => {
    const s = summariseIncome(VOO, 700.87, ASOF);
    expect(s.yield).toBeCloseTo(7.345 / 700.87, 6);
    // ~1.05%, which is what a reader would get dividing it themselves.
    expect(s.yield! * 100).toBeCloseTo(1.05, 2);
  });

  it("reports no yield rather than a wrong one when there is no price", () => {
    expect(summariseIncome(VOO, null, ASOF).yield).toBeNull();
    expect(summariseIncome(VOO, 0, ASOF).yield).toBeNull();
  });

  it("takes the latest ex-date from the history", () => {
    expect(summariseIncome(VOO, 700.87, ASOF).lastExDate).toBe("2026-06-26");
  });

  it("is not fooled by an unsorted history", () => {
    const shuffled = [...VOO].reverse();
    const a = summariseIncome(VOO, 700.87, ASOF);
    const b = summariseIncome(shuffled, 700.87, ASOF);
    expect(b).toEqual(a);
  });
});

describe("how often it pays", () => {
  it("reads quarterly from a quarterly history", () => {
    expect(summariseIncome(VOO, 700.87, ASOF).frequency).toBe("Quarterly");
  });

  it("reads monthly from a monthly one", () => {
    const monthly = Array.from({ length: 24 }, (_, i) => ({
      date: `${2025 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}-15`,
      amount: 0.2,
    }));
    expect(summariseIncome(monthly, 100, ASOF).frequency).toBe("Monthly");
  });

  it("reads annually from a yearly one", () => {
    const yearly = [
      { date: "2022-12-15", amount: 2 },
      { date: "2023-12-15", amount: 2 },
      { date: "2024-12-15", amount: 2 },
    ];
    expect(summariseIncome(yearly, 100, ASOF).frequency).toBe("Annually");
  });

  it("says nothing from a single payment, which proves no schedule", () => {
    const once = [{ date: "2026-06-26", amount: 1.9 }];
    const s = summariseIncome(once, 700, ASOF);
    expect(s.frequency).toBeNull();
    // It still knows what was paid and when.
    expect(s.lastExDate).toBe("2026-06-26");
    expect(s.trailingTwelveMonths).toBeCloseTo(1.9, 6);
  });

  it("still calls a quarterly fund quarterly when the window catches five", () => {
    /*
      The band exists for this. A quarterly payer can show three or five
      ex-dates in a rolling year depending on where the window falls, and
      reading "5 payments" literally would report a schedule the fund does
      not have.
    */
    const five = [...VOO, { date: "2026-09-08", amount: 1.9 }];
    expect(summariseIncome(five, 700, ASOF).frequency).toBe("Quarterly");
  });
});

describe("a fund that pays nothing", () => {
  it("distinguishes paid nothing from not known", () => {
    // No history at all: nothing is known.
    const unknown = summariseIncome([], 100, ASOF);
    expect(unknown.trailingTwelveMonths).toBeNull();
    expect(unknown.lastExDate).toBeNull();

    // A history that stopped: it paid zero over the year, which is a fact.
    const lapsed = [{ date: "2020-06-26", amount: 1.9 }];
    const s = summariseIncome(lapsed, 100, ASOF);
    expect(s.trailingTwelveMonths).toBe(0);
    expect(s.yield).toBe(0);
    expect(s.lastExDate).toBe("2020-06-26");
  });
});

describe("what a fee costs in money", () => {
  it("turns a ratio into a yearly sum on a round amount", () => {
    // 0.03% on $10,000 is $3 a year; 0.75% is $75. The same two numbers that
    // look alike as percentages.
    expect(feeOn(0.0003, 10_000)).toBeCloseTo(3, 6);
    expect(feeOn(0.0075, 10_000)).toBeCloseTo(75, 6);
    expect(feeOn(0.0018, 10_000)).toBeCloseTo(18, 6);
  });

  it("returns nothing rather than zero when the fee is unknown", () => {
    expect(feeOn(null, 10_000)).toBeNull();
    expect(feeOn(Number.NaN, 10_000)).toBeNull();
    // A negative expense ratio is not a thing; refuse rather than render it.
    expect(feeOn(-0.01, 10_000)).toBeNull();
  });

  it("keeps a genuine zero, which some funds really do charge", () => {
    expect(feeOn(0, 10_000)).toBe(0);
  });
});
