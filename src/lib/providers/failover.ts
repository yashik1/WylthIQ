import type { Bar, NewsItem, Quote, Timeframe } from "./types";
import { classifyProviderError, withTimeout, type ProviderErrorCategory } from "./errors";

/**
 * Failover across price providers, with a short in-process cache.
 *
 * Every free tier has a ceiling, so relying on one makes charts break the moment
 * it is reached. Requests fall through the chain until a provider answers.
 *
 * Every failure moves to the next provider, including "this symbol has no data".
 * That last one used to end the search, on the reasoning that an unknown ticker
 * should not burn every provider's quota in turn. It was wrong: the providers
 * cover different markets, so "no data" describes one provider's universe and
 * never the symbol. Twelve Data's free tier is US-focused and has nothing for a
 * Toronto-listed fund like XEQT, while Yahoo — the last link, and the only one
 * with real coverage outside the US — was never reached, which defeated the
 * reason it is in the chain at all.
 *
 * The cost of getting this wrong in the other direction is small and bounded: a
 * genuinely bogus ticker makes one request per provider, on the failure path
 * only, and the outcome is cached.
 *
 * Every attempt now carries a category as well as the provider's own words, and
 * every call has a ceiling on how long it may take, so a provider that hangs
 * costs a few seconds rather than the whole page.
 */

