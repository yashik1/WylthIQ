import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FundFacts } from "./fund-facts";
import { FundHoldingsNote } from "./fund-holdings-note";
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

describe("the fund card's holdings, from the manager's own list", () => {
  const listed: EtfProfile = {
    ...profile,
    holdingCount: 230,
    topHoldings: Array.from({ length: 30 }, (_, i) => ({
      name: i === 0 ? "ROYAL BANK OF CANADA" : `HOLDING ${i}`,
      symbol: i === 0 ? "RY.TO" : null,
      weight: 0.08 - i * 0.002,
      detail: null,
      sector: "Financials",
    })),
    source: { name: "iShares Canada", url: "https://www.blackrock.com/ca", asOf: "2026-10-20", publishedByManager: true },
  };
  const html = renderToStaticMarkup(
    <FundFacts
      profile={listed}
      quote={null}
      income={null}
      range={null}
      since={null}
      analytics={null}
      currency="CAD"
      filesWithSec={false}
    />,
  );

  it("lists them in a table, with a sector column and how many there are in all", () => {
    expect(html).toContain("The 30 largest of 230 holdings");
    expect(html).toContain(">Sector<");
    expect(html).toContain("Show all 30 largest");
  });

  it("links a holding to its page here", () => {
    expect(html).toContain('href="/stock/RY.TO"');
  });
});

describe("the note on where a fund's holdings come from", () => {
  const note = (props: Parameters<typeof FundHoldingsNote>[0]) => renderToStaticMarkup(<FundHoldingsNote {...props} />);
  const bmo = { name: "BMO Global Asset Management", url: "https://www.bmogam.com" };

  it("points below when a filing or a manager's list is on the page", () => {
    expect(note({ filed: true, publishedBy: null, manager: null })).toContain("matter of public record");
    expect(note({ filed: false, publishedBy: "iShares Canada", manager: null })).toContain("as iShares Canada publishes it");
  });

  it("names the manager and links there when neither is", () => {
    const html = note({ filed: false, publishedBy: null, manager: bmo });
    expect(html).toContain("BMO Global Asset Management doesn’t publish this fund’s holdings");
    expect(html).toContain('href="https://www.bmogam.com"');
    expect(html).toContain('rel="noopener noreferrer"');
  });

  it("falls back to the price history for an unknown manager", () => {
    expect(note({ filed: false, publishedBy: null, manager: null })).toContain("Price history below still applies.");
  });
});
