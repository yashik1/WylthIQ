import { describe, expect, it } from "vitest";
import { restate } from "./fx";

/**
 * Money from two different places, compared.
 *
 * Every ratio on a company page divides one money amount by another, and the
 * two do not always arrive in the same currency. SK hynix's market value came
 * from Seoul in won while its profit had been converted to dollars, and the
 * page reported a P/E of 39,478 for a company trading at 29 times earnings.
 * Royal Bank is the same fault at a quieter scale: 19 times rather than 27,
 * the gap being the Canadian dollar.
 */

describe("restating an amount", () => {
  it("converts at the rate when the currencies differ", () => {
    expect(restate(1_234_000_000_000_000, "KRW", "USD", 0.00073)).toBeCloseTo(900.82e9, -6);
    expect(restate(100, "CAD", "USD", 0.7174)).toBeCloseTo(71.74, 6);
  });

  it("leaves an amount alone when it is already in the target currency", () => {
    expect(restate(100, "USD", "USD", null)).toBe(100);
    // The rate is never consulted, so a missing one cannot matter.
    expect(restate(100, "usd", "USD", null)).toBe(100);
  });

  /*
    An unknown currency is left as it is rather than guessed at. Most figures
    reaching this function are dollars from a US listing against a US filing,
    and refusing them all because one provider omitted a label would empty the
    screener to fix a handful of foreign filers.
  */
  it("passes an amount through when either currency is unknown", () => {
    expect(restate(100, null, "USD", null)).toBe(100);
    expect(restate(100, "CAD", null, null)).toBe(100);
  });

  /*
    The case this exists for. Without a rate the honest answer is no figure:
    a P/E of 19 where the truth is 27 is read as a cheap bank, while a blank
    cell is read as a blank cell.
  */
  it("refuses to mix two currencies without a rate", () => {
    expect(restate(100, "CAD", "USD", null)).toBeNull();
    for (const bad of [0, -1, NaN, Infinity]) {
      expect(restate(100, "CAD", "USD", bad)).toBeNull();
    }
  });

  it("has nothing to say about a missing amount", () => {
    expect(restate(null, "CAD", "USD", 0.72)).toBeNull();
    expect(restate(undefined, "CAD", "USD", 0.72)).toBeNull();
    expect(restate(NaN, "CAD", "USD", 0.72)).toBeNull();
  });
});
