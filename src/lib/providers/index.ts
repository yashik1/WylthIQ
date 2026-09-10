import type { NormalizedFundamentals } from "../fundamentals/types";
import { eodhd } from "./eodhd";
import { alphaVantage } from "./alphavantage";
import { finnhub } from "./finnhub";
import { cikForSymbol, secEdgar } from "./sec-edgar";
import { tiingo } from "./tiingo";
import { yahoo, yahooSymbol } from "./yahoo";
import { searchGlobalSymbols, twelveData } from "./twelvedata";
import {
  fetchBarsWithFailover,
  fetchQuoteWithFailover,
  fetchNewsWithFailover,
  type NewsSource,
  type PriceSource,
} from "./failover";
import type {
  Bar,
  CompanyProfile,
  Filing,
  InstrumentType,
  MarketDataProvider,
  NewsItem,
  Quote,
  SymbolSearchResult,
  Timeframe,
} from "./types";
import { ProviderNotConfiguredError } from "./types";
import { classify } from "../instruments";
import type { AnalystView } from "../signals/analysts";

/**
 * Composes the free US/Canada stack into a single provider.
 *
 * No one free source covers everything, so each job goes to the source that
 * does it best at zero cost:
 *   fundamentals + filings + sector -> SEC EDGAR   (authoritative, no key, no cap)
 *   price bars + quotes             -> Twelve Data (full intraday range, free)
 *   news + logo + peers             -> Finnhub     (free tier covers these)
 *
 * Anything unavailable degrades to empty rather than throwing, so a missing
 * optional key never takes down a page.
 */
class FreeStackProvider implements MarketDataProvider {
  readonly name = "SEC EDGAR + Twelve Data + Finnhub";

  /** EDGAR alone needs no credentials, so fundamentals always work. */
  isConfigured(): boolean {
    return true;
  }

