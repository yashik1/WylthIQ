import { describe, expect, it } from "vitest";
import {
  addressSearchResults,
  isSecondaryVenue,
  listingForBareTicker,
  listingSymbol,
  matchesListing,
  parseExchangeSuffix,
  suffixForListing,
} from "./exchange-suffix";

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

describe("the suffix a search result is addressed by", () => {
  it.each([
    ["TSX", "Canada", "TO"],
    ["TSE", "Canada", "TO"],
    ["Toronto Stock Exchange", "Canada", "TO"],
    ["TSXV", "Canada", "V"],
    ["TSX Venture", "Canada", "V"],
    ["NEO", "Canada", "NE"],
    ["LSE", "United Kingdom", "L"],
    ["TSE", "Japan", "T"],
    ["XETR", "Germany", "DE"],
    ["BME", "Spain", "MC"],
  ])("places %s in %s as .%s", (exchange, country, suffix) => {
    expect(suffixForListing({ exchange, country })).toBe(suffix);
  });

  it("gives a US listing no suffix", () => {
    expect(suffixForListing({ exchange: "NYSE", country: "United States" })).toBeNull();
    expect(suffixForListing({ exchange: "NASDAQ", country: null })).toBeNull();
    // An SEC EDGAR hit carries neither field.
    expect(suffixForListing({ exchange: null, country: null })).toBeNull();
  });

  it("refuses to guess between venues that fit equally well", () => {
    // Without a country, "TSE" is Toronto or Tokyo.
    expect(suffixForListing({ exchange: "TSE", country: null })).toBeNull();
    // Both German venues answer to "FSX".
    expect(suffixForListing({ exchange: "FSX", country: "Germany" })).toBeNull();
  });

  it("leaves a venue it does not know unplaced", () => {
    expect(suffixForListing({ exchange: "Munich", country: "Germany" })).toBeNull();
    expect(suffixForListing({ exchange: "IDX", country: "Indonesia" })).toBeNull();
  });
});

describe("linking a search result to its listing", () => {
  it("suffixes a Canadian row", () => {
    expect(listingSymbol({ symbol: "VGRO", exchange: "TSX", country: "Canada" })).toBe("VGRO.TO");
  });

  it("leaves a US row, and a share class, exactly as they were", () => {
    expect(listingSymbol({ symbol: "VGRO", exchange: "NYSE", country: "United States" })).toBe("VGRO");
    expect(listingSymbol({ symbol: "BRK.B", exchange: "NYSE", country: "United States" })).toBe("BRK.B");
  });

  it("does not suffix a symbol twice", () => {
    expect(listingSymbol({ symbol: "VCN.TO", exchange: "TO", country: null })).toBe("VCN.TO");
  });
});

