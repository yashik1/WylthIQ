import { describe, expect, it } from "vitest";
import { __testing } from "./ingest";

const { quoteWrite } = __testing;

/**
 * Deciding whether a quote may be saved, and with what date.
 *
 * The live dashboard displayed every price as of August 14 under a heading
 * dated September 12: each nightly refresh fell back to the same old closes
 * and saved them with the time the refresh ran. What is pinned here is that a
 * price keeps its own date, that an old price never overwrites a newer one,
 * and that rows stamped wrongly before the fix get their real date back.
 */

const now = new Date("2026-09-15T23:40:00Z");

describe("saving a quote", () => {
  it("saves a current price with the date it is from, not the time of the run", () => {
    const result = quoteWrite(
      { price: 44.2, asOf: "2026-09-15T20:00:00Z", freshness: "delayed-15min" },
      { price: 46.82, priceUpdatedAt: new Date("2026-09-12T23:12:00Z") },
      now,
    );
    expect(result.outcome).toBe("fresh");
    expect(result.at.toISOString()).toBe("2026-09-15T20:00:00.000Z");
  });

  it("gives a wrongly stamped row its real date back when the same old price returns", () => {
    // The August close, saved on September 12 as though it were that day's.
    const result = quoteWrite(
      { price: 46.82, asOf: "2026-08-14T20:00:00Z", freshness: "stale" },
      { price: 46.82, priceUpdatedAt: new Date("2026-09-12T23:12:00Z") },
      now,
    );
    expect(result.outcome).toBe("stale-recorded");
    expect(result.at.toISOString()).toBe("2026-08-14T20:00:00.000Z");
  });

  it("saves an old price over an even older one", () => {
    const result = quoteWrite(
      { price: 50, asOf: "2026-08-14T20:00:00Z", freshness: "stale" },
      { price: 48, priceUpdatedAt: new Date("2026-07-01T20:00:00Z") },
      now,
    );
    expect(result.outcome).toBe("stale-recorded");
  });

  it("never lets an old price replace a newer, different one", () => {
    const result = quoteWrite(
      { price: 46.82, asOf: "2026-08-14T20:00:00Z", freshness: "stale" },
      { price: 44.2, priceUpdatedAt: new Date("2026-09-14T20:00:00Z") },
      now,
    );
    expect(result.outcome).toBe("stale-skipped");
  });

  it("saves an old price where nothing is stored yet, dated as it is", () => {
    const result = quoteWrite(
      { price: 12, asOf: "2026-08-14", freshness: "stale" },
      undefined,
      now,
    );
    expect(result.outcome).toBe("stale-recorded");
    expect(result.at.toISOString()).toBe("2026-08-14T20:00:00.000Z");
  });
});