  async getBars(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Bar[]> {
    return (await getBarsWithSource(symbol, timeframe, from, to)).bars;
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    const result = await fetchQuoteWithFailover(sourcesFor(symbol), symbol);
    return result.value;
  }

  /**
   * Merges both profile sources. EDGAR supplies the SIC code that drives sector
   * gating in the scoring engine; Finnhub supplies the logo, market cap and
   * industry label. EDGAR wins on identity fields because it is authoritative.
   */
  async getProfile(symbol: string): Promise<CompanyProfile | null> {
    const [sec, fin] = await Promise.all([
      secEdgar.getProfile(symbol).catch(() => null),
      finnhub.isConfigured() ? finnhub.getProfile(symbol).catch(() => null) : null,
    ]);

    if (!sec && !fin) return null;

    return {
      symbol: symbol.toUpperCase(),
      name: sec?.name ?? fin?.name ?? symbol,
      exchange: fin?.exchange ?? sec?.exchange ?? null,
      country: fin?.country ?? sec?.country ?? null,
      currency: fin?.currency ?? null,
      sicCode: sec?.sicCode ?? null,
      sicDescription: sec?.sicDescription ?? null,
      industry: fin?.industry ?? sec?.sicDescription ?? null,
      website: fin?.website ?? null,
      logo: fin?.logo ?? null,
      marketCap: fin?.marketCap ?? null,
      sharesOutstanding: fin?.sharesOutstanding ?? null,
      cik: sec?.cik ?? null,
      description: fin?.description ?? null,
      entityType: sec?.entityType ?? null,
    };
  }

  async getFundamentals(symbol: string): Promise<NormalizedFundamentals | null> {
    return (await getFundamentalsWithSource(symbol)).fundamentals;
  }

  async getNews(symbol: string, limit?: number): Promise<NewsItem[]> {
    return (await getNewsWithSource(symbol, limit)).news;
  }

  async getFilings(symbol: string, limit?: number): Promise<Filing[]> {
    return secEdgar.getFilings(symbol, limit).catch(() => []);
  }

  /**
   * Searches EDGAR first, then tops up from Twelve Data.
   *
   * EDGAR only lists SEC registrants, so most ETFs are simply absent from it —
   * VTI, VOO, IWM and ARKK cannot be found there at all. Without the second
   * source those symbols would be unreachable through search.
   */
  /**
   * Searches EDGAR first, then tops up from the worldwide directory.
   *
   * The second lookup needs no API key, so it always runs. Without it a real
   * ticker on a foreign exchange — ATZ on the TSX, say — returns nothing at all
   * and reads as a typo. Those results are flagged unsupported rather than
   * hidden, because knowing the company exists and why it is unavailable beats
   * silence.
   */
  async searchSymbols(query: string, limit = 10): Promise<SymbolSearchResult[]> {
    const fromEdgar = await secEdgar.searchSymbols(query, limit).catch(() => []);

    // Only skip the worldwide lookup when EDGAR already holds this exact
    // ticker. Skipping merely because EDGAR filled the page would hide a
    // foreign listing behind loose name matches — searching a TSX ticker can
    // return eight unrelated US companies whose names happen to contain it.
    const q = query.trim().toUpperCase();
    const edgarHasExact = fromEdgar.some((r) => r.symbol.toUpperCase() === q);
    if (edgarHasExact) {
      return fromEdgar
        .map((r) => ({ ...r, supported: true, type: r.type ?? ("stock" as const) }))
        .slice(0, limit);
    }

    const seen = new Set(fromEdgar.map((r) => r.symbol.toUpperCase()));
    const worldwide = await searchGlobalSymbols(query, limit).catch(
      () => [] as SymbolSearchResult[],
    );

    const merged = [
      ...fromEdgar.map((r) => ({ ...r, supported: true, type: r.type ?? ("stock" as const) })),
      ...worldwide
        .filter((r) => !seen.has(r.symbol.toUpperCase()))
        .map((r) => ({ ...r, supported: false })),
    ];

    // Rank by how well the symbol itself matches, then prefer results we can
    // actually score. Without this an EDGAR name-substring hit outranks an
    // exact ticker match from the worldwide directory — searching "ATZ" put
    // "DATZ WORLD HOLDINGS" above Aritzia.
    const rank = (r: SymbolSearchResult) => {
      const sym = r.symbol.toUpperCase();
      if (sym === q) return 0;
      if (sym.startsWith(q)) return 1;
      return 2;
    };

    return merged
      .sort((a, b) => rank(a) - rank(b) || Number(b.supported) - Number(a.supported))
      .slice(0, limit);
  }

  /**
   * Classifies a symbol as an operating company or a fund.
   *
   * Resolving in EDGAR with usable XBRL data is the strongest signal of an
   * operating company. Funds file no statements — `companyfacts` returns 404
   * for SPY — so anything without them is checked against the market data
   * provider before being reported as unknown.
   */
  async getInstrumentType(symbol: string): Promise<InstrumentType> {
    if (twelveData.isConfigured()) {
      const type = await twelveData.getInstrumentType(symbol).catch(() => "unknown" as const);
      if (type !== "unknown") return type;
    }
    const cik = await cikForSymbol(symbol).catch(() => null);
    return cik ? "stock" : "unknown";
  }

  async getPeers(symbol: string): Promise<string[]> {
    if (!finnhub.isConfigured()) return [];
    return finnhub.getPeers(symbol).catch(() => []);
  }

  async getAnalystView(symbol: string): Promise<AnalystView | null> {
    if (!finnhub.isConfigured()) return null;
    return finnhub.getAnalystView(symbol).catch(() => null);
  }
}

/**
 * Price providers in preference order.
 *
 * Twelve Data leads because it is the only free source covering the full
 * intraday range. Finnhub follows for quotes — its 60 requests/minute is far
 * more headroom than Twelve Data's 8, and its key is already needed for news.
 * Tiingo backs up daily and weekly history, where its limits are counted per
 * hour rather than per minute.
 *
 * Yahoo sits last and only runs when explicitly enabled, because it has no
 * official API and its terms restrict automated use — see yahoo.ts. When it is
 * enabled it is the only one of these that covers non-US exchanges for free.
 */
const PRICE_SOURCES: PriceSource[] = [twelveData, finnhub, tiingo, yahoo];

/**
 * The order to try, for one symbol.
 *
 * Crypto, commodities and futures go to Yahoo first, because it is the only
 * source in the stack that covers them in this notation — Twelve Data prices
 * crypto as `BTC/USD` rather than `BTC-USD`, Finnhub's free tier serves no
 * candles at all, and neither Tiingo nor any of them carries a wheat contract.
 *
 * Left in the default order, every crypto chart spent three failed requests
 * before reaching the provider that could answer, two of them against quotas
 * measured in single-digit requests per minute. The failover still runs in
 * full afterwards, so nothing is lost if Yahoo is the one that is down — this
 * only changes who is asked first.
 */
function sourcesFor(symbol: string): PriceSource[] {
  /*
    A leading caret is Yahoo's own notation for an index — ^GSPC, ^IXIC,
    ^TNX — and nothing else in the stack uses it, so the other three would
    each spend a request learning that before failing over. Same reasoning as
    the catalogue symbols below.
  */
  const yahooOwn = symbol.startsWith("^") || classify(symbol) !== null;
  if (!yahooOwn) return PRICE_SOURCES;
  return [yahoo, ...PRICE_SOURCES.filter((s) => s !== yahoo)];
}

/**
 * Statements, falling back past EDGAR for listings it does not cover.
 *
 * This used to live in the stock page's own loader, so it ran for that page and
 * nowhere else: comparing Aritzia against Royal Bank showed nothing at all for
 * Aritzia — no revenue, no profit, no market value — while its own page showed
 * all three. Coverage is a property of the data layer, not of one screen, so it
 * belongs here where every caller gets it.
 *
 * Alpha Vantage is tried before Yahoo but only for a one-off lookup like this;
 * its free allowance is 25 requests a day, which would take weeks to cover the
 * screening universe and is never used by the nightly pass.
 */
export async function getFundamentalsWithSource(symbol: string): Promise<{
  fundamentals: NormalizedFundamentals | null;
  /** Currency the statements were reported in, when a fallback supplied them. */
  currency: string | null;
  source: string;
}> {
  const upper = symbol.toUpperCase();

  const fromEdgar = await secEdgar.getFundamentals(upper).catch(() => null);
  if (fromEdgar?.annual.length) {
    return { fundamentals: fromEdgar, currency: reportedIn(fromEdgar), source: "SEC EDGAR" };
  }

  if (alphaVantage.isConfigured()) {
    const matches = await alphaVantage.search(upper, 5).catch(() => []);
    // Alpha Vantage keys foreign listings by an exchange suffix (ATZ -> ATZ.TRT),
    // so the bare ticker has to be resolved before the statements can be read.
    const match =
      matches.find((m) => m.symbol.toUpperCase().startsWith(`${upper}.`)) ??
      matches.find((m) => m.symbol.toUpperCase() === upper);

    if (match) {
      const av = await alphaVantage.getFundamentals(match.symbol).catch(() => null);
      if (av?.annual.length) {
        return { fundamentals: av, currency: reportedIn(av), source: "Alpha Vantage" };
      }
    }
  }

  if (yahoo.isConfigured()) {
    // Yahoo keys foreign listings by suffix — Aritzia is ATZ.TO, and the bare
    // ticker returns nothing — so the exchange has to be resolved first.
    const listings = await searchGlobalSymbols(upper, 6).catch(() => []);
    const listing = listings.find((l) => l.symbol.toUpperCase() === upper);
    const candidate = yahooSymbol(upper, listing?.exchange);

    let fromYahoo = await yahoo.getFundamentals(candidate).catch(() => null);
    // A US listing needs no suffix, so avoid repeating an identical request.
    if (!fromYahoo?.annual.length && candidate !== upper) {
      fromYahoo = await yahoo.getFundamentals(upper).catch(() => null);
    }

    if (fromYahoo?.annual.length) {
      return { fundamentals: fromYahoo, currency: reportedIn(fromYahoo), source: "Yahoo Finance" };
    }
  }

  return { fundamentals: fromEdgar, currency: null, source: "SEC EDGAR" };
}

/**
 * The currency a filer reports in, taken from the units on its own figures.
 *
 * Only the fallback sources used to report this, so every company filing with
 * the SEC was assumed to report in dollars. Royal Bank files in Canadian
 * dollars and SK hynix in Korean won — the normalizer records that faithfully,
 * and it was being dropped one layer later.
 *
 * Balance-sheet items are checked before income items because a filer with no
 * revenue tagged still has assets.
 */
function reportedIn(f: NormalizedFundamentals): string | null {
  for (const period of f.annual) {
    for (const field of ["assets", "equity", "revenue", "netIncome"] as const) {
      const unit = period.facts[field]?.unit;
      // Share counts carry a "shares" unit, which is not a currency.
      if (unit && unit !== "shares" && unit !== "pure") return unit;
    }
  }
  return null;
}

/**
 * Where headlines come from, in order of how directly they answer the question.
 *
 * Finnhub first: real journalism, with summaries and images. Yahoo next,
 * because it covers exchanges Finnhub does not — Aritzia has Toronto coverage
 * there and none at all in Finnhub — though it stays behind the same opt-in as
 * the rest of Yahoo, since it has no official API.
 *
 * EDGAR last and always. It needs no key, so the panel cannot go blank for a US
 * filer the way it did when Finnhub started refusing the key.
 */
const NEWS_SOURCES: NewsSource[] = [finnhub, yahoo, secEdgar];

/**
 * Headlines plus the name of the source that supplied them.
 *
 * Which one answered changes how the list should be read: a filing is the
 * company's own announcement, a headline is somebody's description of one.
 */
export async function getNewsWithSource(
  symbol: string,
  limit?: number,
): Promise<{ news: NewsItem[]; source: string | null }> {
  const result = await fetchNewsWithFailover(NEWS_SOURCES, symbol, limit);
  if (result.value.length > 0) return { news: result.value, source: result.source };

  // An empty panel now means all three were asked, so it is only worth raising
  // when every one of them actually broke. A source that answered and had
  // nothing to say is not a fault — it is a quiet month, and saying otherwise
  // sends the reader off to fix something that works.
  const answered = result.attempts.filter(
    (a) => a.error === "returned no articles" || a.error === "not configured",
  );
  if (answered.length === 0 && result.attempts.length > 0) {
    throw new Error(
      `No news source could be reached. ${result.attempts
        .map((a) => `${a.provider}: ${a.error}`)
        .join("; ")}`,
    );
  }

  return { news: result.value, source: result.source };
}

/**
 * Bars plus the name of the provider that supplied them.
 *
 * Which provider answered is not a detail: they disagree. A ticker can name
 * different securities on different exchanges, so a chart is only interpretable
 * alongside where it came from — the same principle as linking every figure on
 * a company page back to its filing.
 */
export async function getBarsWithSource(
  symbol: string,
  timeframe: Timeframe,
  from: Date,
  to: Date,
): Promise<{ bars: Bar[]; source: string | null; includesDividends: boolean }> {
  const result = await fetchBarsWithFailover(sourcesFor(symbol), symbol, timeframe, from, to);
  if (result.value.length === 0 && result.attempts.length > 0) {
    // Every provider failed. Report why rather than returning an empty chart,
    // which reads as "this symbol has no history".
    throw new Error(describeFailure(result.attempts));
  }

  /*
    Which source answered decides how the closes must be read.

    Failover means the answer can come from any of four providers, and they do
    not all adjust alike — Tiingo's are a total-return series with dividends
    already reinvested, the rest are price series. Returning the bars without
    saying which kind they are leaves every caller to guess, and the guess is
    invisible when wrong.
  */
  const answered = PRICE_SOURCES.find((s) => s.name === result.source);

  return {
    bars: result.value,
    source: result.source,
    includesDividends: answered?.barsIncludeDividends ?? false,
  };
}

/** Summarises a total failure across every provider. */
function describeFailure(attempts: { provider: string; error: string }[]): string {
  const detail = attempts.map((a) => `${a.provider}: ${a.error}`).join("; ");
  return attempts.some((a) => /rate limit|quota|credit/i.test(a.error))
    ? `All price providers are rate limited right now. ${detail}. ` +
        `Adding TIINGO_API_KEY (free) gives more headroom.`
    : `Could not load price data. ${detail}`;
}

const freeStack = new FreeStackProvider();

/**
 * Returns the active provider.
 *
 * EODHD_API_KEY adds worldwide coverage on top of the free US/Canada stack. It
 * never replaces it — see `LayeredProvider` below for what that distinction
 * cost when it was the other way round.
 */
export function getProvider(): MarketDataProvider {
  return layeredStack;
}

/**
 * Puts an optional source after the ones already trusted.
 *
 * Last, not first, because a supplementary provider is by definition the one
 * the app worked without. Ahead of the free stack, every request pays for its
 * failures before reaching a source that answers; behind it, a broken key
 * costs nothing that used to work.
 */
export function layerSources<S>(free: S[], supplement: S | null): S[] {
  if (!supplement || free.includes(supplement)) return free;
  return [...free, supplement];
}

/** The quote chain for one symbol: the free sources in order, then EODHD if configured. */
export function quoteSourcesFor(symbol: string): PriceSource[] {
  return layerSources<PriceSource>(sourcesFor(symbol), eodhd.isConfigured() ? eodhd : null);
}

/**
 * The provider every page talks to: the free stack, with EODHD layered behind.
 *
 * `getProvider()` used to return EODHD whole once its key was set, and the
 * cost showed up only in production. EODHD's quote call fails quietly on a
 * key or plan it will not serve, and there was no chain behind it, so every
 * price on the site went at once: the header price on every company, coin and
 * contract page, the dashboard's index strip, the markets page, Compare, and
 * the nightly ingest that keeps the screener's prices current. The same
 * replacement had already emptied the filings list and the weekly digest's
 * filings, because EODHD carries no SEC filings at all.
 *
 * So each method does what the free stack did before the key existed, and
 * consults EODHD only where that comes up empty. A provider meant to add
 * coverage cannot, by construction, remove any.
 */
class LayeredProvider implements MarketDataProvider {
  get name(): string {
    return eodhd.isConfigured() ? `${freeStack.name} + EODHD` : freeStack.name;
  }

