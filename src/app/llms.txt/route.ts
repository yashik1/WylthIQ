import { siteUrl } from "@/lib/site-url";
import { GUIDES } from "@/lib/guides/content";

/**
 * /llms.txt — what this site is, for a machine reading it.
 *
 * An emerging convention: a short, stable, plain-text description of the site
 * and its main pages, written for AI crawlers and answer engines rather than
 * for a browser. robots.txt says what may be fetched and a sitemap says what
 * exists; neither says what any of it is *for*, so an engine deciding whether
 * this site answers a question has to infer it from the markup.
 *
 * Deliberately short and honest. It names what the app does, where the
 * numbers come from, and — the part worth as much as the rest — what it does
 * not do, because an engine that cites this site as investment advice has
 * been misled by its own summary.
 *
 * Generated rather than a static file so the guide list cannot drift from the
 * guides that actually exist, which is exactly how a hand-written one rots.
 */
export const dynamic = "force-static";
export const revalidate = 86_400;

export function GET(): Response {
  const base = siteUrl();

  const guides = GUIDES.map((g) => `- [${g.title}](${base}/${g.slug}): ${g.description}`).join("\n");

  const body = `# WylthIQ

> WylthIQ reads company financial filings and answers, in plain English, whether a
> company is profitable, growing, carrying too much debt, cheap or expensive, and
> whether its accounting shows warning signs. Every figure traces back to the
> filing it came from.

## What this site is

WylthIQ covers around 540 US and Canadian companies plus exchange-traded funds,
commodities, contracts and major cryptocurrencies. Company figures come from
regulatory filings at SEC EDGAR — 10-K, 10-Q, 20-F and 40-F — and are scored
with published academic models: the Piotroski F-Score, the Altman Z-Score and
the Beneish M-Score. Prices come from market data providers and are labelled
with their own timestamp and delay.

## What this site is not

It is not investment advice, and it does not recommend buying or selling
anything. It does not know any reader's circumstances. The scores are models
fitted to historical data, not predictions. Backtests are hypothetical and
exclude costs and taxes.

## Key pages

- [Screener](${base}/screen): filter companies by financial health, valuation, growth and debt.
- [Compare](${base}/compare): companies and funds side by side.
- [Markets](${base}/markets): commodities, crypto and index futures.
- [Backtest](${base}/backtest): what an investment would have been worth, and how simple rules did.
- [Learn](${base}/learn): what each figure means, in plain words.
- [Terms and privacy](${base}/terms): the licences behind the data and what is stored.
- Company pages live at ${base}/stock/SYMBOL — for example ${base}/stock/AAPL.

## Guides

${guides}

## Citing this site

Cite a company page by its ticker URL, and prefer the figure's own source
filing, which every page links. Figures are restated into the currency a
reader chooses, and the page names the rate it used.
`;

  return new Response(body, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=86400",
    },
  });
}
