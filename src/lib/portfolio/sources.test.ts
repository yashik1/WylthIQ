import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AccountType } from "./account-types";
import { toPortfolioInputs } from "./sources";

const quotes = vi.hoisted(() => ({
  bySymbol: new Map<string, { price: number; currency: string; asOf: string }>(),
  asked: [] as string[],
}));

// No database: every price comes from the live lookup below.
vi.mock("../db", () => ({ getDb: vi.fn(), isDatabaseConfigured: vi.fn(() => false) }));
vi.mock("../providers", () => ({
  getProvider: () => ({
    getQuote: async (symbol: string) => {
      quotes.asked.push(symbol);
      return quotes.bySymbol.get(symbol) ?? null;
    },
  }),
}));
vi.mock("../fx", () => ({ getRate: async (from: string) => (from === "CAD" ? 0.75 : null) }));

const { loadPortfolio } = await import("./load");

let nextId = 1;
const manual = (symbol: string, quantity: number, averageCost: number, accountType: AccountType | null = null) => ({
  id: nextId++,
  symbol,
  quantity,
  averageCost,
  purchaseDate: null,
  accountType,
});
const synced = (symbol: string, quantity: number, averageCost: number, currency = "USD") => ({
  source: "snaptrade",
  label: "Interactive Brokers",
  accountId: "acc-1",
  account: "Individual ···0001",
  accountType: null as AccountType | null,
  symbol,
  quantity,
  averageCost,
  currency,
  reportDate: "2025-09-30",
});

describe("holdings from more than one source", () => {
  it("keeps a hand-entered and a synced holding of the same company as two rows", () => {
    const typed = manual("AAPL", 5, 150);
    const { inputs, overlaps } = toPortfolioInputs([typed], [synced("AAPL", 15, 180)]);
    expect(inputs.map((i) => i.key)).toEqual([`manual:${typed.id}`, "synced:snaptrade:acc-1:AAPL:USD"]);
    expect(inputs.map((i) => i.holdingId)).toEqual([typed.id, null]);
    expect(overlaps).toEqual([{ symbol: "AAPL", from: ["entered by hand", "Interactive Brokers"] }]);
  });

  it("keeps one company held in two accounts at the broker as two holdings, each with its kind", () => {
    const { inputs, overlaps } = toPortfolioInputs(
      [],
      [
        { ...synced("XEQT.TO", 10, 30, "CAD"), accountType: "TFSA" },
        { ...synced("XEQT.TO", 30, 32, "CAD"), accountId: "acc-2", account: "RRSP ···0002", accountType: "RRSP" },
      ],
    );
    expect(inputs.map((i) => [i.accountType, i.account, i.quantity])).toEqual([
      ["RRSP", "RRSP ···0002", 30],
      ["TFSA", "Individual ···0001", 10],
    ]);
    expect(overlaps).toEqual([]);
  });

  it("combines one company listed twice within the same account", () => {
    const { inputs } = toPortfolioInputs(
      [],
      [synced("RY.TO", 10, 100, "CAD"), { ...synced("RY.TO", 30, 140, "CAD"), reportDate: "2025-10-01" }],
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ quantity: 40, averageCost: 130, currency: "CAD", reportedAt: "2025-10-01" });
  });

  it("never adds together two connections to the same broker, and flags them", () => {
    const { inputs, overlaps } = toPortfolioInputs(
      [],
      [synced("AAPL", 15, 180), { ...synced("AAPL", 15, 180), source: "ibkr-flex", accountId: "U0000001" }],
    );
    expect(inputs).toHaveLength(2);
    expect(overlaps).toEqual([{ symbol: "AAPL", from: ["Interactive Brokers", "Interactive Brokers"] }]);
  });

  it("does not flag one company held at two different brokers", () => {
    const { inputs, overlaps } = toPortfolioInputs(
      [],
      [synced("AAPL", 15, 180), { ...synced("AAPL", 5, 150), label: "Wealthsimple", accountId: "ws-1" }],
    );
    expect(inputs.map((i) => i.sourceLabel)).toEqual(["Interactive Brokers", "Wealthsimple"]);
    expect(overlaps).toEqual([]);
  });

  it("keeps one company typed in for two kinds of account as two holdings, not an overlap", () => {
    const { inputs, overlaps } = toPortfolioInputs(
      [manual("VFV.TO", 10, 100, "TFSA"), manual("VFV.TO", 20, 110, "RRSP")],
      [],
    );
    expect(inputs.map((i) => i.accountType)).toEqual(["RRSP", "TFSA"]);
    expect(overlaps).toEqual([]);
  });

  it("flags a typed-in and a synced holding only when they could be the same account", () => {
    const tfsa = { ...synced("VFV.TO", 10, 100, "CAD"), accountType: "TFSA" as const };
    expect(toPortfolioInputs([manual("VFV.TO", 10, 100, "RRSP")], [tfsa]).overlaps).toEqual([]);
    expect(toPortfolioInputs([manual("VFV.TO", 10, 100, "TFSA")], [tfsa]).overlaps).toEqual([
      { symbol: "VFV.TO", from: ["entered by hand (TFSA)", "Interactive Brokers (TFSA)"] },
    ]);
    // With no kind on one side, they may well be the same shares.
    expect(toPortfolioInputs([manual("VFV.TO", 10, 100)], [tfsa]).overlaps).toHaveLength(1);
  });

  it("leaves the currency unset for a hand-entered holding, as it always was", () => {
    const { inputs } = toPortfolioInputs([manual("SHOP.TO", 1, 100)], []);
    expect(inputs[0]).toMatchObject({ source: "manual", currency: null, reportedAt: null });
  });
});

