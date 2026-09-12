import type {
  CanonicalField,
  Fact,
  FinancialPeriod,
  NormalizedFundamentals,
} from "../fundamentals/types";
import type { Bar, NewsItem, Quote, Timeframe } from "./types";

/**
 * Yahoo Finance — the widest free coverage, and off unless explicitly enabled.
 *
 * WHY THIS IS OPT-IN
 *
 * Yahoo has published no finance API since shutting the old one down in 2017.
 * These are internal endpoints behind the website. Their terms prohibit
 * automated access and republishing, and the data is described as personal-use
 * only. Personal research carries little practical risk; a public, deployed
 * product carries meaningfully more. That is a judgement about your own
 * exposure, not a technical question, so nothing here runs unless
 * ENABLE_YAHOO_FALLBACK is set to "true".
 *
 * Only endpoints that answer directly are used. Yahoo's `quoteSummary` replies
 * with a crumb challenge — a bot-protection mechanism — and defeating that is
 * off the table, so the modules behind it are simply not available here.
 *
 * Being undocumented, these endpoints can change shape or disappear without
 * notice. Every call therefore fails soft: the app falls back to whatever else
 * is configured rather than breaking.
 */

const CHART = "https://query1.finance.yahoo.com/v8/finance/chart";
const NEWS_FEED = "https://feeds.finance.yahoo.com/rss/2.0/headline";
const TIMESERIES =
  "https://query2.finance.yahoo.com/ws/fundamentals-timeseries/v1/finance/timeseries";

/** Yahoo rejects requests with no browser-like User-Agent. */
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  Accept: "application/json",
};

const INTERVALS: Record<Timeframe, string> = {
  "1Min": "1m",
  "5Min": "5m",
  "15Min": "15m",
  "1Hour": "1h",
  "1Day": "1d",
  "1Week": "1wk",
};

/** Annual series names, mapped onto our canonical fields. */
const SERIES: Partial<Record<CanonicalField, string>> = {
  assets: "annualTotalAssets",
  liabilities: "annualTotalLiabilitiesNetMinorityInterest",
  equity: "annualStockholdersEquity",
  currentAssets: "annualCurrentAssets",
  currentLiabilities: "annualCurrentLiabilities",
  cash: "annualCashAndCashEquivalents",
  receivables: "annualAccountsReceivable",
  inventory: "annualInventory",
  ppe: "annualNetPPE",
  longTermDebt: "annualLongTermDebt",
  shortTermDebt: "annualCurrentDebt",
  retainedEarnings: "annualRetainedEarnings",
  revenue: "annualTotalRevenue",
  costOfRevenue: "annualCostOfRevenue",
  grossProfit: "annualGrossProfit",
  operatingIncome: "annualOperatingIncome",
  netIncome: "annualNetIncome",
  incomeBeforeTax: "annualPretaxIncome",
  interestExpense: "annualInterestExpense",
  sga: "annualSellingGeneralAndAdministration",
  depreciation: "annualReconciledDepreciation",
  operatingCashFlow: "annualOperatingCashFlow",
  capex: "annualCapitalExpenditure",
  sharesOutstanding: "annualOrdinarySharesNumber",
};

/**
 * Exchange codes mapped to Yahoo's ticker suffixes.
 *
 * Yahoo keys every non-US listing by suffix — Aritzia is ATZ.TO, not ATZ, and
 * the bare ticker returns nothing at all. The worldwide directory names the
 * exchange, so the suffix can be derived rather than guessed.
 */
