import { describe, expect, it } from "vitest";
import { planJournalWrites, type ExistingLink } from "./journal-plan";
import { pairRoundTrips, type Fill } from "./round-trips";

let seq = 0;
function fill(quantity: number, price: number, date: string, extra: Partial<Fill> = {}): Fill {
  seq++;
  return {
    accountId: "U0000001",
    conid: "265598",
    externalId: `x${String(seq).padStart(4, "0")}`,
    symbol: "AAPL",
    quantity,
    price,
    commission: 1,
    commissionCurrency: "USD",
    currency: "USD",
    tradeDate: date,
    executedAt: `${date}T10:00:00`,
    ...extra,
  };
}

describe("pairing fills into round trips", () => {
  it("makes one trade from a buy and the sale that closes it", () => {
    const [trip, ...rest] = pairRoundTrips([fill(10, 100, "2025-01-02"), fill(-10, 110, "2025-02-03")], {});
    expect(rest).toHaveLength(0);
    expect(trip).toMatchObject({
      side: "long",
      quantity: 10,
      entryPrice: 100,
      exitPrice: 110,
      fees: 2,
      openedAt: "2025-01-02",
      closedAt: "2025-02-03",
    });
  });

  it("keeps adds and trims in the same trade, at volume-weighted prices", () => {
    const [trip] = pairRoundTrips(
      [
        fill(10, 100, "2025-01-02"),
        fill(10, 120, "2025-01-10"),
        fill(-5, 130, "2025-02-01"),
        fill(-15, 140, "2025-03-01"),
      ],
      {},
    );
    expect(trip.quantity).toBe(20);
    expect(trip.entryPrice).toBe(110);
    expect(trip.exitPrice).toBe(137.5);
    expect(trip.closedAt).toBe("2025-03-01");
  });

  it("records a short from the sale that opened it", () => {
    const [trip] = pairRoundTrips([fill(-10, 50, "2025-01-02"), fill(10, 40, "2025-01-20")], {});
    expect(trip).toMatchObject({ side: "short", entryPrice: 50, exitPrice: 40 });
  });

  it("splits a fill that crosses zero, commission and all", () => {
    const crossing = fill(-15, 110, "2025-01-05", { commission: 3 });
    const trips = pairRoundTrips([fill(10, 100, "2025-01-02"), crossing, fill(5, 105, "2025-01-09")], {});
    expect(trips).toHaveLength(2);
    expect(trips[0]).toMatchObject({ side: "long", quantity: 10, exitPrice: 110, fees: 1 + 2 });
    expect(trips[1]).toMatchObject({ side: "short", quantity: 5, entryPrice: 110, exitPrice: 105, fees: 1 + 1 });
    // The short is named after the fill that crossed zero, not the buy before it.
    expect(trips[1].openingExternalId).toBe(crossing.externalId);
  });

  it("leaves a trade open while shares are still held", () => {
    const [trip] = pairRoundTrips([fill(10, 100, "2025-01-02"), fill(-4, 110, "2025-02-01")], {
      "U0000001|265598": 6,
    });
    expect(trip).toMatchObject({ quantity: 10, exitPrice: null, closedAt: null });
  });

  it("does not mistake selling an older holding for opening a short", () => {
    // 20 shares held from before the report; 10 of them sold inside it.
    const trips = pairRoundTrips([fill(-10, 150, "2025-03-01")], { "U0000001|265598": 10 });
    expect(trips).toHaveLength(0);
  });

  it("starts recording once an older holding has been sold out", () => {
    const trips = pairRoundTrips(
      [fill(-10, 150, "2025-03-01"), fill(5, 140, "2025-04-01"), fill(-5, 160, "2025-05-01")],
      {},
    );
    // Held 10 before the record: the first sale closes that, the next pair is a new trade.
    expect(trips).toHaveLength(1);
    expect(trips[0]).toMatchObject({ quantity: 5, entryPrice: 140, exitPrice: 160 });
  });

  it("keeps instruments and accounts apart", () => {
    const trips = pairRoundTrips(
      [
        fill(10, 100, "2025-01-02"),
        fill(10, 20, "2025-01-02", { conid: "999", symbol: "XYZ" }),
        fill(10, 100, "2025-01-02", { accountId: "U0000002" }),
      ],
      { "U0000001|265598": 10, "U0000001|999": 10, "U0000002|265598": 10 },
    );
    expect(trips).toHaveLength(3);
    expect(new Set(trips.map((t) => `${t.accountId}:${t.symbol}`)).size).toBe(3);
  });

  it("names a trade by its latest ticker when the company renames mid-trade", () => {
    const [trip] = pairRoundTrips(
      [fill(10, 100, "2025-01-02", { symbol: "FB" }), fill(-10, 120, "2025-06-01", { symbol: "META" })],
      {},
    );
    expect(trip.symbol).toBe("META");
  });

  it("does not count a commission charged in another currency", () => {
    const [trip] = pairRoundTrips(
      [fill(10, 100, "2025-01-02", { commissionCurrency: "CAD" }), fill(-10, 110, "2025-02-01")],
      {},
    );
    expect(trip.fees).toBe(1);
  });

  it("gives a trade the same identity however many later fills arrive", () => {
    const first = fill(10, 100, "2025-01-02");
    const before = pairRoundTrips([first], { "U0000001|265598": 10 });
    const after = pairRoundTrips([first, fill(-10, 120, "2025-03-03")], {});
    expect(after[0].openingExternalId).toBe(before[0].openingExternalId);
  });

  it("is not thrown by fractional shares", () => {
    const [trip] = pairRoundTrips([fill(0.1, 100, "2025-01-02"), fill(0.2, 100, "2025-01-03"), fill(-0.3, 110, "2025-01-04")], {});
    expect(trip.closedAt).toBe("2025-01-04");
  });
});

