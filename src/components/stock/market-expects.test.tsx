import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketExpects } from "./market-expects";
import type { ImpliedExpectations } from "@/lib/scoring/expectations";
import type { ShortInterest } from "@/lib/signals/short-interest";
import type { InstitutionalOwnership } from "@/lib/signals/institutional";
import type { AnalystView } from "@/lib/signals/analysts";

/**
 * The expectations section, rendered.
 *
 * This is the first thing in the app that reports something other than a filed
 * figure, so the cases here are mostly about register rather than layout: that
 * the section says plainly it is not filing-derived, that it disappears rather
 * than sitting empty, and above all that it never crosses from stating an
 * expectation into endorsing one.
 */

const expectations = (over: Partial<ImpliedExpectations> = {}): ImpliedExpectations => ({
  impliedGrowth: 0.124,
  growthLow: 0.101,
  growthHigh: 0.148,
  discountLow: 0.08,
  discountHigh: 0.1,
  terminalGrowth: 0.025,
  horizonYears: 10,
  baseFreeCashFlow: 99_000_000_000,
  fiscalYear: 2025,
  enterpriseValue: 3_400_000_000_000,
  actualGrowth: 0.061,
  actualYears: 5,
  ...over,
});

const shortInterest = (over: Partial<ShortInterest> = {}): ShortInterest => ({
  shares: 116_327_753,
  previousShares: 141_606_163,
  change: -0.1785,
  percentOfShares: 0.0078,
  daysToCover: 2.42,
  settlementDate: "2026-08-14",
  ...over,
});

const ownership = (over: Partial<InstitutionalOwnership> = {}): InstitutionalOwnership => ({
  quarter: "2026-03-31",
  holderCount: 6011,
  totalShares: 9_359_437_941,
  percentOfShares: 0.635,
  holders: [
    { name: "BlackRock, Inc.", cik: "0002012383", shares: 1_144_695_425, value: 2.9e11, change: 0.012 },
    { name: "VANGUARD CAPITAL MANAGEMENT LLC", cik: "0002100119", shares: 953_847_648, value: 2.4e11, change: -0.004 },
    { name: "STATE STREET CORP", cik: "0000093751", shares: 602_341_409, value: 1.5e11, change: null },
  ],
  ...over,
});

const analysts = (over: Partial<AnalystView> = {}): AnalystView => ({
  strongBuy: 13,
  buy: 18,
  hold: 11,
  sell: 2,
  strongSell: 0,
  total: 44,
  targetPrice: 324.45,
  targetLow: null,
  targetHigh: null,
  asOf: "2026-08-01",
  source: "Finnhub",
  ...over,
});

const render = (
  e: ImpliedExpectations | null,
  s: ShortInterest | null = null,
  o: InstitutionalOwnership | null = null,
  a: AnalystView | null = null,
) =>
  renderToStaticMarkup(
    <MarketExpects
      expectations={e}
      analysts={a}
      shortInterest={s}
      ownership={o}
      currentPrice={314.2}
      currency="USD"
    />,
  );

describe("the expectations section", () => {
  it("states the implied rate and the delivered one together", () => {
    const html = render(expectations());

    expect(html).toContain("12%");
    expect(html).toContain("6%");
    expect(html).toContain("grow");
  });

  /*
    The section's whole reason for existing as a section. A reader who has been
    told every figure on this page traces to a document needs to be told, once
    and unmissably, that this part does not.
  */
  it("says plainly that none of it comes from a filing", () => {
    const html = render(expectations());

    expect(html).toContain("is a figure this company reported about itself");
    expect(html).toContain("does not endorse");
  });

  it("names the discount rate it rests on, and the band that produces", () => {
    const html = render(expectations());

    expect(html).toContain("8%");
    expect(html).toContain("10%");
    expect(html).toContain("2.5%");
  });

  /*
    An empty section makes its own claim — that there was nothing to say — and
    for a small or recently listed company the honest state is silence, not a
    heading over a blank card.
  */
  it("renders nothing at all when there is nothing to report", () => {
    expect(render(null, null, null, null)).toBe("");
  });

  it("still appears when only one of its panels has something to say", () => {
    expect(render(null, shortInterest())).toContain("What short sellers are betting");
    expect(render(null, shortInterest())).toContain("is a figure this company reported about itself");
    expect(render(expectations(), null)).toContain("What the price assumes");
  });

  it("says shrink rather than a negative growth rate in words", () => {
    const html = render(expectations({ impliedGrowth: -0.043, growthLow: -0.06, growthHigh: -0.02 }));

    expect(html).toContain("shrink");
    expect(html).toContain("4%");
  });

  it("explains the blank rather than printing a growth rate from a negative base", () => {
    const html = render(expectations({ actualGrowth: null, actualYears: 0 }));

    expect(html).toContain("negative earlier in this period");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });

  it("prints no invalid numbers for an extreme but legal set of figures", () => {
    const html = render(
      expectations({ impliedGrowth: 0.599, actualGrowth: -0.19, baseFreeCashFlow: 1 }),
    );

    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("undefined");
  });
});

