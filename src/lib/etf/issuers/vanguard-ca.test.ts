import { describe, expect, it } from "vitest";
import { getVanguardCanadaProfile, VANGUARD_CA_AS_OF, VANGUARD_CA_ETFS } from "./vanguard-ca";

/**
 * A hand-kept table is only as good as the checks on it, so these pin the
 * mistakes a copy is likely to make: a fee in the wrong units, a mutual fund
 * slipping in beside the ETFs, and an entry that quietly stops being dated.
 */

describe("the Vanguard Canada table", () => {
  it("holds the 42 ETFs Vanguard lists, and none of its mutual funds", () => {
    const tickers = Object.keys(VANGUARD_CA_ETFS);
    expect(tickers).toHaveLength(42);
    // Series F mutual funds are listed alongside the ETFs as VIC100 and so on.
    expect(tickers.filter((t) => t.startsWith("VIC"))).toEqual([]);
  });

  it("keeps every fee in percent units, as the list prints them", () => {
    // 0.22 is 0.22%. A fraction copied in by mistake would read as 0.0022 —
    // below any real fund's fee, which is what this catches.
    for (const [ticker, fund] of Object.entries(VANGUARD_CA_ETFS)) {
      expect(fund.managementFee, ticker).toBeGreaterThanOrEqual(0.03);
      expect(fund.managementFee, ticker).toBeLessThan(1);
      if (fund.mer != null) {
        expect(fund.mer, ticker).toBeGreaterThanOrEqual(0.03);
        expect(fund.mer, ticker).toBeLessThan(1);
      }
    }
  });

  it("is dated", () => {
    expect(VANGUARD_CA_AS_OF).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("a Vanguard Canada profile", () => {
  it("states the MER as a fraction, which is what the page formats", () => {
    const vcn = getVanguardCanadaProfile("VCN")!;
    expect(vcn.expenseRatio).toBeCloseTo(0.0005, 8);
    expect(getVanguardCanadaProfile("VEQT")!.expenseRatio).toBeCloseTo(0.0022, 8);
  });

  it("carries the fund's size in Canadian dollars and its position count", () => {
    expect(getVanguardCanadaProfile("VCN")).toMatchObject({
      holdingCount: 215,
      netAssets: 17_800_000_000,
      netAssetsCurrency: "CAD",
    });
  });

  it("says where the figures came from, and when", () => {
    expect(getVanguardCanadaProfile("vgro")!.source).toEqual({
      name: "Vanguard Canada's product list",
      url: "https://www.vanguard.ca/en/product",
      asOf: VANGUARD_CA_AS_OF,
      publishedByManager: true,
    });
  });

  it("still describes a fund too new to have an MER", () => {
    const vcor = getVanguardCanadaProfile("VCOR")!;
    expect(vcor.expenseRatio).toBeNull();
    expect(vcor.netAssetsCurrency).toBeNull();
  });

  it("knows nothing of a ticker Vanguard Canada does not list", () => {
    expect(getVanguardCanadaProfile("XIC")).toBeNull();
    expect(getVanguardCanadaProfile("VOO")).toBeNull();
  });
});
