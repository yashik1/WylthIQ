import { describe, expect, it, vi } from "vitest";
import { restateCompany } from "./company-currency";
import type { Fact, NormalizedFundamentals } from "./fundamentals/types";
import type { CompanyProfile, Quote } from "./providers/types";

/**
 * Three numbers from three places, read as though they were one.
 *
 * A company page divides the market's valuation into the filer's profit, and
 * neither number knows what currency the other is in. SK hynix files in won,
 * is valued in Seoul in won, and trades on Nasdaq in dollars — so its page
 * reported a P/E of 39,478 against a real 29, a price to book of 14,059, and
 * "$1236.88T market value". Royal Bank is the same fault at a quieter scale:
 * the compare page put it on 19 times earnings while its own page said 27.
 */

vi.mock("./fx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./fx")>();
  const rates: Record<string, number> = {
    "KRW:USD": 0.00073,
    "CAD:USD": 0.7174,
  };
  return {
    ...actual,
    getRate: vi.fn(async (from: string, to: string) => rates[`${from}:${to}`] ?? null),
  };
});

const fact = (value: number, unit: string): Fact => ({
  value,
  unit,
  end: "2025-12-31",
  fiscalYear: 2025,
  fiscalPeriod: "FY",
  form: "annual-report",
  sourceConcept: "yahoo:x",
  sourceFilingUrl: null,
});

const filings = (currency: string, over: Record<string, number> = {}): NormalizedFundamentals => ({
  cik: "",
  entityName: "SK hynix Inc.",
  taxonomy: "us-gaap",
  missingFields: [],
  annual: [
    {
      fiscalYear: 2025,
      fiscalPeriod: "FY",
      end: "2025-12-31",
      form: "annual-report",
      facts: {
        revenue: fact(over.revenue ?? 97_146_675_000_000, currency),
        netIncome: fact(over.netIncome ?? 42_920_000_000_000, currency),
        equity: fact(over.equity ?? 120_500_000_000_000, currency),
        sharesOutstanding: fact(over.shares ?? 701_691_780, "shares"),
      },
      filedAt: "2026-03-15",
    },
  ],
});

const profile = (over: Partial<CompanyProfile> = {}): CompanyProfile => ({
  symbol: "SKHY",
  name: "SK hynix Inc.",
  exchange: "KOREA EXCHANGE (STOCK MARKET)",
  country: "KR",
  currency: "KRW",
  sicCode: null,
  sicDescription: null,
  industry: "Semiconductors",
  website: null,
  logo: null,
  // Seoul's own valuation: 701,691,780 shares at ₩1,759,000.
  marketCap: 1_234_275_841_020_000,
  marketCapCurrency: "KRW",
  sharesOutstanding: 701_691_780,
  cik: null,
  description: null,
  ...over,
});

// One American depositary share is a fraction of an ordinary one, which is why
// $174.87 and ₩1,759,000 are the same company on the same day.
const nasdaq: Quote = {
  symbol: "SKHY",
  price: 174.87,
  change: 0.03,
  changePercent: 0.02,
  previousClose: 174.84,
  dayHigh: null,
  dayLow: null,
  volume: null,
  freshness: "delayed-15min",
  asOf: "2026-09-16T20:00:00Z",
  currency: "USD",
};

