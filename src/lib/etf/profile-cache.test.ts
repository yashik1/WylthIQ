import { describe, expect, it } from "vitest";
import { isFresh, parseProfile } from "./profile-cache";

/**
 * Keeping a fund's facts rather than buying them again.
 *
 * Alpha Vantage allows 25 calls a day for the whole application, and a fund's
 * fee does not change between two page views. Without somewhere to keep an
 * answer the allowance was spent before most funds' pages were opened: on
 * 2026-09-17 the live site showed an expense ratio for four of thirteen funds,
 * and for none of VOO, VTI, SPY, SCHD, BND or XLE.
 */

const profile = (over: Record<string, unknown> = {}) => ({
  expenseRatio: 0.0003,
  dividendYield: 0.0105,
  turnover: 0.02,
  inceptionDate: "2010-09-07",
  leveraged: false,
  sectors: [{ sector: "Technology", weight: 0.34 }],
  holdings: [{ symbol: "NVDA", weight: 0.07 }],
  ...over,
});

describe("how long a stored profile stands", () => {
  const now = new Date("2026-09-17T12:00:00Z");

  it("holds for a month, which is longer than a fee stays still", () => {
    expect(isFresh(new Date("2026-09-16T12:00:00Z"), now)).toBe(true);
    expect(isFresh(new Date("2026-08-25T12:00:00Z"), now)).toBe(true);
  });

  it("expires after that, so a fee cut shows up within a month", () => {
    expect(isFresh(new Date("2026-08-01T12:00:00Z"), now)).toBe(false);
  });

  /*
    A row stamped in the future is a clock disagreeing with itself, not a
    profile fetched tomorrow. Treated as stale so the provider settles it.
  */
  it("refuses a row from the future", () => {
    expect(isFresh(new Date("2026-09-18T12:00:00Z"), now)).toBe(false);
  });
});

describe("reading a row back", () => {
  it("accepts a profile that still has the shape of one", () => {
    expect(parseProfile(profile())?.expenseRatio).toBe(0.0003);
    // A fund with no fee reported is a real answer, not a broken row.
    expect(parseProfile(profile({ expenseRatio: null, turnover: null }))).not.toBeNull();
  });

  /*
    JSON from a database is data, not a type. A row written by an older
    version of this app can be missing anything, and a missing holdings array
    is a crash on a fund page rather than a blank field.
  */
  it("refuses anything it cannot trust", () => {
    expect(parseProfile(null)).toBeNull();
    expect(parseProfile("nope")).toBeNull();
    expect(parseProfile(profile({ holdings: undefined }))).toBeNull();
    expect(parseProfile(profile({ sectors: "Technology" }))).toBeNull();
    expect(parseProfile(profile({ leveraged: "no" }))).toBeNull();
    expect(parseProfile(profile({ expenseRatio: "0.03%" }))).toBeNull();
  });
});
