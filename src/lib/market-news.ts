import { getNewsWithSource } from "./providers";
import type { NewsItem } from "./providers/types";

/**
 * Headlines for the dashboard, about companies the reader has a reason to
 * care about.
 *
 * There is no market-wide news feed in the free stack — every source here
 * answers per company — so a dashboard column has to choose which companies
 * to ask about. It asks about the ones the page is already talking about: a
 * reader's own watchlist when there is one, and otherwise the day's biggest
 * moves, which is the column immediately above it. That way a 9% fall and the
 * story behind it sit on the same screen.
 */

/** How many companies are asked about. Each one is a request. */
const MAX_SYMBOLS = 5;

/** Headlines taken from any single company, so five of them share the column. */
const PER_SYMBOL = 2;

/**
 * How old a headline may be and still be news.
 *
 * Thirty days, which is the window every company page already uses and the
 * window the provider itself is asked for. A fortnight reads better as "news"
 * but empties the column on any quiet stretch, and the date beside each
 * headline says how old it is anyway.
 */
const MAX_AGE_DAYS = 30;

export interface Headline extends NewsItem {
  /** The company it is about, so a reader can open the page as well as the article. */
  symbol: string;
}

export interface DashboardNews {
  items: Headline[];
  /** The companies asked about, in the order they were chosen. */
  symbols: string[];
  /** Which provider answered, for the "where this came from" line. */
  source: string | null;
  /** Why the list is empty, when it is. */
  state: "ok" | "no-symbols" | "nothing-recent" | "unavailable";
}

/**
 * Which companies to ask about.
 *
 * A watchlist is a statement of interest and beats anything inferred, so it
 * goes first. Movers come next — a reader looking at the biggest fall of the
 * day is usually looking for the reason. The healthiest list is the fallback
 * for a signed-out reader on a quiet day, so the column is never empty just
 * because nothing moved.
 */
export function pickNewsSymbols(sources: {
  watchlist?: string[];
  gainers?: string[];
  losers?: string[];
  healthiest?: string[];
}): string[] {
  const ordered = [
    ...(sources.watchlist ?? []),
    // One riser and one faller before the second of either: a column about
    // one company's good day is not a market column.
    ...interleave(sources.gainers ?? [], sources.losers ?? []),
    ...(sources.healthiest ?? []),
  ];

  const seen = new Set<string>();
  const picked: string[] = [];
  for (const raw of ordered) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    picked.push(symbol);
    if (picked.length === MAX_SYMBOLS) break;
  }
  return picked;
}

function interleave(a: string[], b: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}

/**
 * One column's worth of headlines from several companies' coverage.
 *
 * Deduplicated by link, because one wire story is syndicated under several
 * companies and the same piece twice reads as a broken page. Each company is
 * capped so the loudest week does not fill the column on its own.
 */
export function mergeHeadlines(
  bySymbol: { symbol: string; news: NewsItem[] }[],
  limit: number,
  now: Date = new Date(),
): Headline[] {
  const oldest = now.getTime() - MAX_AGE_DAYS * 86_400_000;
  const seen = new Set<string>();
  const all: Headline[] = [];

  for (const { symbol, news } of bySymbol) {
    let kept = 0;
    for (const item of news) {
      if (kept === PER_SYMBOL) break;
      const published = new Date(item.publishedAt).getTime();
      if (!Number.isFinite(published) || published < oldest || published > now.getTime() + 86_400_000) {
        continue;
      }
      const key = (item.url || item.headline).trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push({ ...item, symbol });
      kept++;
    }
  }

  return all
    .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
    .slice(0, limit);
}

/** Headlines for the companies given, newest first. Never throws. */
export async function getDashboardNews(
  symbols: string[],
  limit = 8,
): Promise<DashboardNews> {
  if (symbols.length === 0) {
    return { items: [], symbols, source: null, state: "no-symbols" };
  }

  const answers = await Promise.all(
    symbols.map(async (symbol) => {
      const { news, source } = await getNewsWithSource(symbol, 6).catch(() => ({
        news: [] as NewsItem[],
        source: null as string | null,
      }));
      return { symbol, news, source };
    }),
  );

  const items = mergeHeadlines(answers, limit);
  const source = answers.find((a) => a.news.length > 0)?.source ?? null;

  return {
    items,
    symbols,
    source,
    // "Nobody answered" and "nothing was written this fortnight" are different
    // things to tell a reader, and only the first is worth acting on.
    state: items.length > 0 ? "ok" : answers.some((a) => a.news.length > 0) ? "nothing-recent" : "unavailable",
  };
}