const EXCHANGE_SUFFIX: Record<string, string> = {
  TSX: ".TO",
  TSXV: ".V",
  NEO: ".NE",
  CSE: ".CN",
  LSE: ".L",
  LON: ".L",
  FSX: ".F",
  XETRA: ".DE",
  EURONEXT: ".PA",
  AMS: ".AS",
  BRU: ".BR",
  LIS: ".LS",
  MIL: ".MI",
  BME: ".MC",
  SIX: ".SW",
  STO: ".ST",
  OSL: ".OL",
  CPH: ".CO",
  HEL: ".HE",
  TSE: ".T",
  JPX: ".T",
  HKEX: ".HK",
  ASX: ".AX",
  NSE: ".NS",
  BSE: ".BO",
  KRX: ".KS",
  SGX: ".SI",
  TWSE: ".TW",
  SSE: ".SS",
  SZSE: ".SZ",
  Bovespa: ".SA",
  BMV: ".MX",
  JSE: ".JO",
  TASE: ".TA",
};

/**
 * Builds the symbol Yahoo expects for a listing on a given exchange.
 *
 * US venues take the bare ticker; everything else needs its suffix. An
 * unrecognised exchange falls back to the bare ticker rather than inventing a
 * suffix, since a wrong one silently returns another company's data.
 */
export function yahooSymbol(symbol: string, exchange?: string | null): string {
  const upper = symbol.toUpperCase();
  if (upper.includes(".")) return upper;
  if (!exchange) return upper;

  const key = exchange.trim().toUpperCase();
  const US = new Set(["NYSE", "NASDAQ", "NYSE ARCA", "AMEX", "BATS", "OTC", "US"]);
  if (US.has(key)) return upper;

  const direct = EXCHANGE_SUFFIX[key];
  if (direct) return `${upper}${direct}`;

  // Keys are compared case-insensitively so "Bovespa" matches too.
  const match = Object.entries(EXCHANGE_SUFFIX).find(
    ([code]) => code.toUpperCase() === key,
  );
  return match ? `${upper}${match[1]}` : upper;
}

/**
 * Finds the exchange-qualified Yahoo symbol for a bare ticker.
 *
 * The lookup goes through the worldwide symbol search, which knows that XEQT
 * trades in Toronto, and the exchange is then mapped to Yahoo's suffix. Results
 * are memoised for the life of the process because a listing's exchange does
 * not change, and this sits on the path of every foreign chart request.
 *
 * Returns null when the symbol is unknown, so the caller can stop rather than
 * guess at a suffix.
 */
const symbolCache = new Map<string, string | null>();

async function resolveYahooSymbol(symbol: string): Promise<string | null> {
  const upper = symbol.toUpperCase();
  if (upper.includes(".")) return upper;

  const cached = symbolCache.get(upper);
  if (cached !== undefined) return cached;

  const { searchGlobalSymbols } = await import("./twelvedata");
  const { listingForBareTicker } = await import("../exchange-suffix");
  const listings = await searchGlobalSymbols(upper, 6).catch(() => []);
  /*
    The US listing whenever the ticker has one. A bare ticker names the US
    security on this site, and taking whichever row the directory lists first
    resolved TEC — a US fund — to TEC.TO, a different fund in Toronto.
  */
  const listing = listingForBareTicker(upper, listings);

  const resolved = listing ? yahooSymbol(upper, listing.exchange) : null;
  symbolCache.set(upper, resolved);
  return resolved;
}

/**
 * Whether a chart response is Yahoo's placeholder rather than a real listing.
 *
 * Asked for a bare foreign ticker, Yahoo does not answer 404. It answers with
 * a stub: `instrumentType: "ECNQUOTE"`, no currency, and an exchange of
 * "NasdaqGS" whatever the ticker. The stub carries no history — or, now and
 * then, a single stray off-exchange print.
 *
 * That one print was enough to satisfy "did the direct lookup work?" below,
 * so the exchange-suffixed lookup after it never ran: ZDV drew as a single
 * dot, while VDY and XEI, whose stubs came back empty, fell through and drew
 * a full year from Toronto. Three funds of the same kind, two charts and one
 * dot, for no reason a reader could see.
 *
 * A placeholder is not a listing, so it counts as no answer at all.
 */
function isPlaceholderListing(meta: { instrumentType?: string } | undefined): boolean {
  return meta?.instrumentType === "ECNQUOTE";
}