describe("short interest", () => {
  /*
    The lag is the thing most likely to mislead. FINRA collects this twice a
    month and publishes it about eight days later, so the position shown is
    always a fortnight or so old — a reader who reads it as live is reading a
    stale number as a current one.
  */
  it("leads with the date the position was measured", () => {
    const html = render(null, shortInterest());

    expect(html).toContain("Measured on");
    expect(html).toMatch(/not a live position/i);
  });

  it("says what a short position is before showing a number", () => {
    const text = render(null, shortInterest()).replace(/<[^>]*>/g, " ");

    expect(text).toMatch(/borrowed and sold/i);
    expect(text).toMatch(/expecting to buy them back cheaper/i);
  });

  /*
    A rising short position is not bad news about the company, and a falling
    one is not good news — but a reader will read them that way, so the panel
    has to say that some of this is hedging rather than a bet on direction.
  */
  it("admits that not all of it is a bet against the company", () => {
    expect(render(null, shortInterest())).toMatch(/hedging/i);
  });

  it("falls back to a share count when the percentage cannot be worked out", () => {
    const html = render(null, shortInterest({ percentOfShares: null }));

    expect(html).toContain("116,327,753");
    expect(html).not.toContain("NaN");
  });

  it("survives a first report, with nothing to compare against", () => {
    const html = render(null, shortInterest({ previousShares: null, change: null, daysToCover: null }));

    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
    expect(html).not.toContain("undefined");
  });

  it("names shares outstanding rather than implying it is free float", () => {
    expect(render(null, shortInterest())).toMatch(/not free float/i);
  });
});

describe("institutional ownership", () => {
  /*
    The oldest thing in the section by a wide margin. 13F is due 45 days after
    the quarter it describes, so the freshest possible figure is six weeks old
    and the usual one is three months old — a manager may have sold the whole
    position the day after the quarter closed. The heading is in the past
    tense for that reason, and the tense is the thing worth pinning.
  */
  it("speaks in the past tense about a quarterly snapshot", () => {
    const html = render(null, null, ownership());

    expect(html).toContain("Who owned it");
    expect(html).toMatch(/not a current holding/i);
    expect(html).toMatch(/45 days/);
  });

  it("counts every filer, not only the ones listed", () => {
    const html = render(null, null, ownership());

    expect(html).toContain("6,011");
    expect(html).toContain("BlackRock, Inc.");
  });

  /*
    Index funds hold large stakes in nearly every company by construction, so
    a reader who takes BlackRock's presence as a view on this company has
    been misled by the list rather than informed by it.
  */
  it("says an index fund's presence is not a view on the company", () => {
    expect(render(null, null, ownership())).toMatch(/index funds/i);
  });

  it("names what 13F does not cover", () => {
    const text = render(null, null, ownership()).replace(/<[^>]*>/g, " ");

    expect(text).toMatch(/short positions, bonds and foreign holdings/i);
  });

  /*
    A holder absent last quarter may have opened the position, or may simply
    not have been among the ten kept. The data cannot tell those apart, so a
    dash is the honest output and "+100%" would be an invention.
  */
  it("shows a dash, not a change, for a holder with no prior quarter", () => {
    const html = render(null, null, ownership());

    expect(html).toContain("—");
    expect(html).not.toContain("NaN");
  });

  it("stays quiet when the ingest has run but found no holders", () => {
    expect(render(null, null, ownership({ holders: [] }))).toBe("");
  });

  it("survives a company with no share count to measure against", () => {
    const html = render(null, null, ownership({ percentOfShares: null, totalShares: null }));

    expect(html).not.toContain("NaN");
    expect(html).not.toContain("undefined");
  });
});

