import { describe, expect, it } from "vitest";
import { mapEtfProfile } from "./alphavantage";

/**
 * The fund facts that no filing carries.
 *
 * The payload is a real Alpha Vantage `ETF_PROFILE` response for QQQ, trimmed.
 * What is worth pinning is not that a field is copied across but the handful
 * of places the provider disagrees with the app's assumptions: it sends
 * numbers as strings, writes "n/a" where a value is missing, shouts its sector
 * names, and answers for a ticker that is not a fund at all with an object
 * rather than an error.
 */

const QQQ = {
  net_assets: "489000000000",
  net_expense_ratio: "0.0018",
  portfolio_turnover: "n/a",
  dividend_yield: "0.0041",
  inception_date: "1999-03-10",
  leveraged: "NO",
  sectors: [
    { sector: "INFORMATION TECHNOLOGY", weight: "0.243" },
    { sector: "CONSUMER STAPLES", weight: "0.045" },
    { sector: "COMMUNICATION SERVICES", weight: "0.043" },
  ],
};

describe("reading a fund profile", () => {
  it("keeps ratios as fractions, which is what the page formats", () => {
    const p = mapEtfProfile(QQQ)!;
    // 0.0018 is 0.18%. Multiplying here would show 18%.
    expect(p.expenseRatio).toBeCloseTo(0.0018, 6);
    expect(p.dividendYield).toBeCloseTo(0.0041, 6);
  });

  it('treats "n/a" as absent rather than as a number', () => {
    const p = mapEtfProfile(QQQ)!;
    expect(p.turnover).toBeNull();
  });

  it("stops shouting the sector names", () => {
    const p = mapEtfProfile(QQQ)!;
    expect(p.sectors.map((s) => s.sector)).toEqual([
      "Information Technology",
      "Consumer Staples",
      "Communication Services",
    ]);
  });

  it("orders sectors by weight, largest first", () => {
    const shuffled = { ...QQQ, sectors: [...QQQ.sectors].reverse() };
    const p = mapEtfProfile(shuffled)!;
    expect(p.sectors[0].sector).toBe("Information Technology");
    expect(p.sectors[0].weight).toBeCloseTo(0.243, 6);
  });

  it("keeps the launch date as filed", () => {
    expect(mapEtfProfile(QQQ)!.inceptionDate).toBe("1999-03-10");
  });
});

describe("the leveraged flag drives a warning, so it is read strictly", () => {
  it("is true only for an explicit yes", () => {
    expect(mapEtfProfile({ ...QQQ, leveraged: "YES" })!.leveraged).toBe(true);
    expect(mapEtfProfile({ ...QQQ, leveraged: "yes" })!.leveraged).toBe(true);
  });

  it("is false for anything else, including nothing at all", () => {
    // Inventing a warning is worse than missing one, so anything unrecognised
    // resolves to "not leveraged" rather than to a scary banner.
    expect(mapEtfProfile({ ...QQQ, leveraged: "NO" })!.leveraged).toBe(false);
    expect(mapEtfProfile({ ...QQQ, leveraged: "n/a" })!.leveraged).toBe(false);
    expect(mapEtfProfile({ ...QQQ, leveraged: undefined })!.leveraged).toBe(false);
  });
});

describe("things that are not funds", () => {
  it("returns null for the empty object an equity ticker gets back", () => {
    expect(mapEtfProfile({})).toBeNull();
    expect(mapEtfProfile(null)).toBeNull();
  });

  it('returns null when every field it needs is "n/a"', () => {
    expect(mapEtfProfile({ net_expense_ratio: "n/a", inception_date: "n/a" })).toBeNull();
  });

  it("still returns a profile when only one of the two is known", () => {
    // A fund with no published fee is unusual, not impossible, and the launch
    // date alone is enough to say this is a fund worth describing.
    expect(mapEtfProfile({ inception_date: "2010-09-07" })).toMatchObject({
      expenseRatio: null,
      inceptionDate: "2010-09-07",
    });
  });

  it("survives a payload with no sectors at all", () => {
    expect(mapEtfProfile({ net_expense_ratio: "0.0003" })!.sectors).toEqual([]);
  });
});