/**
 * Reads an RSS feed without pulling in an XML parser.
 *
 * The feed is a fixed, narrow shape — a flat list of items with five fields —
 * so a dependency to read it would cost more than it saves. Anything
 * unrecognised is skipped rather than guessed at.
 */
export function rssItems(xml: string): Record<string, string>[] {
  const items: Record<string, string>[] = [];

  for (const [, body] of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const item: Record<string, string> = {};
    for (const [, tag, raw] of body.matchAll(/<(\w+)[^>]*>([\s\S]*?)<\/\1>/gi)) {
      item[tag.toLowerCase()] = decodeXml(raw);
    }
    if (item.title && item.link) items.push(item);
  }

  return items;
}

/** Unwraps CDATA and the five entities an RSS feed is allowed to escape with. */
function decodeXml(value: string): string {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    // Ampersand last, or an already-decoded entity would be decoded twice.
    .replace(/&amp;/g, "&")
    .trim();
}

export class YahooProvider {
  readonly name = "Yahoo Finance";

  /**
   * Yahoo's `indicators.quote[].close` is adjusted for splits but not for
   * dividends — the separate `adjclose` array is the one that includes them,
   * and getBars deliberately does not read it. So dividends still have to be
   * applied on top, which is what the corporate-events feed is for.
   */
  readonly barsIncludeDividends = false;

  /**
   * Makes one real request and reports exactly what came back.
   *
   * Necessary because these endpoints behave differently depending on where the
   * request originates: Yahoo filters by IP reputation, and a datacentre
   * address — which is what any hosting platform gives you — can be refused
   * where a home connection is not. That failure is invisible from a developer
   * machine, so the deployment has to be able to answer for itself.
   */
  async probe(): Promise<{
    enabled: boolean;
    reachable: boolean;
    httpStatus: number | null;
    periodsReturned: number;
    note: string;
  }> {
    if (!this.isConfigured()) {
      return {
        enabled: false,
        reachable: false,
        httpStatus: null,
        periodsReturned: 0,
        note: "ENABLE_YAHOO_FALLBACK is not set to \"true\" on this deployment.",
      };
    }

    const params = new URLSearchParams({
      symbol: "ATZ.TO",
      type: "annualTotalRevenue",
      period1: "1500000000",
      period2: String(Math.floor(Date.now() / 1000) + 86400),
    });

    try {
      const res = await fetch(`${TIMESERIES}/ATZ.TO?${params}`, {
        headers: HEADERS,
        // Never cached: a probe reporting a stale success would defeat its
        // entire purpose.
        cache: "no-store",
      });

      if (!res.ok) {
        return {
          enabled: true,
          reachable: false,
          httpStatus: res.status,
          periodsReturned: 0,
          note:
            res.status === 401 || res.status === 403
              ? "Yahoo refused the request. It filters by IP reputation, and hosting " +
                "platforms use datacentre addresses that are commonly blocked. The same " +
                "request usually succeeds from a home connection, which is why this can " +
                "work locally and fail once deployed."
              : res.status === 429
                ? "Yahoo is rate limiting this address."
                : `Yahoo returned HTTP ${res.status}.`,
        };
      }

      const json = (await res.json()) as YahooTimeseries;
      const series = json.timeseries?.result?.[0];
      const points = series?.annualTotalRevenue;
      const count = Array.isArray(points) ? points.length : 0;

      return {
        enabled: true,
        reachable: true,
        httpStatus: res.status,
        periodsReturned: count,
        note:
          count > 0
            ? "Yahoo is reachable and returning data from this deployment."
            : "Yahoo answered but returned no figures, which may mean the response " +
              "shape has changed.",
      };
    } catch (err) {
      return {
        enabled: true,
        reachable: false,
        httpStatus: null,
        periodsReturned: 0,
        note: `Could not reach Yahoo: ${
          err instanceof Error ? err.message : String(err)
        }`.slice(0, 200),
      };
    }
  }

  /** Deliberately requires an explicit opt-in rather than merely a key. */
  isConfigured(): boolean {
    return process.env.ENABLE_YAHOO_FALLBACK === "true";
  }

