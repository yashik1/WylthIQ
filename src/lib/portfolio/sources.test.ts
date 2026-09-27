import { beforeEach, describe, expect, it, vi } from "vitest";
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

const manual = (symbol: string, quantity: number, averageCost: number) => ({
  symbol,
  quantity,
  averageCost,
  purchaseDate: null,
});
const synced = (symbol: string, quantity: number, averageCost: number, currency = "USD") => ({
  symbol,
  quantity,
  averageCost,
  currency,
  reportDate: "2025-09-30",
});

describe("holdings from more than one source", () => {
  it("keeps a hand-entered and a synced holding of the same company as two rows", () => {
    const { inputs, overlaps } = toPortfolioInputs([manual("AAPL", 5, 150)], [synced("AAPL", 15, 180)]);
    expect(inputs.map((i) => i.key)).toEqual(["manual:AAPL", "ibkr:AAPL:USD"]);
    expect(overlaps).toEqual(["AAPL"]);
  });

  it("combines one company held in two accounts at the broker", () => {
    const { inputs, overlaps } = toPortfolioInputs(
      [],
      [synced("RY.TO", 10, 100, "CAD"), { ...synced("RY.TO", 30, 140, "CAD"), reportDate: "2025-10-01" }],
    );
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toMatchObject({ quantity: 40, averageCost: 130, currency: "CAD", reportedAt: "2025-10-01" });
    expect(overlaps).toEqual([]);
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
    expect(view.holdings.map((h) => [h.key, h.value])).toEqual([
      ["manual:AAPL", 1000],
      ["ibkr:AAPL:USD", 3000],
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

    expect(holding).toMatchObject({ source: "ibkr", price: 150, value: 1500, gain: 100 });
  });
});
