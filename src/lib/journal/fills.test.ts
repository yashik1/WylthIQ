import { describe, expect, it } from "vitest";
import { fillInstant, fillsKey, isTimeZone, manualFills, readFills, zonedToUtc } from "./fills";

describe("when a broker's fill happened", () => {
  it("reads Interactive Brokers times as New York time, either side of the clock change", () => {
    // Winter: UTC-5. Summer: UTC-4.
    expect(fillInstant("2025-01-15T09:45:00", "ibkr-flex")).toBe("2025-01-15T14:45:00.000Z");
    expect(fillInstant("2025-07-15T09:45:00", "ibkr-flex")).toBe("2025-07-15T13:45:00.000Z");
    // The Sunday the clocks went forward, and the Monday after it.
    expect(fillInstant("2025-03-10T09:30:00", "ibkr-flex")).toBe("2025-03-10T13:30:00.000Z");
    expect(fillInstant("2025-11-03T09:30:00", "ibkr-flex")).toBe("2025-11-03T14:30:00.000Z");
  });

  it("reads SnapTrade times as the UTC instants they were", () => {
    expect(fillInstant("2025-02-10T14:35:12", "snaptrade")).toBe("2025-02-10T14:35:12.000Z");
  });

  it("treats midnight as a fill whose time was never given", () => {
    expect(fillInstant("2025-05-05T00:00:00", "snaptrade")).toBeNull();
    expect(fillInstant("2025-05-05T00:00:00", "ibkr-flex")).toBeNull();
    expect(fillInstant("2025-05-05", "ibkr-flex")).toBeNull();
  });
});

describe("a time typed into the journal", () => {
  it("is read in the reader's own zone", () => {
    expect(zonedToUtc("2025-06-02", "10:15", "America/Vancouver")).toBe("2025-06-02T17:15:00.000Z");
    expect(zonedToUtc("2025-06-02", "10:15", "Asia/Kolkata")).toBe("2025-06-02T04:45:00.000Z");
  });

  it("refuses a zone the runtime does not know", () => {
    expect(isTimeZone("America/Toronto")).toBe(true);
    expect(isTimeZone("Mars/Olympus")).toBe(false);
    expect(isTimeZone("")).toBe(false);
    expect(zonedToUtc("2025-06-02", "10:15", "Mars/Olympus")).toBeNull();
  });

  it("makes a buy and a sell for a long trade entered by hand", () => {
    const fills = manualFills({
      side: "long",
      quantity: 10,
      entryPrice: 100,
      exitPrice: 104,
      openedAt: "2025-06-02",
      closedAt: "2025-06-02",
      openedTime: "09:40",
      closedTime: "11:05",
      zone: "America/Toronto",
    });
    expect(fills).toEqual([
      { date: "2025-06-02", at: "2025-06-02T13:40:00.000Z", side: "buy", shares: 10, price: 100 },
      { date: "2025-06-02", at: "2025-06-02T15:05:00.000Z", side: "sell", shares: 10, price: 104 },
    ]);
  });

  it("opens a short with a sale, and keeps only the date without a time or a zone", () => {
    const fills = manualFills({
      side: "short",
      quantity: 5,
      entryPrice: 50,
      exitPrice: null,
      openedAt: "2025-06-02",
      closedAt: null,
      openedTime: "09:40",
      closedTime: null,
      zone: "Mars/Olympus",
    });
    expect(fills).toEqual([{ date: "2025-06-02", at: null, side: "sell", shares: 5, price: 50 }]);
  });
});

describe("stored fills", () => {
  it("reads back only well-formed fills", () => {
    expect(
      readFills([
        { date: "2025-01-02", at: "2025-01-02T15:00:00.000Z", side: "buy", shares: 1, price: 2 },
        { date: "2025-01-02", at: "not a time", side: "sell", shares: 1, price: 2 },
        { date: "yesterday", side: "buy", shares: 1, price: 2 },
        { date: "2025-01-02", side: "hold", shares: 1, price: 2 },
        { date: "2025-01-02", side: "buy", shares: -1, price: 2 },
        null,
      ]),
    ).toEqual([
      { date: "2025-01-02", at: "2025-01-02T15:00:00.000Z", side: "buy", shares: 1, price: 2 },
      { date: "2025-01-02", at: null, side: "sell", shares: 1, price: 2 },
    ]);
    expect(readFills(null)).toEqual([]);
  });

  it("keys a fill list so float noise does not count as a change", () => {
    const a = [{ date: "2025-01-02", at: null, side: "buy" as const, shares: 0.1 + 0.2, price: 10 }];
    const b = [{ date: "2025-01-02", at: null, side: "buy" as const, shares: 0.3, price: 10 }];
    expect(fillsKey(a)).toBe(fillsKey(b));
    expect(fillsKey([])).toBe("");
    expect(fillsKey(null)).toBe("");
  });
});
