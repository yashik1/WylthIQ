import { describe, expect, it } from "vitest";
import { describeQuoteTime } from "./quote-time";

/**
 * A price's timestamp is shown only as precisely as it was given.
 *
 * The case worth pinning is the ambiguous one: a date and time with no zone
 * would be read in the server's zone and shown as a moment that never
 * happened, so it is not shown at all.
 */

describe("a quote's timestamp", () => {
  it("shows a zoned timestamp as a moment", () => {
    expect(describeQuoteTime("2026-09-10T19:59:00Z")).toEqual({
      kind: "instant",
      iso: "2026-09-10T19:59:00.000Z",
    });
    expect(describeQuoteTime("2026-09-10T20:00:00+00:00")).toEqual({
      kind: "instant",
      iso: "2026-09-10T20:00:00.000Z",
    });
  });

  it("keeps a bare date as a date", () => {
    expect(describeQuoteTime("2026-09-10")).toEqual({ kind: "date", date: "2026-09-10" });
  });

  it("leaves out a time with no zone rather than guessing one", () => {
    expect(describeQuoteTime("2026-09-10 15:59:00")).toBeNull();
    expect(describeQuoteTime("2026-09-10T15:59:00")).toBeNull();
  });

  it("leaves out anything it cannot read", () => {
    expect(describeQuoteTime(null)).toBeNull();
    expect(describeQuoteTime("")).toBeNull();
    expect(describeQuoteTime("yesterday")).toBeNull();
  });
});
