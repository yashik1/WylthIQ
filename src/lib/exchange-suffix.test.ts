import { describe, expect, it } from "vitest";
import { parseExchangeSuffix } from "./exchange-suffix";

/**
 * The dangerous half of this is what it must NOT strip.
 *
 * A dot in a ticker is not always an exchange. BRK.B is Berkshire's B shares,
 * and taking the ".B" off sends somebody asking for one security to a
 * different one — a quieter and worse failure than the 404 this fixes.
 */

describe("exchange suffixes it recognises", () => {
  it("splits a Toronto listing", () => {
    expect(parseExchangeSuffix("VCN.TO")).toEqual({
      base: "VCN",
      suffix: "TO",
      exchange: "Toronto Stock Exchange",
    });
  });

  it("is case-insensitive and tolerates whitespace", () => {
    expect(parseExchangeSuffix(" vcn.to ")?.base).toBe("VCN");
    expect(parseExchangeSuffix("xic.To")?.base).toBe("XIC");
  });

  it("handles the other venues a reader is likely to type", () => {
    expect(parseExchangeSuffix("RIO.L")?.exchange).toBe("London Stock Exchange");
    expect(parseExchangeSuffix("BHP.AX")?.exchange).toBe("Australian Securities Exchange");
    expect(parseExchangeSuffix("7203.T")?.exchange).toBe("Tokyo Stock Exchange");
    expect(parseExchangeSuffix("ZSP.NE")?.exchange).toBe("Cboe Canada");
  });
});

describe("what it refuses to touch", () => {
  it("leaves a share class alone", () => {
    // The one that matters. Stripping ".B" here would resolve to a different
    // security and look like it worked.
    expect(parseExchangeSuffix("BRK.B")).toBeNull();
    expect(parseExchangeSuffix("BF.B")).toBeNull();
    expect(parseExchangeSuffix("RDS.A")).toBeNull();
  });

  it("leaves a bare ticker alone", () => {
    expect(parseExchangeSuffix("AAPL")).toBeNull();
    expect(parseExchangeSuffix("VCN")).toBeNull();
  });

  it("leaves an unrecognised suffix alone rather than guessing", () => {
    expect(parseExchangeSuffix("FOO.ZZZ")).toBeNull();
    expect(parseExchangeSuffix("FOO.XYZ")).toBeNull();
  });

  it("is not confused by a malformed symbol", () => {
    expect(parseExchangeSuffix("")).toBeNull();
    expect(parseExchangeSuffix(".TO")).toBeNull();
    expect(parseExchangeSuffix("VCN.")).toBeNull();
    expect(parseExchangeSuffix("A.B.TO")).toBeNull();
  });

  it("does not treat a crypto or futures symbol as suffixed", () => {
    // These reach the page by their own catalogue and must pass through
    // untouched; neither carries a dot, but the guard is worth stating.
    expect(parseExchangeSuffix("BTC-USD")).toBeNull();
    expect(parseExchangeSuffix("GC=F")).toBeNull();
  });
});
