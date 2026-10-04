import { describe, expect, it } from "vitest";
import { brokerSummaries } from "./brokers";
import { HAND_ENTERED } from "./charts";
import type { ValuedHolding } from "./math";

function holding(overrides: Partial<ValuedHolding>): ValuedHolding {
  return {
    key: `${overrides.source ?? "manual"}:${overrides.sourceLabel ?? ""}:${overrides.symbol ?? "X"}`,
    source: "manual",
    sourceLabel: null,
    connection: null,
    reportedAt: null,
    symbol: "X",
    name: null,
    quantity: 10,
    averageCost: 10,
    purchaseDate: null,
    price: 10,
    currency: "USD",
    priceAsOf: null,
    priceSource: "stored",
    cost: 100,
    value: 100,
    gain: 0,
    gainPercent: 0,
    allocation: null,
    ...overrides,
  };
}

const ibkr = (symbol: string, value: number | null, extra: Partial<ValuedHolding> = {}) =>
  holding({ symbol, value, cost: 100, source: "synced", sourceLabel: "Interactive Brokers", connection: "ibkr-flex", ...extra });
const usd = (currency: string) => (currency === "USD" ? 1 : currency === "CAD" ? 0.75 : null);

describe("the portfolio by broker", () => {
  it("puts each holding under its broker, with what each broker holds in total", () => {
    const summaries = brokerSummaries(
      [
        ibkr("AAPL", 600, { reportedAt: "2026-09-29" }),
        ibkr("MSFT", 200, { reportedAt: "2026-09-30" }),
        holding({ symbol: "KO", value: 200, cost: 150, source: "synced", sourceLabel: "Wealthsimple", connection: "snaptrade" }),
        holding({ symbol: "F", value: 100, cost: 120 }),
      ],
      usd,
    );
    expect(summaries.map((s) => [s.name, s.value, s.holdings.map((h) => h.symbol)])).toEqual([
      ["Interactive Brokers", 800, ["AAPL", "MSFT"]],
      ["Wealthsimple", 200, ["KO"]],
      [HAND_ENTERED, 100, ["F"]],
    ]);
    const [ib] = summaries;
    expect(ib.share).toBeCloseTo(800 / 1100);
    expect(ib.gain).toBe(600);
    expect(ib.gainPercent).toBeCloseTo(3);
    expect(ib.holdings[0].share).toBeCloseTo(0.75);
    expect(ib.reportedAt).toBe("2026-09-30");
    expect(summaries.at(-1)!.synced).toBe(false);
  });

  it("adds holdings in other currencies at the given rate", () => {
    const [ib] = brokerSummaries(
      [ibkr("AAPL", 100), ibkr("SHOP.TO", 400, { currency: "CAD", cost: 400 })],
      usd,
    );
    expect(ib.value).toBe(400);
    expect(ib.holdings.map((h) => [h.symbol, h.value])).toEqual([
      ["SHOP.TO", 300],
      ["AAPL", 100],
    ]);
  });

  it("still lists a holding with no price or rate, without counting it", () => {
    const [ib] = brokerSummaries([ibkr("AAPL", 100), ibkr("NOPRICE", null), ibkr("BMW.DE", 50, { currency: "EUR" })], usd);
    expect(ib.holdings.map((h) => [h.symbol, h.value])).toEqual([
      ["AAPL", 100],
      ["BMW.DE", null],
      ["NOPRICE", null],
    ]);
    expect(ib.value).toBe(100);
    expect(ib.uncounted).toBe(2);
  });

  it("warns when one broker is connected two ways, since its shares are then counted twice", () => {
    const [ib] = brokerSummaries([ibkr("AAPL", 100), ibkr("AAPL", 100, { connection: "snaptrade", key: "other" })], usd);
    expect(ib.connectedTwice).toEqual(["a Flex token", "SnapTrade"]);
    const [single] = brokerSummaries([ibkr("AAPL", 100), ibkr("MSFT", 100)], usd);
    expect(single.connectedTwice).toEqual([]);
  });
});
