import { describe, expect, it } from "vitest";
import { mapEodhdEtfProfile } from "./eodhd";

/**
 * The units are the whole risk in this mapper.
 *
 * `EtfProfile` is a fractions contract, because Alpha Vantage sends fractions
 * and `percent()` renders them — 0.0018 prints as 0.18%. EODHD sends the same
 * quantity as a percentage. Passed through unconverted, a fund charging 0.18%
 * is published as charging 18%, and nothing about that looks like a bug: it is
 * a plausible-looking number on a page people use to choose between funds.
 *
 * The payload below is shaped like a real EODHD `ETF_Data` block.
 */

const XIC = {
  Inception_Date: "2001-02-16",
  Yield: "2.87",
  NetExpenseRatio: "0.06",
  Ongoing_Charge: "0.06",
  AnnualHoldingsTurnover: "4.00",
  Sector_Weights: {
    "Financial Services": { "Equity_%": "31.42" },
    Energy: { "Equity_%": "17.05" },
    Technology: { "Equity_%": "10.11" },
  },
  Holdings: {
    "RY.TO": { Code: "RY", "Assets_%": "6.51" },
    "SHOP.TO": { Code: "SHOP", "Assets_%": "5.02" },
    "TD.TO": { Code: "TD", "Assets_%": "4.31" },
  },
};

describe("percentages in, fractions out", () => {
  it("converts the fee, so 0.06% does not become 6%", () => {
    const p = mapEodhdEtfProfile(XIC)!;
    expect(p.expenseRatio).toBeCloseTo(0.0006, 8);
    // The failure this guards against, stated as the thing it must not be.
    expect(p.expenseRatio).not.toBeCloseTo(0.06, 4);
  });

  it("converts the yield and the turnover the same way", () => {
    const p = mapEodhdEtfProfile(XIC)!;
    expect(p.dividendYield).toBeCloseTo(0.0287, 8);
    expect(p.turnover).toBeCloseTo(0.04, 8);
  });

  it("converts sector and holding weights", () => {
    const p = mapEodhdEtfProfile(XIC)!;
    // Compared loosely: 31.42/100 is 0.31420000000000003 in binary floating
    // point, and pinning that exactly would be testing IEEE 754, not this.
    expect(p.sectors[0].sector).toBe("Financial Services");
    expect(p.sectors[0].weight).toBeCloseTo(0.3142, 8);
    expect(p.holdings[0].symbol).toBe("RY");
    expect(p.holdings[0].weight).toBeCloseTo(0.0651, 8);
  });
});

describe("refusing a figure read in the wrong units", () => {
  it("drops a fee no fund could charge", () => {
    /*
      If the provider ever sends a fraction where the schema says percentage,
      dividing again yields something absurd. A reader cannot tell a units bug
      from an expensive fund, so an implausible fee is dropped rather than
      rendered.
    */
    expect(mapEodhdEtfProfile({ ...XIC, NetExpenseRatio: "40", Ongoing_Charge: "40" })!.expenseRatio).toBeNull();
  });

  it("keeps a fee that is merely high", () => {
    // 2.5% is expensive and real. The guard is for the impossible, not the dear.
    expect(mapEodhdEtfProfile({ ...XIC, NetExpenseRatio: "2.5" })!.expenseRatio).toBeCloseTo(0.025, 8);
  });

  it("falls back to the ongoing charge, which is the same idea named twice", () => {
    const p = mapEodhdEtfProfile({ ...XIC, NetExpenseRatio: undefined })!;
    expect(p.expenseRatio).toBeCloseTo(0.0006, 8);
  });
});

describe("what it will not describe as a fund", () => {
  it("returns null for a payload with neither a fee nor a launch date", () => {
    expect(mapEodhdEtfProfile(null)).toBeNull();
    expect(mapEodhdEtfProfile(undefined)).toBeNull();
    expect(mapEodhdEtfProfile({})).toBeNull();
  });

  it("treats the provider's empty date as no date", () => {
    expect(mapEodhdEtfProfile({ Inception_Date: "0000-00-00" })).toBeNull();
  });

  it("still answers when only the launch date is known", () => {
    expect(mapEodhdEtfProfile({ Inception_Date: "2001-02-16" })).toMatchObject({
      expenseRatio: null,
      inceptionDate: "2001-02-16",
    });
  });

  it("never claims a fund is leveraged, because EODHD does not say", () => {
    // The flag drives a warning banner. A false alarm is worse than silence.
    expect(mapEodhdEtfProfile(XIC)!.leveraged).toBe(false);
  });

  it("survives missing sectors and holdings", () => {
    const p = mapEodhdEtfProfile({ NetExpenseRatio: "0.06" })!;
    expect(p.sectors).toEqual([]);
    expect(p.holdings).toEqual([]);
  });

  it("takes the bare ticker from an exchange-qualified key", () => {
    const p = mapEodhdEtfProfile({
      NetExpenseRatio: "0.1",
      Holdings: { "ENB.TO": { "Assets_%": "3.2" } },
    })!;
    expect(p.holdings[0].symbol).toBe("ENB");
  });
});
