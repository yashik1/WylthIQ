import { describe, expect, it } from "vitest";
import { scaleBars } from "./price-chart";
import type { Bar } from "@/lib/providers/types";

/**
 * Drawing a price series in the currency the page is being read in.
 *
 * The header price is restated when a reader picks a currency. A chart
 * underneath it still drawn in dollars would put two different prices for the
 * same share on one screen, a few centimetres apart.
 */

const bar = (close: number): Bar => ({
  time: 1_758_000_000,
  open: close - 2,
  high: close + 1,
  low: close - 3,
  close,
  volume: 1_200_000,
});

describe("a price series in another currency", () => {
  it("moves every price in the bar", () => {
    const [out] = scaleBars([bar(100)], 1.4);

    expect(out.open).toBeCloseTo(137.2, 6);
    expect(out.high).toBeCloseTo(141.4, 6);
    expect(out.low).toBeCloseTo(135.8, 6);
    expect(out.close).toBeCloseTo(140, 6);
  });

  // Volume is a count of shares. No exchange rate touches it, and scaling it
  // would put a fictional number under the chart.
  it("leaves the volume as a count of shares", () => {
    expect(scaleBars([bar(100)], 1.4)[0].volume).toBe(1_200_000);
  });

  it("hands back the same bars when there is nothing to do", () => {
    const bars = [bar(100)];
    expect(scaleBars(bars, 1)).toBe(bars);
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(scaleBars(bars, bad)).toBe(bars);
    }
  });
});