  isConfigured(): boolean {
    return true;
  }

  // Charts already fail over across their own chain and were never routed
  // through EODHD, so they are left exactly as they were.
  getBars(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Bar[]> {
    return freeStack.getBars(symbol, timeframe, from, to);
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    return (await fetchQuoteWithFailover(quoteSourcesFor(symbol), symbol)).value;
  }

  getProfile(symbol: string): Promise<CompanyProfile | null> {
    return getCompanyProfile(symbol);
  }

  /*
    The EDGAR-first chain only, deliberately without an EODHD fallback. The
    company page reads statements through that same chain, and an EODHD
    payload for an ETF can carry annual periods — which in Compare would turn
    a fund back into a company with accounts. Matching the page is the safer
    rule until that is handled on its own.
  */
  getFundamentals(symbol: string): Promise<NormalizedFundamentals | null> {
    return freeStack.getFundamentals(symbol);
  }

  getNews(symbol: string, limit?: number): Promise<NewsItem[]> {
    return freeStack.getNews(symbol, limit);
  }

  getFilings(symbol: string, limit?: number): Promise<Filing[]> {
    return getCompanyFilings(symbol, limit);
  }

  /** The free search first; EODHD only tops up what it could not find. */
  async searchSymbols(query: string, limit = 10): Promise<SymbolSearchResult[]> {
    const free = await freeStack.searchSymbols(query, limit);
    if (free.length >= limit || !eodhd.isConfigured()) return free;

    const seen = new Set(free.map((r) => r.symbol.toUpperCase()));
    const extra = await eodhd.searchSymbols(query, limit).catch(() => [] as SymbolSearchResult[]);
    return [
      ...free,
      // Found, not scored: the same flag the free stack puts on a worldwide hit.
      ...extra
        .filter((r) => !seen.has(r.symbol.toUpperCase()))
        .map((r) => ({ ...r, supported: false })),
    ].slice(0, limit);
  }
}

const layeredStack = new LayeredProvider();

/**
 * Whether a quote request can reach any provider at all.
 *
 * `getQuote` degrades a total failure to `null` rather than throwing — right
 * for a stock page, where "price unavailable" beats a 500. Wrong for a batch
 * script deciding whether it did any work: with every source unconfigured,
 * `fetchQuoteWithFailover` never makes a request and returns `null` for every
 * symbol just as fast as if it had — no error, and nothing to distinguish "the
 * whole universe has no data today" from "nothing here was ever going to work".
 * A refresh script should check this before spending its whole run finding
 * that out the slow way.
 */
export function hasAnyPriceProvider(): boolean {
  return eodhd.isConfigured() || PRICE_SOURCES.some((s) => s.isConfigured());
}

/**
 * Classifies a symbol as an operating company or a fund.
 * Funds file no financial statements, so balance-sheet scoring cannot apply.
 */
export async function getInstrumentType(symbol: string): Promise<InstrumentType> {
  /*
    Asked of the source that can answer, rather than skipped.

    This used to return "unknown" outright whenever EODHD was configured,
    which is not a cheaper answer — it is no answer, and this one decides
    whether a page is scored as a company or described as a fund. Turning on a
    provider therefore stopped the app recognising an ETF, which is exactly
    backwards. Twelve Data still answers, so it is still asked.
  */
  return freeStack.getInstrumentType(symbol);
}

/** Peers come from Finnhub and are optional, so they have their own accessor. */
export async function getPeers(symbol: string): Promise<string[]> {
  // Peers come from Finnhub, which does not stop working because another
  // provider was configured. Returning nothing was a choice, not a limit.
  return freeStack.getPeers(symbol);
}

/**
 * Published analyst ratings, from whichever provider can answer.
 *
 * Its own accessor for the same reason as getPeers: only some providers serve
 * it, and it is optional everywhere. Null is the ordinary answer on a
 * deployment with no Finnhub key — which includes any deployment that has not
 * accepted a personal-use licence, and that constraint is the point rather
 * than an oversight. See src/lib/signals/analysts.ts.
 */
export async function getAnalystView(symbol: string): Promise<AnalystView | null> {
  /*
    EODHD first when configured, because its ratings carry a consensus target
    price that Finnhub's free tier does not — but no longer EODHD only. That
    was the same replacement that took every price off the site: a key EODHD
    will not serve made this null on every page even with Finnhub answering.
  */
  if (eodhd.isConfigured()) {
    const fromEodhd = await eodhd.getAnalystView(symbol).catch(() => null);
    if (fromEodhd) return fromEodhd;
  }
  return freeStack.getAnalystView(symbol);
}

/** Reports which capabilities are available, for setup messaging in the UI. */
/**
 * A fund's commercial facts, from whichever provider can answer.
 *
 * EODHD first when it is configured, for two reasons. It reaches beyond the
 * SEC — a Toronto-listed ETF files with the CSA and appears nowhere in EDGAR,
 * so this is the only route to a fee for one — and it costs no extra request,
 * because the fundamentals payload it reads is already fetched and cached for
 * the company pages. Alpha Vantage answers otherwise, and its allowance is 25
 * calls a day, which is the other reason not to spend one when EODHD is there.
 */
export async function getEtfProfile(symbol: string) {
  if (eodhd.isConfigured()) {
    const fromEodhd = await eodhd.getEtfProfile(symbol).catch(() => null);
    if (fromEodhd) return fromEodhd;
  }
  return alphaVantage.getEtfProfile(symbol).catch(() => null);
}

/**
 * The company's own filings, always from EDGAR.
 *
 * These are SEC filings; there is no second opinion about them, and EODHD
 * carries none — its `getFilings` returns an empty array. So on a deployment
 * with an EODHD key, `getProvider()` handed back that empty array and every
 * company page reported "no recent filings indexed on EDGAR", which is a
 * false statement about Apple rather than a missing feature. It also removed
 * the annual report the subsidiary list is read out of.
 */
export async function getCompanyFilings(symbol: string, limit?: number): Promise<Filing[]> {
  return secEdgar.getFilings(symbol, limit).catch(() => []);
}

/**
 * The company's identity, from every source that has a piece of it.
 *
 * Merged rather than taken from whichever provider is primary, and that is a
 * correction. `getProvider()` returns EODHD whole when a key is set, so
 * turning that key on silently replaced the profile that EDGAR and Finnhub
 * had been building together — and each of them carries something the others
 * do not. EDGAR has the SIC code, which is not decoration: it drives the
 * sector gating in the scoring engine, and EODHD does not carry one at all.
 * Finnhub has the website and the logo. The result was a company page with no
 * industry, no logo and no link to the company's own site, on a deployment
 * that had just gained a provider rather than lost one.
 *
 * Each field takes the most authoritative source that has it, and any source
 * failing costs only the fields it alone supplies.
 */
export async function getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  const [sec, fin, eod] = await Promise.all([
    secEdgar.getProfile(symbol).catch(() => null),
    finnhub.isConfigured() ? finnhub.getProfile(symbol).catch(() => null) : null,
    eodhd.isConfigured() ? eodhd.getProfile(symbol).catch(() => null) : null,
  ]);