  async getBars(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Bar[]> {
    if (!this.isConfigured()) return [];

    const bars = await this.barsFor(symbol, timeframe, from, to);
    if (bars.length > 0) return bars;

    // Yahoo keys a listing by its exchange: the Toronto quote for XEQT is
    // XEQT.TO, and the bare ticker is simply Not Found. Nothing upstream knows
    // the exchange — the chain passes whatever the reader typed — so it is
    // resolved here, and only after the plain symbol has already failed, which
    // keeps US lookups to a single request.
    const suffixed = await resolveYahooSymbol(symbol);
    if (!suffixed || suffixed === symbol.toUpperCase()) return [];

    return this.barsFor(suffixed, timeframe, from, to);
  }

  private async barsFor(
    symbol: string,
    timeframe: Timeframe,
    from: Date,
    to: Date,
  ): Promise<Bar[]> {
    const params = new URLSearchParams({
      interval: INTERVALS[timeframe],
      period1: String(Math.floor(from.getTime() / 1000)),
      period2: String(Math.floor(to.getTime() / 1000)),
    });

    try {
      const res = await fetch(`${CHART}/${encodeURIComponent(symbol)}?${params}`, {
        headers: HEADERS,
        next: { revalidate: timeframe === "1Day" || timeframe === "1Week" ? 3600 : 300 },
      });
      if (!res.ok) return [];

      const json = (await res.json()) as YahooChart;
      const result = json.chart?.result?.[0];
      if (isPlaceholderListing(result?.meta)) return [];

      const quote = result?.indicators?.quote?.[0];
      if (!result?.timestamp || !quote) return [];

      return result.timestamp
        .map((time, i) => ({
          time,
          open: quote.open?.[i] ?? null,
          high: quote.high?.[i] ?? null,
          low: quote.low?.[i] ?? null,
          close: quote.close?.[i] ?? null,
          volume: quote.volume?.[i] ?? 0,
        }))
        // Yahoo pads non-trading intervals with nulls rather than omitting them.
        .filter(
          (b): b is Bar =>
            b.open != null && b.high != null && b.low != null && b.close != null,
        );
    } catch {
      return [];
    }
  }

  /**
   * Headlines from Yahoo's per-symbol RSS feed.
   *
   * Chosen over the JSON search endpoint, which matches any article merely
   * mentioning a ticker — asked about ATZ.TO and XEQT.TO it returned the same
   * generic listicle for both. The RSS feed is scoped to the listing, and it
   * covers exchanges Finnhub does not: Aritzia returns Toronto coverage here
   * and nothing at all there.
   */
  async getNews(symbol: string, limit = 20): Promise<NewsItem[]> {
    if (!this.isConfigured()) return [];

    const direct = await this.newsFor(symbol, limit);
    if (direct.length > 0) return direct;

    // Same exchange-suffix problem as the bars and quotes above.
    const suffixed = await resolveYahooSymbol(symbol);
    if (!suffixed || suffixed === symbol.toUpperCase()) return [];

    return this.newsFor(suffixed, limit);
  }

  private async newsFor(symbol: string, limit: number): Promise<NewsItem[]> {
    const params = new URLSearchParams({ s: symbol, region: "US", lang: "en-US" });

    try {
      const res = await fetch(`${NEWS_FEED}?${params}`, {
        headers: HEADERS,
        next: { revalidate: 900 },
      });
      if (!res.ok) return [];

      return rssItems(await res.text())
        .slice(0, limit)
        .map((item) => {
          const published = item.pubdate ? new Date(item.pubdate) : null;
          return {
            id: item.guid || item.link,
            headline: item.title,
            summary: item.description || null,
            // The feed names the outlet inconsistently, so it is attributed to
            // the aggregator rather than to a publication it may not be.
            source: "Yahoo Finance",
            url: item.link,
            publishedAt:
              published && !Number.isNaN(published.getTime())
                ? published.toISOString()
                : new Date().toISOString(),
            imageUrl: null,
          };
        });
    } catch {
      return [];
    }
  }

  /**
   * Dividends and splits over a window.
   *
   * The same chart endpoint the bars come from carries these when asked, so
   * this costs one extra request rather than a new dependency. Amounts are
   * as-paid, and split ratios are Yahoo's own strings ("10:1").
   */
  async getCorporateEvents(
    symbol: string,
    from: Date,
    to: Date,
  ): Promise<{ dividends: { time: number; amount: number }[]; splits: { time: number; ratio: string }[] }> {
    const empty = { dividends: [], splits: [] };
    if (!this.isConfigured()) return empty;

    const resolved = symbol.includes(".") ? symbol : ((await resolveYahooSymbol(symbol)) ?? symbol);
    const params = new URLSearchParams({
      interval: "1d",
      period1: String(Math.floor(from.getTime() / 1000)),
      period2: String(Math.floor(to.getTime() / 1000)),
      events: "div,split",
    });

    try {
      const res = await fetch(`${CHART}/${encodeURIComponent(resolved)}?${params}`, {
        headers: HEADERS,
        next: { revalidate: 3600 },
      });
      if (!res.ok) return empty;

      const json = (await res.json()) as {
        chart?: {
          result?: {
            events?: {
              dividends?: Record<string, { date?: number; amount?: number }>;
              splits?: Record<string, { date?: number; splitRatio?: string }>;
            };
          }[];
        };
      };

      const events = json.chart?.result?.[0]?.events;

      return {
        dividends: Object.values(events?.dividends ?? {})
          .filter((d): d is { date: number; amount: number } =>
            typeof d.date === "number" && typeof d.amount === "number")
          .map((d) => ({ time: d.date, amount: d.amount })),
        splits: Object.values(events?.splits ?? {})
          .filter((s): s is { date: number; splitRatio: string } =>
            typeof s.date === "number" && typeof s.splitRatio === "string")
          .map((s) => ({ time: s.date, ratio: s.splitRatio })),
      };
    } catch {
      return empty;
    }
  }

  /**
   * What a holding paid out, and the year's trading range.
   *
   * One call for both because the chart endpoint returns them together: the
   * dividend events in `events`, the 52-week high and low in `meta`. Asking
   * twice would be two requests for one page.
   *
   * This exists for the fund pages, where neither figure is available any
   * other way. A company's dividends come out of its own filings and a fund
   * files none — N-PORT reports what a fund owns, not what it distributes —
   * so without this a fund page could show what it holds and what it charges
   * but not what it pays.
   *
   * Two years rather than one, deliberately: a payout schedule cannot be read
   * from four dates. Eight tells you it is quarterly and that none was missed.
   */
  async getIncomeAndRange(symbol: string): Promise<{
    dividends: { date: string; amount: number }[];
    fiftyTwoWeekLow: number | null;
    fiftyTwoWeekHigh: number | null;
    /**
     * What this answer is actually about.
     *
     * Returned so the caller can check it is the same security it asked
     * about, which is not a given. `resolveYahooSymbol` tries exchange
     * suffixes to find a match, and a bare ticker can be a real listing in
     * two places: "QQC" is a US fund from Simplify and QQC.TO is a Canadian
     * one from CI Invesco. Resolving independently of whichever provider
     * answered for the quote put one fund's price beside the other's
     * dividends and 52-week range on the same card, both printed as "$".
     */
    currency: string | null;
    resolvedSymbol: string;
  } | null> {
    if (!this.isConfigured()) return null;

    const resolved = symbol.includes(".") ? symbol : ((await resolveYahooSymbol(symbol)) ?? symbol);
    const now = Math.floor(Date.now() / 1000);
    const params = new URLSearchParams({
      interval: "1d",
      period1: String(now - 60 * 60 * 24 * 730),
      period2: String(now),
      events: "div",
    });

    try {
      const res = await fetch(`${CHART}/${encodeURIComponent(resolved)}?${params}`, {
        headers: HEADERS,
        // A dividend lands quarterly and the range moves daily; six hours is
        // far more often than either matters on a page like this.
        next: { revalidate: 60 * 60 * 6 },
      });
      if (!res.ok) return null;

      const json = (await res.json()) as {
        chart?: {
          result?: {
            meta?: {
              fiftyTwoWeekLow?: number;
              fiftyTwoWeekHigh?: number;
              currency?: string;
              symbol?: string;
            };
            events?: { dividends?: Record<string, { date?: number; amount?: number }> };
          }[];
        };
      };

      const result = json.chart?.result?.[0];
      if (!result) return null;

      const dividends = Object.values(result.events?.dividends ?? {})
        .filter((d): d is { date: number; amount: number } =>
          typeof d.date === "number" && typeof d.amount === "number" && d.amount > 0)
        // Epoch seconds to a plain date. These are ex-dividend dates, which are
        // calendar dates rather than moments, so no zone is carried forward.
        .map((d) => ({ date: new Date(d.date * 1000).toISOString().slice(0, 10), amount: d.amount }))
        .sort((a, b) => a.date.localeCompare(b.date));

      return {
        dividends,
        fiftyTwoWeekLow: result.meta?.fiftyTwoWeekLow ?? null,
        fiftyTwoWeekHigh: result.meta?.fiftyTwoWeekHigh ?? null,
        currency: result.meta?.currency ?? null,
        resolvedSymbol: result.meta?.symbol ?? resolved,
      };
    } catch {
      return null;
    }
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    if (!this.isConfigured()) return null;

    const direct = await this.quoteFor(symbol);
    if (direct) return direct;

    // Same exchange-suffix problem as the bars above.
    const suffixed = await resolveYahooSymbol(symbol);
    if (!suffixed || suffixed === symbol.toUpperCase()) return null;

    return this.quoteFor(suffixed);
  }

  private async quoteFor(symbol: string): Promise<Quote | null> {
    try {
      const res = await fetch(
        `${CHART}/${encodeURIComponent(symbol)}?interval=1d&range=5d`,
        { headers: HEADERS, next: { revalidate: 60 } },
      );
      if (!res.ok) return null;

      const json = (await res.json()) as YahooChart;
      const meta = json.chart?.result?.[0]?.meta;
      if (!meta?.regularMarketPrice || isPlaceholderListing(meta)) return null;

      const previous = meta.chartPreviousClose ?? meta.previousClose ?? null;
      const change = previous != null ? meta.regularMarketPrice - previous : null;

      return {
        symbol: symbol.toUpperCase(),
        currency: meta.currency ?? null,
        price: meta.regularMarketPrice,
        change,
        changePercent: change != null && previous ? change / previous : null,
        previousClose: previous,
        dayHigh: meta.regularMarketDayHigh ?? null,
        dayLow: meta.regularMarketDayLow ?? null,
        volume: meta.regularMarketVolume ?? null,
        // Yahoo's delay varies by exchange and is not stated per response, so
        // this never claims to be live.
        freshness: "delayed-15min",
        asOf: meta.regularMarketTime
          ? new Date(meta.regularMarketTime * 1000).toISOString()
          : null,
      };
    } catch {
      return null;
    }
  }

  /**
   * Annual fundamentals, mapped onto the canonical model so the scoring engine
   * treats them identically to an SEC filing.
   */
  async getFundamentals(symbol: string): Promise<NormalizedFundamentals | null> {
    if (!this.isConfigured()) return null;

    const types = Object.values(SERIES).join(",");
    const params = new URLSearchParams({
      symbol,
      type: types,
      // Ten years back, comfortably ahead — the window simply has to contain
      // every annual period.
      period1: String(Math.floor(Date.now() / 1000) - 10 * 365 * 86400),
      period2: String(Math.floor(Date.now() / 1000) + 86400),
    });

    try {
      const res = await fetch(`${TIMESERIES}/${encodeURIComponent(symbol)}?${params}`, {
        headers: HEADERS,
        next: { revalidate: 60 * 60 * 12 },
      });
      // A refusal must not be cached, or one blocked request keeps the company
      // empty for half a day after access is restored.
      if (!res.ok) return null;

      const json = (await res.json()) as YahooTimeseries;
      const results = json.timeseries?.result ?? [];
      if (results.length === 0) return null;

      // Yahoo returns one array per requested series; regroup by fiscal period.
      const byDate = new Map<string, Partial<Record<CanonicalField, Fact>>>();
      let currency: string | null = null;

      for (const [field, seriesName] of Object.entries(SERIES) as [
        CanonicalField,
        string,
      ][]) {
        const series = results.find((r) => r.meta?.type?.[0] === seriesName);
        const points = series?.[seriesName];
        if (!Array.isArray(points)) continue;

        for (const point of points) {
          if (!point?.asOfDate || point.reportedValue?.raw == null) continue;
          currency ??= point.currencyCode ?? null;

          const facts = byDate.get(point.asOfDate) ?? {};
          facts[field] = {
            value: point.reportedValue.raw,
            unit: point.currencyCode ?? "USD",
            end: point.asOfDate,
            fiscalYear: Number(point.asOfDate.slice(0, 4)),
            fiscalPeriod: "FY",
            form: "annual-report",
            sourceConcept: `yahoo:${seriesName}`,
            sourceFilingUrl: null,
          };
          byDate.set(point.asOfDate, facts);
        }
      }

      // Yahoo's timeseries carries the period end (asOfDate) but never the date
      // a filing was actually submitted, so filedAt is left null rather than
      // guessed at — a period with no known filing date is excluded from
      // point-in-time reconstruction rather than assumed to have been public
      // on its period end, which would understate the real reporting lag.
      const annual: FinancialPeriod[] = [...byDate.entries()]
        .map(([end, facts]) => ({
          fiscalYear: Number(end.slice(0, 4)),
          fiscalPeriod: "FY",
          end,
          form: "annual-report",
          facts,
          filedAt: null,
        }))
        // Newest first, matching the SEC normalizer's ordering.
        .sort((a, b) => b.end.localeCompare(a.end));

      if (annual.length === 0) return null;

      // Same derivation the SEC path applies when liabilities go untagged.
      for (const period of annual) {
        if (!period.facts.liabilities && period.facts.assets && period.facts.equity) {
          period.facts.liabilities = {
            ...period.facts.assets,
            value: period.facts.assets.value - period.facts.equity.value,
            sourceConcept: "derived:Assets-Equity",
            derived: true,
          };
        }
      }

      // Currency is carried on each Fact's `unit`, so it needs no separate
      // field here — it is read back off the facts downstream.
      void currency;

      return {
        cik: "",
        entityName: symbol.toUpperCase(),
        taxonomy: "us-gaap",
        annual,
        missingFields: [],
      };
    } catch {
      return null;
    }
  }
}

interface YahooChart {
  chart?: {
    result?: {
      meta?: {
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        regularMarketDayHigh?: number;
        regularMarketDayLow?: number;
        regularMarketVolume?: number;
        regularMarketTime?: number;
        currency?: string;
        /** "EQUITY", "ETF", "CRYPTOCURRENCY" — or "ECNQUOTE" for a stub. */
        instrumentType?: string;
      };
      timestamp?: number[];
      indicators?: {
        quote?: {
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }[];
      };
    }[];
  };
}

/** One reported figure for one fiscal period. */
interface YahooPoint {
  asOfDate?: string;
  currencyCode?: string;
  reportedValue?: { raw?: number };
}

/**
 * Each result holds `meta.type` naming the series, plus an array keyed by that
 * same name. The dynamic key is why this is indexed rather than a fixed shape.
 */
type YahooResult = { meta?: { type?: string[] } } & {
  [series: string]: YahooPoint[] | { type?: string[] } | undefined;
};

interface YahooTimeseries {
  timeseries?: { result?: YahooResult[] };
}

export const yahoo = new YahooProvider();
