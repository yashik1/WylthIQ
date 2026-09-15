import { describe, expect, it } from "vitest";
import { isPriceStale, priceTime, weekdaysSince } from "./quote-session";

/**
 * Dating a stored price.
 *
 * The bug this exists for: a refresh saved a month-old close with the time
 * the refresh ran, and the dashboard presented August's prices as September's.
 * What is pinned is that a price carries its own date, and that "stale" is
 * counted in trading days so a weekend is not mistaken for a breakdown.
 */

describe("the moment a price is from", () => {
  const now = new Date("2026-09-15T23:30:00Z");

  it("keeps a full timestamp as given", () => {
    expect(priceTime("2026-08-14T20:00:00Z", now).toISOString()).toBe("2026-08-14T20:00:00.000Z");
  });

  it("reads a bare date as that day's US close, not the evening before", () => {
    expect(priceTime("2026-09-11", now).toISOString()).toBe("2026-09-11T20:00:00.000Z");
  });

  it("uses now only when the quote gives no usable date", () => {
    expect(priceTime(null, now)).toBe(now);
    expect(priceTime("not a date", now)).toBe(now);
  });

  it("never dates a price in the future", () => {
    expect(priceTime("2026-09-16T20:00:00Z", now)).toEqual(now);
  });
});

describe("trading days behind", () => {
  // Friday 11 September 2026, 4pm in New York.
  const fridayClose = new Date("2026-09-11T20:00:00Z");

  it("counts a weekend as one trading day, not three", () => {
    expect(weekdaysSince(fridayClose, new Date("2026-09-14T14:00:00Z"))).toBe(1);
  });

  it("counts on the New York calendar, not UTC's", () => {
    // 00:30 UTC on Saturday is still Friday evening in New York.
    expect(weekdaysSince(new Date("2026-09-12T00:30:00Z"), new Date("2026-09-14T14:00:00Z"))).toBe(1);
  });

  it("is zero on the same trading day", () => {
    expect(weekdaysSince(fridayClose, new Date("2026-09-11T23:00:00Z"))).toBe(0);
  });
});

describe("whether a price is still current", () => {
  const fridayClose = new Date("2026-09-11T20:00:00Z");

  it("is current through Tuesday for a Friday close", () => {
    expect(isPriceStale(fridayClose, new Date("2026-09-14T15:00:00Z"))).toBe(false);
    expect(isPriceStale(fridayClose, new Date("2026-09-15T23:00:00Z"))).toBe(false);
  });

  it("is stale once a third trading day has begun", () => {
    expect(isPriceStale(fridayClose, new Date("2026-09-16T14:00:00Z"))).toBe(true);
  });

  it("calls August's closes stale in September, whatever time a refresh saved them at", () => {
    expect(isPriceStale("2026-08-14T20:00:00Z", new Date("2026-09-15T15:00:00Z"))).toBe(true);
  });

  it("does not guess about a price with no date", () => {
    expect(isPriceStale(null)).toBe(false);
    expect(isPriceStale("garbage")).toBe(false);
  });
});
