import { describe, expect, it } from "vitest";
import { leadingIndexes, returnsTo, topTenWeight } from "./compare-funds";
import type { Bar } from "../providers/types";

/**
 * The arithmetic behind a fund-against-fund table.
 *
 * What is worth pinning is the comparability: every window is measured to the
 * date passed in rather than to each series' own end, a window longer than a
 * fund's life is blank rather than quietly shortened, and a tie leads
 * together rather than picking one of two identical funds.
 */

const WEEK = 7 * 86_400;

/** A weekly series of `weeks` bars ending today, compounding evenly to `end`. */
function series(weeks: number, start: number, end: number, endsAt = 1_800_000_000): Bar[] {
  const step = (end / start) ** (1 / (weeks - 1));
  return Array.from({ length: weeks }, (_, i) => {
    const close = start * step ** i;
    return {
      time: endsAt - (weeks - 1 - i) * WEEK,
      open: close,
      high: close,
      low: close,
      close,
      volume: 0,
    };
  });
}

describe("returns measured to one date", () => {
  const bars = series(600, 10, 40); // ~11.5 years, four-fold

  it("answers each window it has the history for", () => {
    const windows = returnsTo(bars, 1_800_000_000);
    const byLabel = Object.fromEntries(windows.map((w) => [w.label, w]));

    expect(byLabel["1 year"].total).toBeGreaterThan(0);
    expect(byLabel["10 years"].perYear).toBeGreaterThan(0);
    expect(byLabel["Whole history"].total).toBeCloseTo(3, 1);
  });

  it("leaves a window longer than the fund blank rather than shortening it", () => {
    const young = series(200, 10, 20, 1_800_000_000); // under four years
    const byLabel = Object.fromEntries(returnsTo(young, 1_800_000_000).map((w) => [w.label, w]));

    expect(byLabel["1 year"].total).not.toBeNull();
    expect(byLabel["5 years"].total).toBeNull();
    expect(byLabel["10 years"].total).toBeNull();
    expect(byLabel["Whole history"].total).toBeCloseTo(1, 6);
  });

  it("stops at the date given, not at the end of the series", () => {
    const asOf = 1_800_000_000 - 52 * WEEK;
    const toDate = returnsTo(bars, asOf);
    const toEnd = returnsTo(bars, 1_800_000_000);

    expect(toDate.find((w) => w.label === "Whole history")!.total).toBeLessThan(
      toEnd.find((w) => w.label === "Whole history")!.total!,
    );
  });

  it("states no yearly pace for a window under a year", () => {
    const short = series(30, 10, 11, 1_800_000_000);
    expect(returnsTo(short, 1_800_000_000).find((w) => w.label === "Whole history")!.perYear).toBeNull();
  });

  it("has nothing to say about an empty series", () => {
    for (const window of returnsTo([], 1_800_000_000)) {
      expect(window.total).toBeNull();
      expect(window.perYear).toBeNull();
    }
  });
});

describe("which fund leads a row", () => {
  it("finds the lowest and the highest", () => {
    expect(leadingIndexes([0.0022, 0.0039, 0.0022], "lowest")).toEqual([0, 2]);
    expect(leadingIndexes([0.53, 0.45, 0.38], "highest")).toEqual([0]);
  });

  it("ignores funds with no figure", () => {
    expect(leadingIndexes([null, 0.004, undefined], "lowest")).toEqual([]);
    expect(leadingIndexes([null, 0.004, 0.009], "lowest")).toEqual([1]);
  });

  it("marks nobody when only one fund answers, since that is not a comparison", () => {
    expect(leadingIndexes([0.0022, null, null], "lowest")).toEqual([]);
  });
});

describe("top ten weight", () => {
  const holdings = (weights: number[]) => weights.map((weight) => ({ weight }));

  it("adds the ten largest, whatever order they arrive in", () => {
    const weights = holdings([0.02, 0.09, 0.08, 0.07, 0.06, 0.05, 0.04, 0.03, 0.1, 0.11, 0.01]);
    // The 0.01 is the eleventh position and is left out.
    expect(topTenWeight(weights)).toBeCloseTo(0.65, 6);
  });

  it("says nothing when fewer than ten positions are published", () => {
    expect(topTenWeight(holdings([0.4, 0.3, 0.3]))).toBeNull();
    expect(topTenWeight(undefined)).toBeNull();
  });

  it("refuses weights that are not fractions rather than printing 4,561%", () => {
    expect(topTenWeight(holdings(Array.from({ length: 12 }, () => 4.5)))).toBeNull();
  });
});
