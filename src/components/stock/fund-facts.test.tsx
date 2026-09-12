import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FundFacts } from "./fund-facts";
import type { EtfProfile } from "@/lib/providers/alphavantage";
import type { SinceInception } from "@/lib/etf/since-inception";

/**
 * The whole-life return on a fund card.
 *
 * What is worth pinning is that the figure never stands alone: beside a
 * dividend yield, a price-only return is missing much of what a holder
 * actually received, and a window that starts years after the launch is not
 * the life of the fund. Both have to be readable, not merely computed.
 */

const profile: EtfProfile = {
  expenseRatio: 0.0039,
  dividendYield: 0.041,
  turnover: null,
  inceptionDate: "2011-10-21",
  leveraged: false,
  sectors: [],
  holdings: [],
  topHoldings: [],
  holdingCount: null,
  netAssets: null,
  netAssetsCurrency: null,
  source: { name: "BMO", url: null, asOf: null, publishedByManager: true },
};

const since: SinceInception = {
  inceptionDate: "2011-10-21",
  from: "2012-01-23",
  to: "2026-09-11",
  totalReturn: 1.131,
  perYear: 0.0531,
  years: 14.6,
  includesDividends: false,
  partial: false,
};

const render = (over: Partial<SinceInception> | null) =>
  renderToStaticMarkup(
    <FundFacts
      profile={profile}
      quote={null}
      income={null}
      range={null}
      since={over === null ? null : { ...since, ...over }}
      analytics={null}
      currency="CAD"
      filesWithSec={false}
    />,
  );

describe("the fund card's since-inception figure", () => {
  it("states the return and the pace it works out at", () => {
    const html = render({});
    expect(html).toContain("Since inception");
    expect(html).toContain("+113%");
    expect(html).toContain("+5.3% a year");
  });

  it("says when the prices behind it leave distributions out", () => {
    expect(render({ includesDividends: false })).toContain("Price only");
    expect(render({ includesDividends: true })).toContain("Distributions are reinvested");
  });

  it("names the window when the price history starts after the launch", () => {
    const html = render({ partial: true, from: "2015-01-05" });
    expect(html).toContain("earliest price on record");
    expect(html).toContain("Jan 5, 2015");
  });

  it("claims no yearly pace for a fund younger than a year", () => {
    const html = render({ perYear: null, years: 0.4 });
    expect(html).not.toContain("a year over");
  });

  it("does not call it \"since inception\" when the launch date is unknown", () => {
    const html = render({ inceptionDate: null, partial: false });

    expect(html).toContain("Full history");
    expect(html).not.toContain("Since inception");
    expect(html).toContain("does not publish a launch date");
  });

  it("is absent rather than blank when there is no figure", () => {
    expect(render(null)).not.toContain("Since inception");
  });
});
