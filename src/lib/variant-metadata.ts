import type { Metadata } from "next";
import { firstThatFits, fitDescription } from "./page-title";
import { describeFilters } from "./screen-summary";
import { PRESETS, SORTS, type ScreenFilters, type SortKey } from "./screener";

/**
 * Titles and descriptions for the pages a query string makes.
 *
 * /compare?symbols=…, /backtest?symbol=… and /screen?preset=… each point
 * search engines at their main page with a canonical link, which is right —
 * there is one form underneath — but all of them also shared that page's
 * title and description, so a site audit counted 262 duplicate titles and 264
 * duplicate descriptions. Each now says what it shows: "AAPL vs MSFT vs
 * GOOGL", "What if you had invested $10,000 in AAPL in 2015?".
 *
 * Null where the URL asks for nothing in particular, so the page keeps its
 * own title.
 */

export interface PageText {
  title: string;
  description: string;
}

/**
 * A page's metadata with a variant's title and description in place.
 *
 * The share preview gets them too, keeping what the root layout says about the
 * site: setting `openGraph` on a page replaces the layout's whole object, so
 * the site name and type are restated rather than lost.
 */
export function withVariant(base: Metadata, text: PageText | null): Metadata {
  if (!text) return base;
  return { ...base, ...text, openGraph: { type: "website", siteName: "WylthIQ", ...text } };
}

function listed(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function compareText(symbols: string[]): PageText | null {
  if (symbols.length < 2) return null;
  const all = symbols.join(" vs ");
  const title = firstThatFits(
    `${all} — side by side`,
    all,
    `${symbols.slice(0, 3).join(" vs ")} and ${symbols.length - 3} more`,
  );
  const names = listed(symbols);
  return {
    title,
    description: fitDescription(
      `${names} compared side by side: financial health, valuation, growth and price performance, from their own filings and market data.`,
      `${names} compared: health, valuation, growth and performance.`,
    ),
  };
}

const WHOLE_DOLLARS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function calendarDate(iso: string): string | null {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
}

export function backtestText(input: { symbol: string; start: string; amount: number; name?: string | null }): PageText | null {
  const symbol = input.symbol.trim().toUpperCase();
  const on = /^\d{4}-\d{2}-\d{2}$/.test(input.start) ? calendarDate(input.start) : null;
  if (!symbol || !on) return null;
  const year = input.start.slice(0, 4);
  const amount = WHOLE_DOLLARS.format(input.amount > 0 && Number.isFinite(input.amount) ? input.amount : 10_000);
  const subject = input.name ? `${input.name} (${symbol})` : symbol;
  return {
    title: firstThatFits(
      `What if you had invested ${amount} in ${symbol} in ${year}?`,
      `${amount} in ${symbol} since ${year}`,
      `${symbol} since ${year}`,
    ),
    description: fitDescription(
      `What ${amount} put into ${subject} on ${on} would be worth today, with and without dividends reinvested, and how well-known trading rules would have done with it.`,
      `What ${amount} put into ${subject} on ${on} would be worth today, and how trading rules would have done.`,
      `What ${amount} put into ${symbol} on ${on} would be worth today, and how trading rules would have done.`,
    ),
  };
}

export function screenText(filters: ScreenFilters, page = 1): PageText | null {
  const summary = describeFilters(filters);
  const sorted = filters.sort && filters.sort !== "health" ? SORTS[filters.sort as SortKey]?.label : null;
  const nothingAsked = summary === "All companies" && !sorted && page <= 1;
  if (nothingAsked) return null;

  const pageNote = page > 1 ? `, page ${page}` : "";
  const head = `${summary}${sorted ? ` · ${sorted.toLowerCase()}` : ""}`;
  const title = firstThatFits(
    `Stock screener: ${head}${pageNote}`,
    `Screener: ${head}${pageNote}`,
    `Screener: ${summary}${pageNote}`,
  );
  const preset = filters.preset ? PRESETS[filters.preset] : null;
  const lead = preset ? preset.description : `US and Canadian companies matching ${summary}.`;
  return {
    title,
    description: fitDescription(
      `${lead} Ranked from their own filings${sorted ? `, ${sorted.toLowerCase()}` : ""}${page > 1 ? `, page ${page}` : ""}.`,
      lead,
    ),
  };
}

export function screenBacktestText(input: { start: string; topN: number }): PageText | null {
  const on = /^\d{4}-\d{2}-\d{2}$/.test(input.start) ? calendarDate(input.start) : null;
  if (!on) return null;
  const year = input.start.slice(0, 4);
  return {
    title: firstThatFits(
      `How the screener's top ${input.topN} did since ${year}`,
      `Screener's top ${input.topN} since ${year}`,
    ),
    description: fitDescription(
      `What buying the ${input.topN} healthiest-rated companies on ${on}, and rebalancing every year, would have returned against the market since.`,
      `The ${input.topN} healthiest-rated companies from ${on}, rebalanced yearly, against the market.`,
    ),
  };
}
