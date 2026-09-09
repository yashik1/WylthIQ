import { describe, expect, it } from "vitest";
import { NportReader, assetLabel, countryLabel, parseNport } from "./nport";

/**
 * What matters about the N-PORT parser.
 *
 * Not that it extracts a field — that is one regular expression and it either
 * works or the whole thing is empty. What is worth pinning is the handful of
 * decisions where a plausible-looking implementation would be quietly wrong:
 * aggregates taken over the capped list rather than the whole portfolio, "N/A"
 * treated as a country, a short position sorted to the bottom by its negative
 * value, and an ampersand rendered as `&amp;` in a company's name.
 *
 * The fixture is shaped from a real Invesco QQQ filing, cut down to the cases
 * that matter and with a short position and a foreign holding added.
 */

const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<edgarSubmission xmlns="http://www.sec.gov/edgar/nport">
  <headerData>
    <submissionType>NPORT-P</submissionType>
  </headerData>
  <formData>
    <genInfo>
      <regName>Invesco QQQ Trust, Series 1</regName>
      <seriesName>Invesco QQQ Trust, Series 1</seriesName>
      <seriesId>S000101292</seriesId>
      <repPdEnd>2026-09-30</repPdEnd>
      <repPdDate>2026-06-30</repPdDate>
    </genInfo>
    <fundInfo>
      <totAssets>492478331786.57</totAssets>
      <totLiabs>2375151844.91</totLiabs>
      <netAssets>490103179941.66</netAssets>
      <returnInfo>
        <monthlyTotReturn classId="C000271435" rtn1="15.65603200" rtn2="10.59584200" rtn3="-0.21238000"/>
      </returnInfo>
    </fundInfo>
    <invstOrSecs>
      <invstOrSec>
        <name>Procter &amp; Gamble Co</name>
        <title>Procter &amp; Gamble Co</title>
        <cusip>742718109</cusip>
        <identifiers><isin value="US7427181091"/></identifiers>
        <valUSD>500.00000000</valUSD>
        <pctVal>50.000000</pctVal>
        <payoffProfile>Long</payoffProfile>
        <assetCat>EC</assetCat>
        <invCountry>US</invCountry>
      </invstOrSec>
      <invstOrSec>
        <name>Coca-Cola Europacific Partners PLC</name>
        <cusip>G25839104</cusip>
        <identifiers><isin value="GB00BDCPN049"/></identifiers>
        <valUSD>300.00000000</valUSD>
        <pctVal>30.000000</pctVal>
        <payoffProfile>Long</payoffProfile>
        <assetCat>EC</assetCat>
        <invCountry>GB</invCountry>
      </invstOrSec>
      <invstOrSec>
        <name>Index Future Short</name>
        <cusip>N/A</cusip>
        <valUSD>-900.00000000</valUSD>
        <pctVal>-90.000000</pctVal>
        <payoffProfile>Short</payoffProfile>
        <assetCat>DE</assetCat>
        <invCountry>N/A</invCountry>
      </invstOrSec>
      <invstOrSec>
        <title>Invesco Government Money Market Fund</title>
        <valUSD>100.00000000</valUSD>
        <pctVal>10.000000</pctVal>
        <payoffProfile>N/A</payoffProfile>
        <assetCat>STIV</assetCat>
        <invCountry>US</invCountry>
      </invstOrSec>
    </invstOrSecs>
  </formData>
