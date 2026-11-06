import { describe, expect, it } from "vitest";
import type { EtfProfile } from "../providers/alphavantage";
import { holdingsFacts, LARGEST_SHOWN } from "./compare-funds";
import type { FundReport } from "./fund-filings";
import { fundManager } from "./fund-manager";
import { symbolsForCusips } from "./holding-symbols";
import type { FundHolding } from "./nport";

describe("whose fund it is", () => {
  it("reads the manager from a Canadian fund's name", () => {
    expect(fundManager("BMO S&P 500 Index ETF", "ZSP.TO")?.name).toBe("BMO Global Asset Management");
    expect(fundManager("Vanguard S&P 500 Index ETF", "VFV.TO")).toEqual({
      name: "Vanguard Canada",
      url: "https://www.vanguard.ca/en/product",
    });
    expect(fundManager("Horizons S&P/TSX 60 Index ETF", "HXT.TO")?.name).toBe("Global X Canada");
    expect(fundManager("  td u.s. equity index etf", "TPU.TO")?.name).toBe("TD Asset Management");
  });

  it("answers nothing for a US listing, an unknown manager, or no name", () => {
    expect(fundManager("Vanguard S&P 500 ETF", "VOO")).toBeNull();
    expect(fundManager("Somebody Else Growth ETF", "XYZ.TO")).toBeNull();
    expect(fundManager(null, "ZSP.TO")).toBeNull();
    // A word inside the name is not the manager.
    expect(fundManager("Canadian Bank Dividend (BMO) ETF", "XYZ.TO")).toBeNull();
  });
});

describe("matching a fund's holdings to pages here", () => {
  it("maps the CUSIPs it knows and asks once for each", async () => {
    let asked: string[] = [];
    const map = await symbolsForCusips(["037833100", "594918104", "037833100", null, "not-a-cusip"], async (wanted) => {
      asked = wanted;
      return [{ cusip: "037833100", symbol: "AAPL" }];
    });
    expect(asked).toEqual(["037833100", "594918104"]);
    expect(map).toEqual({ "037833100": "AAPL" });
  });

  it("costs the links, not the page, when the table cannot be read", async () => {
    const map = await symbolsForCusips(["037833100"], async () => {
      throw new Error("relation does not exist");
    });
    expect(map).toEqual({});
    expect(await symbolsForCusips([], async () => [])).toEqual({});
  });
});

const holding = (name: string, percent: number, cusip: string | null = null, isShort = false): FundHolding => ({
  name,
  cusip,
  isin: null,
  percent,
  valueUsd: null,
  assetCategory: "EC",
  country: "US",
  coupon: null,
  maturity: null,
  isShort,
});

const report = (holdings: FundHolding[], holdingCount = 500, topTenPercent: number | null = 38.5): FundReport =>
  ({
    portfolio: {
      seriesName: null,
      registrantName: null,
      asOf: "2026-06-30",
      netAssets: 1,
      totalAssets: 1,
      holdingCount,
      byAsset: [],
      byCountry: [],
      topTenPercent,
      holdings,
      monthlyReturns: [],
    },
    filing: { accession: "0000000000-26-000001", filedAt: "2026-08-28", indexUrl: "https://www.sec.gov/x" },
  }) as FundReport;

const profile = (over: Partial<EtfProfile>): EtfProfile =>
  ({
    expenseRatio: 0.002,
    dividendYield: null,
    turnover: null,
    inceptionDate: null,
    leveraged: false,
    sectors: [],
    holdings: [],
    topHoldings: [],
    holdingCount: null,
    netAssets: null,
    netAssetsCurrency: null,
    source: { name: "iShares Canada", url: "https://www.blackrock.com/ca", asOf: "2026-10-20", publishedByManager: true },
    ...over,
  }) as EtfProfile;

describe("what a fund holds, for the comparison", () => {
  it("takes a US fund's count, concentration and largest names from its filing", () => {
    const facts = holdingsFacts(
      report([holding("Apple Inc", 7.1, "037833100"), holding("Short Co", 3, null, true), holding("Microsoft Corp", 6.4, "594918104")]),
      null,
      { "037833100": "AAPL" },
    );
    expect(facts.holdingCount).toBe(500);
    expect(facts.topTenWeight).toBeCloseTo(0.385, 10);
    expect(facts.largest).toEqual([
      { name: "Apple Inc", symbol: "AAPL", weight: 0.071 },
      { name: "Microsoft Corp", symbol: null, weight: 0.064 },
    ]);
  });

  it("falls back to the manager's list for a fund that files nothing", () => {
    const topHoldings = Array.from({ length: 12 }, (_, i) => ({
      name: `HOLDING ${i}`,
      symbol: i === 0 ? "RY.TO" : null,
      weight: 0.05 - i * 0.001,
      detail: null,
    }));
    const facts = holdingsFacts(null, profile({ topHoldings, holdingCount: 230 }));
    expect(facts.holdingCount).toBe(230);
    expect(facts.largest).toHaveLength(LARGEST_SHOWN);
    expect(facts.largest[0]).toEqual({ name: "HOLDING 0", symbol: "RY.TO", weight: 0.05 });
    expect(facts.topTenWeight).toBeCloseTo(0.455, 10);
  });

  it("leaves everything empty when neither source has the holdings", () => {
    expect(holdingsFacts(null, profile({}))).toEqual({ holdingCount: null, topTenWeight: null, largest: [] });
    expect(holdingsFacts(null, null)).toEqual({ holdingCount: null, topTenWeight: null, largest: [] });
  });
});