  if (!sec && !fin && !eod) return null;

  return {
    symbol: symbol.toUpperCase(),
    // EDGAR wins on identity: it is the filing of record.
    name: sec?.name ?? eod?.name ?? fin?.name ?? symbol,
    exchange: fin?.exchange ?? eod?.exchange ?? sec?.exchange ?? null,
    country: fin?.country ?? eod?.country ?? sec?.country ?? null,
    currency: fin?.currency ?? eod?.currency ?? null,
    // Only EDGAR has this, and the scoring engine needs it.
    sicCode: sec?.sicCode ?? null,
    sicDescription: sec?.sicDescription ?? null,
    industry: fin?.industry ?? eod?.industry ?? sec?.sicDescription ?? null,
    website: fin?.website ?? eod?.website ?? null,
    logo: fin?.logo ?? eod?.logo ?? null,
    marketCap: fin?.marketCap ?? eod?.marketCap ?? null,
    sharesOutstanding: fin?.sharesOutstanding ?? eod?.sharesOutstanding ?? null,
    cik: sec?.cik ?? eod?.cik ?? null,
    description: fin?.description ?? eod?.description ?? null,
    entityType: sec?.entityType ?? null,
  };
}

export function providerStatus() {
  const global = eodhd.isConfigured();
  return {
    activeProvider: getProvider().name,
    coverage: global
      ? "US and Canadian from the free stack, worldwide from EODHD where that has nothing"
      : "US and Canadian cross-listed",
    fundamentals: true,
    charts: global || twelveData.isConfigured() || tiingo.isConfigured() || yahoo.isConfigured(),
    news: global || finnhub.isConfigured(),
    priceSources: PRICE_SOURCES.filter((s) => s.isConfigured()).map((s) => s.name),
    missing: [
      ...(global || twelveData.isConfigured() ? [] : ["TWELVEDATA_API_KEY"]),
      ...(global || finnhub.isConfigured() ? [] : ["FINNHUB_API_KEY"]),
      ...(global || tiingo.isConfigured() ? [] : ["TIINGO_API_KEY (optional fallback)"]),
    ],
  };
}

export { secEdgar, twelveData, finnhub, tiingo, yahoo, eodhd };
export * from "./types";
