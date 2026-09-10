import { describe, expect, it } from "vitest";
import {
  buildISharesProfile,
  holdingsUrl,
  indexFundList,
  isoFromCompactDate,
  isoFromLongDate,
  parseHoldingsCsv,
  splitCsvLine,
  type ISharesFund,
} from "./ishares-ca";

/**
 * Reading BlackRock's own iShares Canada files.
 *
 * The rows below are copied from the live downloads for XIC, XUS and XBB, and
 * the fund-list row for XIC from the site's product screener. What is worth
 * pinning is where the files disagree with the app's assumptions: numbers
 * carry thousands separators inside quotes, percentages are in percent units,
 * a blank line is a non-breaking space, and a fund of funds appends a second
 * section that is not its own holdings.
 */

const NBSP = "\u00A0";

const XIC_ROW: ISharesFund = {
  localExchangeTicker: "XIC",
  fundName: "iShares Core S&P/TSX Capped Composite Index ETF",
  mer: { d: "0.06", r: 0.06 },
  inceptionDate: { d: "Feb 16, 2001", r: 20010216 },
  totalNetAssets: { d: "34,042,145,549.02", r: 34042145549.02 },
  twelveMonTrlYield: { d: "1.95", r: 1.946 },
  productPageUrl: "/ca/investors/en/products/239837/ishares-sptsx-capped-composite-index-etf",
};

const XIC_CSV = [
  'Fund Holdings as of,"Sep 9, 2026"',
  NBSP,
  "Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Price,Location,Exchange,Currency,FX Rate,Market Currency",
  '"RY","ROYAL BANK OF CANADA","Financials","Equity","2,652,727,561.33","7.79","2,652,727,561.33","9,288,587.00","285.59","Canada","Toronto Stock Exchange","CAD","1.00","CAD"',
  '"TD","TORONTO DOMINION","Financials","Equity","1,829,165,776.20","5.37","1,829,165,776.20","11,106,046.00","164.70","Canada","Toronto Stock Exchange","CAD","1.00","CAD"',
  '"SHOP","SHOPIFY SUBORDINATE VOTING CLASS A","Information Technology","Equity","1,419,911,833.67","4.17","1,419,911,833.67","8,107,759.00","175.13","Canada","Toronto Stock Exchange","CAD","1.00","CAD"',
  '"BMO","BANK OF MONTREAL","Financials","Equity","1,109,761,388.64","3.26","1,109,761,388.64","4,656,602.00","238.32","Canada","Toronto Stock Exchange","CAD","1.00","CAD"',
  '"BNS","BANK OF NOVA SCOTIA","Financials","Equity","1,039,979,793.69","3.06","1,039,979,793.69","8,170,161.00","127.29","Canada","Toronto Stock Exchange","CAD","1.00","CAD"',
  '"CAD","CAD CASH","Cash and/or Derivatives","Cash","3,096,892.06","0.02","3,096,892.06","3,096,892.00","100.00","Canada","-","CAD","1.00","CAD"',
  NBSP,
].join("\n");

/** A fund of funds: its one holding, cash, then the look-through section. */
const XUS_CSV = [
  'Fund Holdings as of,"Sep 9, 2026"',
  NBSP,
  "Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Price,Location,Exchange,Currency,FX Rate,Market Currency",
  '"IVV","ISHARES CORE S&P ETF TRUST","Financials","Equity","13,723,192,722.93","99.95","13,723,192,722.93","12,984,710.00","1,056.88","United States","NYSE Arca","CAD","0.72","USD"',
  '"USD","USD CASH","Cash and/or Derivatives","Cash","4,274,023.37","0.03","4,274,023.37","3,098,129.00","137.96","United States","-","CAD","0.72","USD"',
  '"CAD","CAD CASH","Cash and/or Derivatives","Cash","3,096,892.06","0.02","3,096,892.06","3,096,892.00","100.00","Canada","-","CAD","1.00","CAD"',
  NBSP,
  'Fund Holdings as of,"Sep 9, 2026"',
  NBSP,
  "Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Price,Location,Exchange,Currency,FX Rate,Market Currency",
  '"NVDA","NVIDIA","Information Technology","Equity","1,128,547,338.36","8.22","1,128,547,338.36","310,480,600.00","-","United States","NASDAQ","CAD","-","USD"',
  '"AAPL","APPLE","Information Technology","Equity","964,831,021.49","7.03","964,831,021.49","188,275,960.00","-","United States","NASDAQ","CAD","-","USD"',
  NBSP,
].join("\n");

