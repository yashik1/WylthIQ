import { describe, expect, it } from "vitest";
import { weightedPe, type HoldingWeight } from "./portfolio-pe";

/**
 * The one thing this file exists to get right is the weighting.
 *
 * A portfolio's P/E is total price over total earnings, which in weight terms
 * is a harmonic mean. The arithmetic mean is the version everyone writes first
 * and it is wrong in a direction that flatters nothing — it lets an expensive
 * holding pull the whole fund up far past its share of the earnings. The first
 * test below is the counter-example, with the numbers worked by hand.
 */

const pes = (entries: [string, number | null][]) => new Map<string, number | null>(entries);

describe("the weighting", () => {
  it("is harmonic, not arithmetic", () => {
    /*
      Half the fund on a P/E of 10, half on 50. Worked by hand:

        arithmetic:  0.5×10 + 0.5×50                  = 30
        harmonic:    1 / (0.5/10 + 0.5/50)            = 16.67

      16.67 is the true one: put £100 in, £50 buys £5 of earnings and £50 buys
      £1, so £100 bought £6 — a multiple of 16.7. The arithmetic answer nearly
      doubles it.
    */
    const holdings: HoldingWeight[] = [
      { symbol: "CHEAP", weight: 0.5 },
      { symbol: "DEAR", weight: 0.5 },
    ];
    const v = weightedPe(holdings, pes([["CHEAP", 10], ["DEAR", 50]]))!;

    expect(v.peRatio).toBeCloseTo(16.667, 3);
    expect(v.peRatio).not.toBeCloseTo(30, 0);
  });

  it("agrees with the simple answer when every holding is the same", () => {
    const holdings = [
      { symbol: "A", weight: 0.4 },
      { symbol: "B", weight: 0.6 },
    ];
    const v = weightedPe(holdings, pes([["A", 20], ["B", 20]]))!;
    expect(v.peRatio).toBeCloseTo(20, 6);
  });

  it("scales the weights, so a partial portfolio is still priced correctly", () => {
    // Only 20% of the fund is priced, but those two are equal halves of it, so
    // the ratio is theirs — coverage is what says it is only a fifth.
    const holdings = [
      { symbol: "A", weight: 0.1 },
      { symbol: "B", weight: 0.1 },
    ];
    const v = weightedPe(holdings, pes([["A", 10], ["B", 30]]))!;
    expect(v.peRatio).toBeCloseTo(15, 6);
    expect(v.coverage).toBeCloseTo(0.2, 6);
  });
});

describe("what it refuses to price", () => {
  it("leaves out loss-makers rather than subtracting them", () => {
    /*
      A negative P/E is not a cheap one. Included, it would subtract from the
      earnings total and push the fund's multiple up — so a fund holding a
      loss-maker would look more expensive because of it, which is backwards.
    */
    const holdings = [
      { symbol: "PROFIT", weight: 0.5 },
      { symbol: "LOSS", weight: 0.5 },
    ];
    const v = weightedPe(holdings, pes([["PROFIT", 20], ["LOSS", -12]]))!;

    expect(v.peRatio).toBeCloseTo(20, 6);
    expect(v.priced).toBe(1);
    expect(v.coverage).toBeCloseTo(0.5, 6);
    // Reported, so the missing half is visibly a decision rather than a gap.
    expect(v.excludedWeight).toBeCloseTo(0.5, 6);
  });

  it("leaves out a company earning almost nothing", () => {
    const holdings = [
      { symbol: "NORMAL", weight: 0.9 },
      { symbol: "BARELY", weight: 0.1 },
    ];
    const v = weightedPe(holdings, pes([["NORMAL", 18], ["BARELY", 4000]]))!;
    expect(v.priced).toBe(1);
    expect(v.excludedWeight).toBeCloseTo(0.1, 6);
    expect(v.peRatio).toBeCloseTo(18, 6);
  });

  it("counts an unknown holding as uncovered, not as excluded", () => {
    // Not in the scored universe at all. That is missing coverage, which is a
    // different thing from a holding deliberately left out.
    const holdings = [
      { symbol: "KNOWN", weight: 0.6 },
      { symbol: "FOREIGN", weight: 0.4 },
    ];
    const v = weightedPe(holdings, pes([["KNOWN", 25]]))!;

    expect(v.coverage).toBeCloseTo(0.6, 6);
    expect(v.excludedWeight).toBe(0);
  });

  it("matches symbols case-insensitively", () => {
    const v = weightedPe([{ symbol: "aapl", weight: 1 }], pes([["AAPL", 30]]))!;
    expect(v.peRatio).toBeCloseTo(30, 6);
  });

  it("ignores a holding with no weight", () => {
    const holdings = [
      { symbol: "A", weight: 1 },
      { symbol: "B", weight: 0 },
      { symbol: "C", weight: Number.NaN },
    ];
    const v = weightedPe(holdings, pes([["A", 12], ["B", 5], ["C", 5]]))!;
    expect(v.priced).toBe(1);
    expect(v.peRatio).toBeCloseTo(12, 6);
  });
});

describe("when it cannot answer", () => {
  it("returns null rather than a ratio built from nothing", () => {
    expect(weightedPe([], pes([["A", 10]]))).toBeNull();
    expect(weightedPe([{ symbol: "A", weight: 1 }], pes([]))).toBeNull();
    // Every holding a loss-maker: nothing left to divide by.
    expect(weightedPe([{ symbol: "A", weight: 1 }], pes([["A", -5]]))).toBeNull();
    // Known, but with no ratio computed for it.
    expect(weightedPe([{ symbol: "A", weight: 1 }], pes([["A", null]]))).toBeNull();
  });
});
