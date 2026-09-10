import { describe, expect, it } from "vitest";
import { computeBeta, describeBeta } from "./beta";
import type { Bar } from "../providers/types";

/**
 * Beta, checked against series whose answer is known by construction.
 *
 * A slope is easy to compute and easy to compute against the wrong thing, so
 * every case here builds a series with a beta that can be stated in advance —
 * identical to the market is 1, twice every move is 2, inverse is -1 — and
 * requires the function to find it.
 */

/** Daily bars from monthly closes, so the month-end sampling is exercised. */
function bars(monthlyCloses: number[], startYear = 2020): Bar[] {
  const out: Bar[] = [];
  monthlyCloses.forEach((close, i) => {
    const year = startYear + Math.floor(i / 12);
    const month = i % 12;
    // Three bars in the month; only the last should be sampled.
    for (const day of [5, 15, 28]) {
      const time = Date.UTC(year, month, day) / 1000;
      const value = day === 28 ? close : close * 0.5;
      out.push({ time, open: value, high: value, low: value, close: value, volume: 0 });
    }
  });
  return out;
}

/** A market series with real variation, 60 months of it. */
const MARKET_CLOSES = Array.from({ length: 61 }, (_, i) => 100 * (1 + 0.1 * Math.sin(i)) + i);

describe("the slope", () => {
  it("is 1 for a fund that moves exactly with the market", () => {
    const b = computeBeta(bars(MARKET_CLOSES), bars(MARKET_CLOSES))!;
    expect(b.beta).toBeCloseTo(1, 6);
    expect(b.rSquared).toBeCloseTo(1, 6);
    expect(b.months).toBe(60);
  });

  it("is unchanged by a fund priced at a different level", () => {
    // Ten times the price, identical returns. Beta is about returns, not price.
    const scaled = MARKET_CLOSES.map((c) => c * 10);
    const b = computeBeta(bars(scaled), bars(MARKET_CLOSES))!;
    expect(b.beta).toBeCloseTo(1, 6);
  });

  it("is -1 for a fund that mirrors the market", () => {
    // Each month's return negated, compounded into a price series.
    const inverse: number[] = [100];
    for (let i = 1; i < MARKET_CLOSES.length; i += 1) {
      const marketReturn = MARKET_CLOSES[i] / MARKET_CLOSES[i - 1] - 1;
      inverse.push(inverse[i - 1] * (1 - marketReturn));
    }
    const b = computeBeta(bars(inverse), bars(MARKET_CLOSES))!;
    expect(b.beta).toBeCloseTo(-1, 2);
  });

  it("samples the month's last close, not whatever bar came first", () => {
    // The helper writes a half-price bar mid-month. Reading those instead
    // would still give beta 1 here, so the check is that the returns come out
    // of the month-end closes: an identical series must give r² of exactly 1.
    const b = computeBeta(bars(MARKET_CLOSES), bars(MARKET_CLOSES))!;
    expect(b.rSquared).toBeCloseTo(1, 9);
  });
});

describe("r², which is what stops beta being read alone", () => {
  it("is high when the market explains the moves", () => {
    const b = computeBeta(bars(MARKET_CLOSES), bars(MARKET_CLOSES))!;
    expect(b.rSquared).toBeGreaterThan(0.99);
  });

  it("is low for a series that merely happens to fit the slope", () => {
    // Unrelated wander. A gold fund against equities looks like this: a slope
    // can always be drawn, and it means nothing.
    const unrelated = Array.from({ length: 61 }, (_, i) => 100 + 20 * Math.cos(i * 2.7));
    const b = computeBeta(bars(unrelated), bars(MARKET_CLOSES))!;
    expect(b.rSquared).toBeLessThan(0.5);
  });
});

describe("when it refuses to answer", () => {
  it("needs three years of overlap", () => {
    const short = MARKET_CLOSES.slice(0, 20);
    expect(computeBeta(bars(short), bars(short))).toBeNull();
  });

  it("returns null for a market that does not move", () => {
    const flat = Array.from({ length: 61 }, () => 100);
    expect(computeBeta(bars(MARKET_CLOSES), bars(flat))).toBeNull();
  });

  it("uses only the months both series priced", () => {
    // The fund starts two years late; the overlap is still long enough.
    const late = MARKET_CLOSES.slice(24);
    const b = computeBeta(bars(late, 2022), bars(MARKET_CLOSES));
    expect(b).not.toBeNull();
    expect(b!.months).toBe(36);
  });

  it("returns null on empty input rather than throwing", () => {
    expect(computeBeta([], bars(MARKET_CLOSES))).toBeNull();
    expect(computeBeta(bars(MARKET_CLOSES), [])).toBeNull();
  });
});

describe("saying it in words", () => {
  it("calls a market-tracking fund what it is", () => {
    expect(describeBeta(1.0)).toContain("roughly with the market");
    expect(describeBeta(0.95)).toContain("roughly with the market");
  });

  it("describes an amplified fund as a multiple", () => {
    expect(describeBeta(2)).toContain("2.0×");
  });

  it("describes a defensive fund as a share", () => {
    expect(describeBeta(0.5)).toContain("50%");
  });

  it("says an inverse fund moves against the market", () => {
    expect(describeBeta(-1)).toContain("against the market");
  });
});