const XBB_CSV = [
  'Fund Holdings as of,"Sep 9, 2026"',
  NBSP,
  "Ticker,Name,Sector,Asset Class,Market Value,Weight (%),Notional Value,Shares,Par Value,Price,Location,Exchange,Currency,Duration,FX Rate,Maturity,Coupon (%),Market Currency,Effective Date",
  '"CAN","CANADA (GOVERNMENT OF)","Federal","Fixed Income","159,771,948.83","1.50","159,771,948.83","163,870,000.00","163,870,000.00","97.44","Canada","-","CAD","3.74","1.00","Sep 1, 2030","2.75","CAD","Apr 11, 2025"',
  '"CAN","CANADA (GOVERNMENT OF)","Federal","Fixed Income","158,918,543.34","1.49","158,918,543.34","163,743,000.00","163,743,000.00","96.99","Canada","-","CAD","4.16","1.00","Mar 1, 2031","2.75","CAD","Oct 2, 2025"',
  NBSP,
].join("\n");

describe("reading the files' own formats", () => {
  it("keeps a quoted number with thousands separators as one cell", () => {
    expect(splitCsvLine('"RY","2,652,727,561.33","7.79"')).toEqual(["RY", "2,652,727,561.33", "7.79"]);
  });

  it("reads a holdings date without letting a timezone move it", () => {
    expect(isoFromLongDate("Sep 9, 2026")).toBe("2026-09-09");
    expect(isoFromLongDate("Mar 1, 2031")).toBe("2031-03-01");
    expect(isoFromLongDate("-")).toBeNull();
  });

  it("reads the fund list's compact launch date", () => {
    expect(isoFromCompactDate(20010216)).toBe("2001-02-16");
    expect(isoFromCompactDate(null)).toBeNull();
    expect(isoFromCompactDate(2001)).toBeNull();
  });
});

describe("the holdings file", () => {
  it("reads the date and every row of the fund's own section", () => {
    const file = parseHoldingsCsv(XIC_CSV);
    expect(file.asOf).toBe("2026-09-09");
    expect(file.holdings).toHaveLength(6);
    // 7.79 in the file is 7.79% of the fund.
    expect(file.holdings[0]).toMatchObject({ ticker: "RY", weight: 0.0779, exchange: "Toronto Stock Exchange" });
  });

  it("stops before a fund of funds' look-through section", () => {
    // Reading on would report XUS holding NVIDIA directly.
    const tickers = parseHoldingsCsv(XUS_CSV).holdings.map((h) => h.ticker);
    expect(tickers).toEqual(["IVV", "USD", "CAD"]);
  });

  it("carries a bond's maturity and coupon", () => {
    expect(parseHoldingsCsv(XBB_CSV).holdings[0]).toMatchObject({ maturity: "Sep 1, 2030", coupon: "2.75" });
  });
});

