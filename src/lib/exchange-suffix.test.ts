import { describe, expect, it } from "vitest";
import { matchesListing, parseExchangeSuffix } from "./exchange-suffix";

/**
 * The dangerous half of this is what it must NOT strip.
 *
 * A dot in a ticker is not always an exchange. BRK.B is Berkshire's B shares,
 * and taking the ".B" off sends somebody asking for one security to a
 * different one — a quieter and worse failure than the 404 this fixes.
 */

describe("exchange suffixes it recognises", () => {
  it("splits a Toronto listing", () => {
    expect(parseExchangeSuffix("VCN.TO")).toMatchObject({
      base: "VCN",
      suffix: "TO",
      exchange: "Toronto Stock Exchange",
      country: "Canada",
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

  it("carries the country, which providers agree on more than exchange names", () => {
    expect(parseExchangeSuffix("VCN.TO")?.country).toBe("Canada");
    expect(parseExchangeSuffix("BHP.AX")?.country).toBe("Australia");
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

describe("picking the listing a suffix asked for", () => {
  const toronto = parseExchangeSuffix("QQC.TO")!;

  it("matches however the provider spells the exchange", () => {
    // The same venue arrives under three names depending who is asked.
    for (const exchange of ["TSX", "TSE", "Toronto", "TSX Exchange"]) {
      expect(matchesListing(toronto, { exchange, country: null })).toBe(true);
    }
  });

  it("falls back to the country when the exchange name is unfamiliar", () => {
    expect(matchesListing(toronto, { exchange: "Some Venue", country: "Canada" })).toBe(true);
  });

  it("rejects the listing somewhere else entirely", () => {
    /*
      The failure this exists to stop. Searching "QQC" returns a US Simplify
      fund and a Canadian CI Invesco one; answering the US fund to somebody
      who asked for QQC.TO gives them the wrong security without saying so.
    */
    expect(matchesListing(toronto, { exchange: "NASDAQ", country: "United States" })).toBe(false);
    expect(matchesListing(toronto, { exchange: null, country: null })).toBe(false);
  });

  it("does not accept a near-miss country", () => {
    expect(matchesListing(toronto, { exchange: "LSE", country: "United Kingdom" })).toBe(false);
  });
});