export interface PriceSource {
  readonly name: string;
  isConfigured(): boolean;
  /** Optional guard for providers that cannot serve every timeframe. */
  supports?(timeframe: Timeframe): boolean;
  /**
   * True when this source's closes already have dividends reinvested into
   * them — a "total return" series rather than a price series.
   *
   * The distinction is invisible in the numbers and changes every backtest
   * that uses them. Tiingo serves adjClose, which is adjusted for splits *and*
   * dividends; Yahoo's close is adjusted for splits only. Handed the first and
   * treated like the second, the simulator reinvests dividends that the series
   * has already counted, and reports a return inflated by roughly the whole
   * dividend yield compounded over the window — on SPY since 2020 that was
   * +186% against a true +159%, with nothing on the page to suggest which.
   */
  readonly barsIncludeDividends?: boolean;
  getBars(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Bar[]>;
  getQuote(symbol: string): Promise<Quote | null>;
}

export interface ProviderAttempt {
  provider: string;
  /** The provider's own description, for diagnostics. Never shown to readers or logged. */
  error: string;
  category: ProviderErrorCategory;
}

export interface FailoverResult<T> {
  value: T;
  /** Which provider answered, for display and debugging. */
  source: string | null;
  /** Providers that failed, and why. */
  attempts: ProviderAttempt[];
}

/** How long each kind of call may take before the next provider is tried. */
export const PROVIDER_TIMEOUT_MS = { bars: 15_000, quote: 8_000, news: 8_000 } as const;

/**
 * A quote older than this is stale.
 *
 * Five days covers a long weekend with a holiday on either side, so an
 * ordinary Monday morning never calls Friday's close stale, while a quote that
 * has genuinely stopped updating is never passed off as current.
 */
export const STALE_QUOTE_DAYS = 5;

/**
 * Cache of successful responses.
 *
 * The cheapest way to avoid a rate limit is not to make the request. Repeated
 * views of the same chart are extremely common, and this keeps them off the
 * network entirely for the life of the process.
 */
const cache = new Map<string, { value: unknown; expires: number }>();
const MAX_ENTRIES = 500;

function readCache<T>(key: string): T | undefined {
  const hit = cache.get(key);
  if (!hit) return undefined;
  if (hit.expires < Date.now()) {
    cache.delete(key);
    return undefined;
  }
  return hit.value as T;
}

function writeCache(key: string, value: unknown, ttlSeconds: number): void {
  // Simple bound: drop the oldest insertion when full.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

/** Exposed so tests can start from a known state. */
export function clearPriceCache(): void {
  cache.clear();
}

function failed(provider: string, err: unknown): ProviderAttempt {
  return {
    provider,
    error: err instanceof Error ? err.message : String(err),
    category: classifyProviderError(err),
  };
}

/**
 * Records that nothing could be served.
 *
 * Categories only. A provider's own error text can quote the request URL, and
 * several providers carry the API key in the query string, so the raw message
 * never reaches a log line.
 */
function logUnavailable(kind: string, symbol: string, attempts: ProviderAttempt[]): void {
  if (attempts.length === 0 || process.env.NODE_ENV === "test") return;
  console.warn(
    `[providers] ${kind} unavailable for ${symbol}: ${attempts.map((a) => `${a.provider}=${a.category}`).join(", ")}`,
  );
}

/** Marks a quote whose own timestamp is too old to be current. */
export function markStaleQuote(quote: Quote, now = Date.now()): Quote {
  if (!quote.asOf) return quote;
  const at = Date.parse(quote.asOf);
  if (!Number.isFinite(at)) return quote;
  return now - at > STALE_QUOTE_DAYS * 86_400_000 ? { ...quote, freshness: "stale" } : quote;
}

/** How long each timeframe's bars stay fresh. */
function barsTtl(timeframe: Timeframe): number {
  switch (timeframe) {
    case "1Min":
      return 60;
    case "5Min":
      return 300;
    case "15Min":
      return 900;
    case "1Hour":
      return 1800;
    default:
      return 3600;
  }
}

/**
 * How much of the requested window a response actually spans, from 0 to 1.
 *
 * A provider that does not really carry a symbol may still answer rather than
 * error — Tiingo returns five days for a Toronto ETF whatever window is asked
 * for, and at prices belonging to a different security altogether. Taking the
 * first non-empty response therefore risks charting the wrong company, which is
 * worse than charting nothing, and nothing about a bare count reveals it.
 *
 * Coverage is measured rather than counted so it holds across every timeframe
 * without a table of expected bars per interval.
 */
function coverage(bars: Bar[], from: Date, to: Date): number {
  if (bars.length === 0) return 0;

  const requested = to.getTime() - from.getTime();
  if (requested <= 0) return 1;

  // Bars carry epoch seconds and arrive oldest first.
  const span = (bars[bars.length - 1].time - bars[0].time) * 1000;
  return Math.min(1, Math.max(0, span / requested));
}

/**
 * Coverage below this means the provider is answering about something other
 * than what was asked for. Set low deliberately: a company that listed recently
 * genuinely has little history, and the fallback below keeps its chart working.
 */
const MIN_COVERAGE = 0.5;

export async function fetchBarsWithFailover(
  sources: PriceSource[],
  symbol: string,
  timeframe: Timeframe,
  from: Date,
  to: Date,
): Promise<FailoverResult<Bar[]>> {
  const key = `bars:${symbol}:${timeframe}:${from.toISOString().slice(0, 13)}:${to
    .toISOString()
    .slice(0, 13)}`;

  const cached = readCache<FailoverResult<Bar[]>>(key);
  if (cached) return cached;

  const attempts: ProviderAttempt[] = [];

  // The best thin answer seen so far, kept in case nothing better turns up —
  // a genuinely young listing has little history from any provider, and its
  // chart should still draw.
  let best: { bars: Bar[]; source: string; coverage: number } | null = null;

  for (const source of sources) {
    if (!source.isConfigured()) continue;
    if (source.supports && !source.supports(timeframe)) {
      attempts.push({ provider: source.name, error: `does not serve ${timeframe} bars`, category: "NO_DATA" });
      continue;
    }

    try {
      const bars = await withTimeout(
        source.getBars(symbol, timeframe, from, to),
        PROVIDER_TIMEOUT_MS.bars,
        source.name,
      );

      if (bars.length === 0) {
        // An empty response says this provider has nothing for the symbol,
        // which is a statement about its coverage rather than about the symbol.
        attempts.push({ provider: source.name, error: "returned no bars", category: "NO_DATA" });
        continue;
      }

      const covered = coverage(bars, from, to);
      if (covered >= MIN_COVERAGE) {
        const result = { value: bars, source: source.name, attempts };
        writeCache(key, result, barsTtl(timeframe));
        return result;
      }

      attempts.push({
        provider: source.name,
        error: `only ${bars.length} bars, covering ${Math.round(covered * 100)}% of the window`,
        // A thin answer is usually a provider answering about a different
        // security, which is invalid data rather than missing data.
        category: "INVALID_DATA",
      });
      if (!best || covered > best.coverage) {
        best = { bars, source: source.name, coverage: covered };
      }
    } catch (err) {
      attempts.push(failed(source.name, err));
    }
  }

  // Nobody covered the window. The widest of the partial answers beats an empty
  // chart, and beats picking whichever provider happened to be listed first.
  if (best) {
    const result = { value: best.bars, source: best.source, attempts };
    writeCache(key, result, barsTtl(timeframe));
    return result;
  }

  logUnavailable("bars", symbol, attempts);
  return { value: [], source: null, attempts };
}

/** A source of headlines. Narrower than PriceSource: news needs no timeframe. */
export interface NewsSource {
  readonly name: string;
  isConfigured(): boolean;
  getNews(symbol: string, limit?: number): Promise<NewsItem[]>;
}

/**
 * Headlines, falling through the same way prices do.
 *
 * News was the last single-source dependency in the app: when Finnhub refused
 * the key, the panel simply went blank, while prices in the same page carried
 * on through four providers. The chain ends at EDGAR, which needs no key and
 * cannot be unsubscribed, so a US filer's panel is never empty.
 *
 * The first source with anything to say wins rather than merging them. A
 * journalist's headline and a regulatory filing are different kinds of claim,
 * and interleaving them would leave a reader unsure which they were looking at.
 */
export async function fetchNewsWithFailover(
  sources: NewsSource[],
  symbol: string,
  limit = 20,
): Promise<FailoverResult<NewsItem[]>> {
  const key = `news:${symbol}:${limit}`;
  const cached = readCache<FailoverResult<NewsItem[]>>(key);
  if (cached) return cached;

  const attempts: ProviderAttempt[] = [];

  for (const source of sources) {
    if (!source.isConfigured()) {
      attempts.push({ provider: source.name, error: "not configured", category: "NO_DATA" });
      continue;
    }

    try {
      const items = await withTimeout(source.getNews(symbol, limit), PROVIDER_TIMEOUT_MS.news, source.name);
      if (items.length > 0) {
        const result = { value: items, source: source.name, attempts };
        writeCache(key, result, 900);
        return result;
      }
      attempts.push({ provider: source.name, error: "returned no articles", category: "NO_DATA" });
    } catch (err) {
      attempts.push(failed(source.name, err));
    }
  }

  logUnavailable("news", symbol, attempts.filter((a) => a.error !== "not configured"));
  return { value: [], source: null, attempts };
}

/**
 * A quote, from the first provider with a current one.
 *
 * A stale quote — one whose own timestamp is days old — does not end the
 * search: the next provider may have today's. It is kept as a last resort and
 * marked stale, so a page that has nothing better says "last known price"
 * rather than presenting an old figure as current.
 */
export async function fetchQuoteWithFailover(
  sources: PriceSource[],
  symbol: string,
): Promise<FailoverResult<Quote | null>> {
  const key = `quote:${symbol}`;
  const cached = readCache<FailoverResult<Quote | null>>(key);
  if (cached) return cached;

  const attempts: ProviderAttempt[] = [];
  let stale: { quote: Quote; source: string } | null = null;

  for (const source of sources) {
    if (!source.isConfigured()) continue;

    try {
      const raw = await withTimeout(source.getQuote(symbol), PROVIDER_TIMEOUT_MS.quote, source.name);
      if (raw?.price == null) {
        attempts.push({ provider: source.name, error: "no quote returned", category: "NO_DATA" });
        continue;
      }

      const quote = markStaleQuote(raw);
      if (quote.freshness === "stale") {
        attempts.push({ provider: source.name, error: `quote dated ${quote.asOf} is stale`, category: "NO_DATA" });
        if (!stale) stale = { quote, source: source.name };
        continue;
      }

      const result = { value: quote, source: source.name, attempts };
      writeCache(key, result, 60);
      return result;
    } catch (err) {
      attempts.push(failed(source.name, err));
    }
  }

  if (stale) {
    const result = { value: stale.quote, source: stale.source, attempts };
    writeCache(key, result, 60);
    return result;
  }

  logUnavailable("quote", symbol, attempts);
  return { value: null, source: null, attempts };
}