describe("an iShares Canada profile", () => {
  const xic = buildISharesProfile(XIC_ROW, parseHoldingsCsv(XIC_CSV))!;

  it("states the MER as a fraction, which is what the page formats", () => {
    // 0.06 on the fund list is 0.06%. Left alone it would print as 6%.
    expect(xic.expenseRatio).toBeCloseTo(0.0006, 8);
    expect(xic.inceptionDate).toBe("2001-02-16");
  });

  it("carries the fund's size in Canadian dollars", () => {
    expect(xic.netAssets).toBeCloseTo(34042145549.02, 2);
    expect(xic.netAssetsCurrency).toBe("CAD");
  });

  it("counts positions and lists the largest, leaving cash out of both", () => {
    expect(xic.holdingCount).toBe(5);
    expect(xic.topHoldings.map((h) => h.symbol)).toEqual(["RY", "TD", "SHOP", "BMO", "BNS"]);
    expect(xic.topHoldings[0]).toEqual({ name: "ROYAL BANK OF CANADA", symbol: "RY", weight: 0.0779, detail: null });
  });

  it("sums a stock fund's sectors from its positions", () => {
    expect(xic.sectors[0].sector).toBe("Financials");
    expect(xic.sectors[0].weight).toBeCloseTo(0.0779 + 0.0537 + 0.0326 + 0.0306, 8);
  });

  it("offers no Toronto ticker for valuation, where it could name a different company", () => {
    // T is Telus in Toronto and AT&T in New York; scores here are US.
    expect(xic.holdings).toEqual([]);
  });

  it("offers a US-listed share for valuation", () => {
    const withUsShare = parseHoldingsCsv(
      XIC_CSV.replace(
        '"BNS","BANK OF NOVA SCOTIA","Financials","Equity","1,039,979,793.69","3.06","1,039,979,793.69","8,170,161.00","127.29","Canada","Toronto Stock Exchange"',
        '"SNOW","SNOWFLAKE","Information Technology","Equity","1,039,979,793.69","3.06","1,039,979,793.69","8,170,161.00","127.29","United States","New York Stock Exchange Inc."',
      ),
    );
    const holdings = buildISharesProfile(XIC_ROW, withUsShare)!.holdings;
    expect(holdings.map((h) => h.symbol)).toEqual(["SNOW"]);
    expect(holdings[0].weight).toBeCloseTo(0.0306, 8);
  });

  it("gives a fund of funds no sector mix and nothing to value", () => {
    // IVV files under "Financials", which says nothing about what XUS owns.
    const xus = buildISharesProfile(XIC_ROW, parseHoldingsCsv(XUS_CSV))!;
    expect(xus.sectors).toEqual([]);
    expect(xus.holdings).toEqual([]);
    expect(xus.topHoldings.map((h) => h.symbol)).toEqual(["IVV"]);
  });

  it("tells one bond from another", () => {
    const xbb = buildISharesProfile(XIC_ROW, parseHoldingsCsv(XBB_CSV))!;
    expect(xbb.topHoldings.map((h) => h.detail)).toEqual(["2.75% · due 2030-09", "2.75% · due 2031-03"]);
  });

  it("keeps a bond fund's sectors when a borrower is called an ETF", () => {
    // XBB really holds bonds from FIRST NATIONS ETF LP. Read as a fund of
    // funds, that one name hid the whole fund's sector mix.
    const withEtfNamedIssuer = parseHoldingsCsv(
      XBB_CSV.replace(
        '"CAN","CANADA (GOVERNMENT OF)","Federal","Fixed Income","158,918,543.34"',
        '"CAN","FIRST NATIONS ETF LP 144A","Federal","Fixed Income","158,918,543.34"',
      ),
    );
    const sectors = buildISharesProfile(XIC_ROW, withEtfNamedIssuer)!.sectors;
    expect(sectors.map((s) => s.sector)).toEqual(["Federal"]);
    expect(sectors[0].weight).toBeCloseTo(0.0299, 8);
  });

  it("says where the figures came from, and when", () => {
    expect(xic.source).toEqual({
      name: "iShares Canada",
      url: "https://www.blackrock.com/ca/investors/en/products/239837/ishares-sptsx-capped-composite-index-etf",
      asOf: "2026-09-09",
      publishedByManager: true,
    });
  });

  it("still shows the fee when the holdings file could not be read", () => {
    const feeOnly = buildISharesProfile(XIC_ROW, null)!;
    expect(feeOnly.expenseRatio).toBeCloseTo(0.0006, 8);
    expect(feeOnly.holdingCount).toBeNull();
    expect(feeOnly.topHoldings).toEqual([]);
  });

  it('treats a "-" fee as absent, and a fee in the wrong units as no fee', () => {
    expect(buildISharesProfile({ ...XIC_ROW, mer: "-" }, null)!.expenseRatio).toBeNull();
    expect(buildISharesProfile({ ...XIC_ROW, mer: { r: 40 } }, null)!.expenseRatio).toBeNull();
  });

  it("describes nothing when there is neither a fee nor a launch date", () => {
    expect(buildISharesProfile({ ...XIC_ROW, mer: "-", inceptionDate: "-" }, null)).toBeNull();
  });
});

describe("the fund list", () => {
  it("keys funds by ticker and skips rows it could not follow", () => {
    const funds = indexFundList({
      "239837": XIC_ROW,
      "1": { localExchangeTicker: "-", productPageUrl: "/x" },
      "2": { localExchangeTicker: "NOPAGE" },
      "3": "not a fund",
    });
    expect([...funds.keys()]).toEqual(["XIC"]);
  });

  it("builds the same holdings link BlackRock's own page carries", () => {
    // Copied from the download button on XIC's page.
    expect(holdingsUrl("XIC", XIC_ROW)).toBe(
      "https://www.blackrock.com/ca/investors/en/products/239837/ishares-sptsx-capped-composite-index-etf/1464253357814.ajax?fileType=csv&fileName=XIC_holdings&dataType=fund",
    );
  });
});