describe("a filer priced on another continent", () => {
  it("shows the market value in the currency the page is written in", async () => {
    const out = await restateCompany({ fundamentals: filings("KRW"), quote: nasdaq, profile: profile() });

    expect(out.displayCurrency).toBe("USD");
    expect(out.converted).toEqual({ from: "KRW", rate: 0.00073 });
    // About $901bn — not the $1,236.88 trillion the header used to print.
    expect(out.marketCap! / 1e9).toBeCloseTo(901.0, 0);
  });

  it("divides into a P/E somebody could believe", async () => {
    const out = await restateCompany({ fundamentals: filings("KRW"), quote: nasdaq, profile: profile() });
    const netIncome = out.fundamentals!.annual[0].facts.netIncome!.value;

    expect(out.marketCap! / netIncome).toBeCloseTo(28.8, 1);
  });

  /*
    The share price cannot stand in for the valuation here. Multiplying $174.87
    by the 701,691,780 ordinary shares in the filing gives $123bn for a company
    the market prices at $901bn, because the thing being multiplied is a
    depositary share.
  */
  it("prefers the market's own valuation to a price times a share count", async () => {
    const out = await restateCompany({ fundamentals: filings("KRW"), quote: nasdaq, profile: profile() });

    expect(out.marketCap!).toBeGreaterThan(500e9);
  });

  it("leaves the share count a count", async () => {
    const out = await restateCompany({ fundamentals: filings("KRW"), quote: nasdaq, profile: profile() });
    const shares = out.fundamentals!.annual[0].facts.sharesOutstanding!;

    expect(shares.value).toBe(701_691_780);
    expect(shares.unit).toBe("shares");
  });
});

describe("a Canadian filer listed in New York", () => {
  const royalBank = profile({
    symbol: "RY",
    name: "ROYAL BANK OF CANADA",
    exchange: "NEW YORK STOCK EXCHANGE, INC.",
    currency: "USD",
    marketCap: 394_090_000_000,
    marketCapCurrency: "USD",
    sharesOutstanding: 1_948_000_000,
  });
  const nyse: Quote = { ...nasdaq, symbol: "RY", price: 202.29, currency: "USD" };

  it("restates the filings rather than the valuation", async () => {
    const out = await restateCompany({
      fundamentals: filings("CAD", { netIncome: 20_400_000_000 }),
      quote: nyse,
      profile: royalBank,
    });

    expect(out.displayCurrency).toBe("USD");
    expect(out.marketCap).toBe(394_090_000_000);
    // 26.9 times earnings, which is what the company page has always said —
    // the compare page's 19.35 was this same sum in two currencies.
    const netIncome = out.fundamentals!.annual[0].facts.netIncome!.value;
    expect(out.marketCap! / netIncome).toBeCloseTo(26.9, 1);
  });
});

describe("when a rate cannot be had", () => {
  /*
    Both sides stay in the filing's currency rather than one moving without the
    other. The page says which currency it is showing, so figures in won are
    readable; figures in two currencies are not.
  */
  it("keeps the filings and the valuation together", async () => {
    const out = await restateCompany({
      fundamentals: filings("JPY"),
      quote: { ...nasdaq, currency: "USD" },
      profile: profile({ marketCap: 5_000_000_000_000, marketCapCurrency: "JPY" }),
    });

    expect(out.converted).toBeNull();
    expect(out.displayCurrency).toBe("JPY");
    expect(out.marketCap).toBe(5_000_000_000_000);
  });

  it("publishes no market value it cannot place in the displayed currency", async () => {
    const out = await restateCompany({
      fundamentals: filings("USD"),
      quote: { ...nasdaq, currency: "USD" },
      profile: profile({ marketCap: 5_000_000_000_000, marketCapCurrency: "JPY" }),
    });

    expect(out.displayCurrency).toBe("USD");
    expect(out.marketCap).toBeNull();
  });
});

describe("the ordinary case", () => {
  const apple = profile({
    symbol: "AAPL",
    exchange: "NASDAQ NMS - GLOBAL MARKET",
    currency: "USD",
    marketCap: 3_400_000_000_000,
    marketCapCurrency: "USD",
  });

  it("changes nothing for a US company filing in dollars", async () => {
    const out = await restateCompany({
      fundamentals: filings("USD"),
      quote: { ...nasdaq, currency: "USD" },
      profile: apple,
    });

    expect(out.converted).toBeNull();
    expect(out.displayCurrency).toBe("USD");
    expect(out.marketCap).toBe(3_400_000_000_000);
  });

  it("falls back to price times share count when no provider reports one", async () => {
    const out = await restateCompany({
      fundamentals: filings("USD", { shares: 1_000_000 }),
      quote: { ...nasdaq, price: 50, currency: "USD" },
      profile: { ...apple, marketCap: null },
    });

    expect(out.marketCap).toBe(50_000_000);
  });
});