describe("planning journal writes", () => {
  const closed = pairRoundTrips([fill(10, 100, "2025-01-02"), fill(-10, 110, "2025-02-03")], {});
  const key = { accountId: "U0000001", openingExternalId: closed[0].openingExternalId };

  it("adds a new round trip as a trade", () => {
    const plan = planJournalWrites(closed, [], "2024-01-01");
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0].fields).toMatchObject({ side: "long", quantity: 10, entryPrice: 100, exitPrice: 110 });
  });

  it("closes a trade it added while it was still open", () => {
    const open: ExistingLink = {
      ...key,
      tradeId: 7,
      current: { symbol: "AAPL", side: "long", quantity: 10, entryPrice: 100, exitPrice: null, fees: 1, openedAt: "2025-01-02", closedAt: null },
    };
    const plan = planJournalWrites(closed, [open], "2024-01-01");
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toEqual([{ tradeId: 7, fields: expect.objectContaining({ exitPrice: 110, closedAt: "2025-02-03" }) }]);
  });

  it("writes nothing when the trade already matches", () => {
    const plan = planJournalWrites(closed, [], "2024-01-01");
    const current = plan.inserts[0].fields;
    expect(planJournalWrites(closed, [{ ...key, tradeId: 7, current }], "2024-01-01").updates).toHaveLength(0);
  });

  it("never brings back a trade the reader deleted", () => {
    const plan = planJournalWrites(closed, [{ ...key, tradeId: null, current: null }], "2024-01-01");
    expect(plan.inserts).toHaveLength(0);
    expect(plan.updates).toHaveLength(0);
    expect(plan.keptDeleted).toBe(1);
  });

  it("adds nothing twice after a disconnect and reconnect", () => {
    // Links outlive the connection, so the same round trip finds its trade again.
    const first = planJournalWrites(closed, [], "2024-01-01");
    const again = planJournalWrites(closed, [{ ...key, tradeId: 7, current: first.inserts[0].fields }], "2024-01-01");
    expect(again.inserts).toHaveLength(0);
  });

  it("skips trades opened before the reader's chosen start", () => {
    const plan = planJournalWrites(closed, [], "2025-06-01");
    expect(plan.inserts).toHaveLength(0);
    expect(plan.beforeStart).toBe(1);
  });
});
