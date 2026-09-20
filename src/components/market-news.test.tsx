import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MarketNews } from "./market-news";
import type { DashboardNews, Headline } from "@/lib/market-news";

/**
 * The dashboard's news column, rendered with headlines in it.
 *
 * The panel only fills when a news provider answers, and no key is set on a
 * development machine — so the populated state is the one nobody sees locally
 * and readers see every day. These render it outright.
 */

const headline = (over: Partial<Headline> = {}): Headline => ({
  id: "1",
  symbol: "NVDA",
  headline: "Nvidia lifts its outlook after a record quarter",
  summary: null,
  source: "Reuters",
  url: "https://example.com/nvda",
  publishedAt: "2026-09-20T09:00:00Z",
  imageUrl: null,
  ...over,
});

const news = (over: Partial<DashboardNews> = {}): DashboardNews => ({
  items: [headline()],
  symbols: ["NVDA", "F"],
  source: "Finnhub",
  state: "ok",
  ...over,
});

describe("the news column", () => {
  it("links the story out and the ticker in", () => {
    const html = renderToStaticMarkup(<MarketNews news={news()} />);

    expect(html).toContain("Nvidia lifts its outlook after a record quarter");
    // The article opens at the publisher, in a new tab, without passing a referrer.
    expect(html).toContain('href="https://example.com/nvda"');
    expect(html).toContain('rel="noreferrer noopener"');
    // The ticker goes to this site's own page for the company.
    expect(html).toContain('href="/stock/NVDA"');
  });

  it("says which companies it asked about, and who answered", () => {
    const html = renderToStaticMarkup(<MarketNews news={news()} />);
    expect(html).toContain("NVDA, F");
    expect(html).toContain("From Finnhub");
  });

  /*
    A company nobody wrote about this month is the ordinary case, and it is not
    a setup problem — so it must not be answered with setup instructions.
  */
  it("treats a quiet month as ordinary", () => {
    const html = renderToStaticMarkup(
      <MarketNews news={news({ items: [], state: "nothing-recent" })} />,
    );
    expect(html).toContain("Nothing in the last 30 days");
    expect(html).not.toContain("FINNHUB_API_KEY");
  });

  it("names the key when no source could answer at all", () => {
    const html = renderToStaticMarkup(
      <MarketNews news={news({ items: [], source: null, state: "unavailable" })} />,
    );
    expect(html).toContain("FINNHUB_API_KEY");
  });

  /*
    Nothing to ask about means a deployment with no companies loaded, which
    the dashboard already explains further up. A second empty panel below it
    would just repeat the point.
  */
  it("renders nothing when there was nobody to ask about", () => {
    const html = renderToStaticMarkup(
      <MarketNews news={news({ items: [], symbols: [], source: null, state: "no-symbols" })} />,
    );
    expect(html).toBe("");
  });
});