describe("analyst ratings", () => {
  /*
    The panel closest to being advice, and the reason it shows a distribution
    rather than a consensus word. "Buy" printed alone in the page's own
    typeface reads as this app saying buy, whoever it is attributed to.
  */
  it("reports a distribution rather than a verdict", () => {
    const text = render(null, null, null, analysts()).replace(/<[^>]*>/g, " ");

    // Every rating word appears attached to a count of who said it, never
    // asserted on its own.
    expect(text.replace(/\s+/g, " ")).toContain("13 say strong buy");
    expect(text.replace(/\s+/g, " ")).toContain("11 say hold");
    expect(text).toMatch(/Their views, not this site/i);
  });

  it("says analysts are often wrong, and that the split is the point", () => {
    const text = render(null, null, null, analysts()).replace(/<[^>]*>/g, " ");

    expect(text).toMatch(/wrong often/i);
    expect(text).toMatch(/how much they agree/i);
  });

  /*
    Sell ratings are rare across the whole market, so a company with none has
    not been endorsed — it has been covered normally. Without saying so, an
    all-buy bar reads as unanimous approval.
  */
  it("warns that coverage skews optimistic", () => {
    expect(render(null, null, null, analysts())).toMatch(/skews/i);
  });

  it("omits empty rating buckets rather than printing zeroes", () => {
    const text = render(null, null, null, analysts()).replace(/<[^>]*>/g, " ");
    expect(text).not.toMatch(/0 say strong sell/i);
  });

  /*
    Finnhub's free tier serves the distribution but not price targets, so the
    target block has to disappear rather than render blank rows.
  */
  it("drops the target block entirely when no target was published", () => {
    const html = render(null, null, null, analysts({ targetPrice: null }));

    expect(html).not.toMatch(/Average price target/);
    expect(html).not.toContain("NaN");
    expect(html).toMatch(/44/);
  });

  it("shows the gap to today's price without calling it upside", () => {
    const text = render(null, null, null, analysts()).replace(/<[^>]*>/g, " ");

    expect(text).toMatch(/Against today/i);
    expect(text).not.toMatch(/\bupside\b/i);
  });

  it("survives a company where every analyst agrees", () => {
    const html = render(
      null, null, null,
      analysts({ strongBuy: 0, buy: 44, hold: 0, sell: 0, strongSell: 0 }),
    );

    expect(html).not.toContain("NaN");
    expect(html).not.toContain("Infinity");
  });
});

describe("the register it has to hold", () => {
  /*
    The parallel to scoring.test.ts, which bans this vocabulary in the health
    report. That test scopes itself to buildHealthReport and so would never
    fire on this component — but this is the panel most likely to be read as a
    recommendation, so it needs its own guard.

    "fair value", "overvalued" and "undervalued" are in the list for a reason
    beyond tone: each asserts the market has got the price wrong, which is a
    prediction dressed as a measurement. The app reports what the price
    assumes; it takes no view on whether the assumption is correct.
  */
  /*
    Two lists, because one blunt one was passing by luck of vocabulary.

    The first attempt banned "buy" and "sell" outright, as scoring.test.ts
    does for the health report. That works there and cannot work here: the
    short-interest panel has to explain that a short seller borrows shares,
    sells them and buys them back, and there are no other words for it. A ban
    that has to be switched off for the one panel most likely to be misread is
    not protecting anything.

    So: words that assert a verdict on the price are banned everywhere,
    because none of them has an innocent use. Plain buy/sell/hold are banned
    in the panel where they would only ever be advice.
  */
  const verdict =
    /\b(invest in|recommend|should own|target price|fair value|over-?valued|under-?valued|mispriced|bargain|worth (buying|selling)|you should|time to (buy|sell))\b/i;

  const advice = /\b(buy|sell|hold|expensive|cheap)\b/i;

  const strip = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'");

  it("never passes a verdict on the price, in any panel", () => {
    const fixtures: [ImpliedExpectations | null, ShortInterest | null][] = [
      [expectations(), null],
      [expectations({ impliedGrowth: -0.15, growthLow: -0.19, growthHigh: -0.11 }), null],
      [null, shortInterest()],
      [null, shortInterest({ percentOfShares: 0.31, change: 0.62 })],
      [expectations(), shortInterest()],
    ];

    for (const [e, s] of fixtures) expect(strip(render(e, s))).not.toMatch(verdict);
    expect(strip(render(null, null, ownership()))).not.toMatch(verdict);
    // The analyst panel is exempt from the plain buy/sell ban for the same
    // reason short interest is — it reports the words other people published —
    // but it must still never pass a verdict of its own.
    expect(strip(render(null, null, null, analysts()))).not.toMatch(verdict);
  });

  /*
    The short-interest panel is deliberately absent from this one. "Borrowed
    and sold, then bought back" is what a short position IS, and describing it
    is not advising anyone to do it.
  */
  it("never tells the reader what to think about the price", () => {
    for (const fixture of [
      expectations(),
      expectations({ impliedGrowth: -0.15, growthLow: -0.19, growthHigh: -0.11 }),
      expectations({ actualGrowth: null, actualYears: 0 }),
      expectations({ actualGrowth: 0.4, impliedGrowth: 0.02 }),
    ]) {
      expect(strip(render(fixture, null))).not.toMatch(advice);
    }
  });

  it("calls the figure an assumption rather than a forecast", () => {
    const text = strip(render(expectations()));

    expect(text).toMatch(/assume/i);
    expect(text).toMatch(/not a forecast/i);
  });
});