</edgarSubmission>`;

describe("reading the filing", () => {
  it("takes the fund's own name and portfolio date, not the filing date", () => {
    const p = parseNport(FIXTURE)!;
    expect(p.seriesName).toBe("Invesco QQQ Trust, Series 1");
    expect(p.registrantName).toBe("Invesco QQQ Trust, Series 1");
    // repPdDate is what the numbers describe; repPdEnd is the quarter they sit in.
    expect(p.asOf).toBe("2026-06-30");
  });

  it("reads net assets, which is what every weight is a share of", () => {
    const p = parseNport(FIXTURE)!;
    expect(p.netAssets).toBeCloseTo(490103179941.66, 2);
    expect(p.totalAssets).toBeCloseTo(492478331786.57, 2);
  });

  it("decodes entities, so Procter & Gamble is not Procter &amp; Gamble", () => {
    const p = parseNport(FIXTURE)!;
    expect(p.holdings.map((h) => h.name)).toContain("Procter & Gamble Co");
  });

  it("falls back to title for a position filed without a name", () => {
    const p = parseNport(FIXTURE)!;
    expect(p.holdings.map((h) => h.name)).toContain("Invesco Government Money Market Fund");
  });

  it("returns null for a document that is not an N-PORT", () => {
    expect(parseNport("<html><body>Not a filing</body></html>")).toBeNull();
    // An empty portfolio and a failed fetch must not render the same way.
    expect(parseNport("")).toBeNull();
  });
});

describe("the cases a plausible implementation gets wrong", () => {
  it('treats "N/A" as no answer rather than as a country', () => {
    const p = parseNport(FIXTURE)!;
    const short = p.holdings.find((h) => h.name === "Index Future Short")!;
    expect(short.country).toBeNull();
    expect(short.cusip).toBeNull();
    expect(p.byCountry.find((b) => b.key === "N/A")).toBeUndefined();
    expect(p.byCountry.find((b) => b.label === "Unknown")).toBeDefined();
  });

  it("sorts by size of position, so a short is not buried by its negative value", () => {
    const p = parseNport(FIXTURE)!;
    // -900 is the largest position in the fund and belongs at the top.
    expect(p.holdings[0].name).toBe("Index Future Short");
    expect(p.holdings[0].isShort).toBe(true);
    expect(p.holdings[1].name).toBe("Procter & Gamble Co");
  });

  it("aggregates over every position, not over the ones it returns", () => {
    const p = parseNport(FIXTURE, { limit: 1 })!;

    expect(p.holdings).toHaveLength(1);
    // Four positions were read even though one was returned.
    expect(p.holdingCount).toBe(4);
    // And the breakdowns still describe the whole fund: capping first would
    // have reported this as 100% equity derivatives.
    expect(p.byAsset.map((b) => b.key).sort()).toEqual(["DE", "EC", "STIV"]);
    expect(p.byAsset.find((b) => b.key === "EC")!.percent).toBeCloseTo(80, 6);
    expect(p.byCountry.find((b) => b.key === "US")!.percent).toBeCloseTo(60, 6);
  });

  it("counts a position with no name toward the total it reports", () => {
    // holdingCount is what the page says the fund holds, so it must count the
    // filed positions rather than the parsed ones.
    const p = parseNport(FIXTURE, { limit: 100 })!;
    expect(p.holdingCount).toBe(4);
    expect(p.holdings).toHaveLength(4);
  });

  it("sums the top ten by weight, including a negative one", () => {
    const p = parseNport(FIXTURE)!;
    expect(p.topTenPercent).toBeCloseTo(0, 6);
  });

  it("reads the three monthly returns in filed order", () => {
    const p = parseNport(FIXTURE)!;
    expect(p.monthlyReturns).toEqual([15.656032, 10.595842, -0.21238]);
  });
});

describe("labels", () => {
  it("spells out the codes it knows", () => {
    expect(assetLabel("EC")).toBe("Shares");
    expect(assetLabel("STIV")).toBe("Cash and short-term");
  });

  it("shows an unknown code rather than inventing a label for it", () => {
    expect(assetLabel("ZZZ")).toBe("ZZZ");
    expect(assetLabel(null)).toBe("Unclassified");
  });

  it("names countries from the runtime's own tables", () => {
    expect(countryLabel("US")).toBe("United States");
    expect(countryLabel("GB")).toBe("United Kingdom");
    expect(countryLabel(null)).toBe("Unknown");
  });
});

describe("reading it in pieces", () => {
  /*
    The property that makes streaming safe to rely on.

    The reader exists so a twenty-megabyte bond filing never has to be held in
    memory, which only helps if it gives the same answer as reading the whole
    thing. Chunked at every size from one byte upward, so the boundary lands
    inside a tag name, inside an attribute, between the two halves of a
    position, and everywhere else it could land.
  */
  const whole = parseNport(FIXTURE)!;

  for (const size of [1, 7, 64, 500, 5000]) {
    it(`gives the same answer in ${size}-character chunks`, () => {
      const reader = new NportReader();
      for (let i = 0; i < FIXTURE.length; i += size) {
        reader.push(FIXTURE.slice(i, i + size));
      }
      expect(reader.finish()).toEqual(whole);
    });
  }

  it("keeps aggregates over positions it has already discarded", () => {
    // A limit below the number of positions forces the reader to drop some as
    // it goes. What it drops must still be counted in the totals.
    const reader = new NportReader({ limit: 1 });
    for (let i = 0; i < FIXTURE.length; i += 13) reader.push(FIXTURE.slice(i, i + 13));
    const p = reader.finish()!;

    expect(p.holdings).toHaveLength(1);
    expect(p.holdingCount).toBe(4);
    expect(p.byAsset.find((b) => b.key === "EC")!.percent).toBeCloseTo(80, 6);
    expect(p.byCountry.find((b) => b.key === "US")!.percent).toBeCloseTo(60, 6);
  });

  it("still reports a portfolio for a filing with no positions at all", () => {
    const empty = FIXTURE.replace(/<invstOrSecs>[\s\S]*<\/invstOrSecs>/, "<invstOrSecs></invstOrSecs>");
    const p = parseNport(empty)!;
    expect(p.seriesName).toBe("Invesco QQQ Trust, Series 1");
    expect(p.holdingCount).toBe(0);
    expect(p.holdings).toEqual([]);
    expect(p.topTenPercent).toBeNull();
  });
});