describe("search results, each opening the listing it names", () => {
  const row = (symbol: string, exchange: string | null, country: string | null) => ({
    symbol,
    name: `${symbol} on ${exchange}`,
    exchange,
    country,
  });

  it("opens the Toronto fund rather than the US ticker of the same name", () => {
    // The reported failure: choosing "VGRO — TSX" opened /stock/VGRO, a US
    // fund, priced in US dollars.
    const results = addressSearchResults([
      row("VGRO", "TSX", "Canada"),
      row("VGRO", "NYSE", "United States"),
    ]);
    expect(results.map((r) => r.symbol)).toEqual(["VGRO.TO", "VGRO"]);
  });

  it("shows a fund cross-listed on Cboe Canada once, as its Toronto listing", () => {
    const results = addressSearchResults([row("VCN", "TSX", "Canada"), row("VCN", "NEO", "Canada")]);
    expect(results.map((r) => r.symbol)).toEqual(["VCN.TO"]);
  });

  it("keeps a fund listed only on Cboe Canada", () => {
    const results = addressSearchResults([row("ABCD", "NEO", "Canada")]);
    expect(results.map((r) => r.symbol)).toEqual(["ABCD.NE"]);
  });

  it("drops a row it cannot place when the bare ticker belongs to a US listing", () => {
    // CASH, in the order the directory returns it. The Indonesian row cannot
    // be given a suffix, and following it bare would open Pathward Financial.
    const results = addressSearchResults([
      row("CASH", "IDX", "Indonesia"),
      row("CASH", "NASDAQ", "United States"),
      row("CASH", "TSX", "Canada"),
      row("CASH", "NEO", "Canada"),
      row("CASH", "BME", "Spain"),
      row("CASH", "IEX", "United States"),
    ]);
    expect(results.map((r) => r.symbol)).toEqual(["CASH", "CASH.TO", "CASH.MC"]);
  });

  it("keeps a row it cannot place when nothing else answers to that ticker", () => {
    const results = addressSearchResults([row("QQC0", "Munich", "Germany")]);
    expect(results.map((r) => r.symbol)).toEqual(["QQC0"]);
  });

  it("leaves an SEC EDGAR hit untouched", () => {
    const edgar = { symbol: "AAPL", name: "Apple Inc.", exchange: null, cik: "0000320193" };
    expect(addressSearchResults([edgar])).toEqual([edgar]);
  });
});

describe("the listing a bare ticker names", () => {
  it("is the US one when the ticker trades in the US", () => {
    // The directory lists TEC in Toronto first; TEC on its own is the US fund.
    const listings = [
      { symbol: "TEC", exchange: "TSX", country: "Canada" },
      { symbol: "TEC", exchange: "NEO", country: "Canada" },
      { symbol: "TEC", exchange: "NYSE", country: "United States" },
    ];
    expect(listingForBareTicker("tec", listings)?.exchange).toBe("NYSE");
  });

  it("is the first listing when none is in the US", () => {
    const listings = [
      { symbol: "QQC", exchange: "TSX", country: "Canada" },
      { symbol: "QQC", exchange: "NEO", country: "Canada" },
    ];
    expect(listingForBareTicker("QQC", listings)?.exchange).toBe("TSX");
  });

  /*
    The directory's order is not a ranking. Asked about three Canadian
    dividend ETFs it put Toronto first for VDY and XEI and Cboe Canada first
    for ZDV, where that fund trades so rarely that a year of history came back
    as a single print — one chart out of three drew a dot.
  */
  it("is the home exchange even when the directory lists the secondary venue first", () => {
    const listings = [
      { symbol: "ZDV", exchange: "NEO", country: "Canada" },
      { symbol: "ZDV", exchange: "TSX", country: "Canada" },
    ];
    expect(listingForBareTicker("ZDV", listings)?.exchange).toBe("TSX");
  });

  it("is the secondary venue when that is the only place it trades", () => {
    const listings = [{ symbol: "HBIT", exchange: "NEO", country: "Canada" }];
    expect(listingForBareTicker("HBIT", listings)?.exchange).toBe("NEO");
  });

  it("ignores listings of other tickers", () => {
    const listings = [{ symbol: "QQCC", exchange: "NASDAQ", country: "United States" }];
    expect(listingForBareTicker("QQC", listings)).toBeNull();
  });
});

describe("venues that carry another exchange's listings", () => {
  it("knows Cboe Canada from Toronto", () => {
    expect(isSecondaryVenue({ exchange: "NEO", country: "Canada" })).toBe(true);
    expect(isSecondaryVenue({ exchange: "Cboe Canada", country: "Canada" })).toBe(true);
    expect(isSecondaryVenue({ exchange: "TSX", country: "Canada" })).toBe(false);
  });

  it("treats a US listing and an unplaceable one as primary", () => {
    expect(isSecondaryVenue({ exchange: "NYSE", country: "United States" })).toBe(false);
    expect(isSecondaryVenue({ exchange: "SOME-NEW-VENUE", country: "Narnia" })).toBe(false);
  });
});