describe("valuing holdings from more than one source", () => {
  beforeEach(() => {
    quotes.bySymbol.clear();
    quotes.asked.length = 0;
  });

  it("looks each company up once, however many rows hold it", async () => {
    quotes.bySymbol.set("AAPL", { price: 200, currency: "USD", asOf: "2025-10-01" });
    const { inputs } = toPortfolioInputs([manual("AAPL", 5, 150)], [synced("AAPL", 15, 180)]);
    const view = await loadPortfolio(inputs, []);

    expect(quotes.asked).toEqual(["AAPL"]);
    expect(view.holdings.map((h) => [h.source, h.value])).toEqual([
      ["manual", 1000],
      ["synced", 3000],
    ]);
  });

  it("counts a company held twice once in the exposures, at its combined size", async () => {
    quotes.bySymbol.set("AAPL", { price: 200, currency: "USD", asOf: "2025-10-01" });
    quotes.bySymbol.set("KO", { price: 100, currency: "USD", asOf: "2025-10-01" });
    const { inputs } = toPortfolioInputs(
      [manual("AAPL", 5, 150), manual("KO", 30, 60)],
      [synced("AAPL", 15, 180)],
    );
    const view = await loadPortfolio(inputs, []);

    expect(view.intelligence?.largestHolding).toEqual({ symbol: "AAPL", share: 4000 / 7000 });
    expect(view.intelligence?.theses.holdings).toBe(2);
  });

  it("will not value a synced holding at a price in a different currency", async () => {
    // The broker holds the CAD line; the only quote to hand is in USD.
    quotes.bySymbol.set("RY.TO", { price: 100, currency: "USD", asOf: "2025-10-01" });
    const { inputs } = toPortfolioInputs([], [synced("RY.TO", 10, 140, "CAD")]);
    const [holding] = (await loadPortfolio(inputs, [])).holdings;

    expect(holding.currency).toBe("CAD");
    expect(holding.price).toBeNull();
    expect(holding.value).toBeNull();
  });

  it("values a synced holding when the currencies agree", async () => {
    quotes.bySymbol.set("RY.TO", { price: 150, currency: "CAD", asOf: "2025-10-01" });
    const { inputs } = toPortfolioInputs([], [synced("RY.TO", 10, 140, "CAD")]);
    const [holding] = (await loadPortfolio(inputs, [])).holdings;

    expect(holding).toMatchObject({ source: "synced", sourceLabel: "Interactive Brokers", price: 150, value: 1500, gain: 100 });
  });
});
