import { fieldValue } from "./fundamentals/normalize";
import type { NormalizedFundamentals } from "./fundamentals/types";
import {
  getFundamentalsWithSource,
  getAnalystView,
  getCompanyProfile,
  getInstrumentType,
  getNewsWithSource,
  getPeers,
  getProvider,
} from "./providers";
import type { CompanyProfile, Filing, InstrumentType, NewsItem, Quote } from "./providers/types";
import { ProviderNotConfiguredError } from "./providers/types";
import { convertFundamentals } from "./fundamentals/convert";
import { currencyForExchange } from "./exchange-currency";
import { getRate } from "./fx";
import { sectorFromSic, type SectorKind } from "./scoring/applicability";
import { buildHealthReport, type HealthReport } from "./scoring/health";
import { buildImpliedExpectations, type ImpliedExpectations } from "./scoring/expectations";
import { resolveType } from "./compare";
import { classify, findInstrument, type AssetClass, type Instrument } from "./instruments";
import { getCorporateEvents } from "./events";
import { projectNextEvents, type ProjectedEvent } from "./chart-markers";
import { getInsiderActivity, type InsiderActivity } from "./signals/insider";
import { getStakeFilings, type StakeFiling } from "./signals/stakes";
import { getShortInterest, withOwnership, type ShortInterest } from "./signals/short-interest";
import {
  getInstitutionalOwnership,
  type InstitutionalOwnership,
} from "./signals/institutional";
import type { AnalystView } from "./signals/analysts";

export interface StockPageData {
  symbol: string;
  profile: CompanyProfile | null;
  fundamentals: NormalizedFundamentals | null;
  quote: Quote | null;
  news: NewsItem[];
  /**
   * Why the news list is empty, when it is.
   *
   * "no key set" and "the key was refused" and "nothing has been written about
   * this company lately" are different situations with different remedies, and
   * an empty array cannot tell them apart.
   */
  newsStatus: { state: "ok" | "not-configured" | "failed"; message: string | null };
  /**
   * Which source the headlines came from.
   *
   * Worth showing, because the chain ends at EDGAR: a reader looking at
   * "the company reported a major event" is reading the company's own filing,
   * not a journalist's account of it, and should be able to tell.
   */
  newsSource: string | null;
  filings: Filing[];
  peers: string[];
  sector: SectorKind;
  marketCap: number | null;
  report: HealthReport | null;
  /**
   * The growth rate today's price is paying for, or null when it cannot
   * honestly be solved — a cash-burning company, a bank, or too short a
   * record. Unlike everything else on this object it is derived from the
   * price rather than from a filing, which is why the page keeps it in its
   * own labelled section.
   */
  expectations: ImpliedExpectations | null;
  /**
   * How much of the company is sold short, from FINRA's fortnightly report.
   * Null for anything it does not cover, which includes every non-US listing
   * and is the ordinary answer rather than a failure.
   */
  shortInterest: ShortInterest | null;
  /**
   * Published analyst ratings. Null without a provider key that serves them —
   * which is the ordinary state, and a licensing constraint rather than an
   * oversight. See src/lib/signals/analysts.ts.
   */
  analysts: AnalystView | null;
  /**
   * Who held the company at the last quarterly Form 13F count. Null until the
   * 13F ingest has run, and for anything outside the screening universe.
   */
  ownership: InstitutionalOwnership | null;
  /** Funds file no statements, so scoring is suppressed rather than computed. */
  instrumentType: InstrumentType;
  /**
   * What kind of thing this is, in the terms a reader thinks in.
   *
   * Separate from `instrumentType`, which answers the provider's question of
   * whether financial statements exist. These answer differently for the same
   * symbol and both are needed: gold has no statements *and* is not a fund,
   * and telling somebody looking up gold that "this is a fund, not a company"
   * would be a confident, wrong explanation.
   */
  assetClass: AssetClass;
  /** Catalogue entry, when this is a listed commodity, contract or coin. */
  instrument: Instrument | null;
  /**
   * Currency the statements were reported in. A Canadian filer reports CAD, so
   * absolute figures are not comparable with a US company's even though the
   * ratios are.
   */
  reportingCurrency: string | null;
  /**
   * The currency every figure on the page is shown in — the one the shares
   * trade in, not necessarily the one the books are kept in.
   */
  displayCurrency: string;
  /** Set when figures were restated from another currency, for the footnote. */
  converted: { from: string; rate: number } | null;
  /**
   * The documents journalism gets written from, before the write-up: insider
   * trades and pending-sale notices, 5%-ownership stakes, and a calendar
   * projected from filing cadence. All from EDGAR, all free, all optional —
   * a company with no recent activity in any of these is the ordinary case,
   * not a failure.
   */
  earlySignals: {
    insider: InsiderActivity;
    stakes: StakeFiling[];
    upcoming: ProjectedEvent[];
  };
}

/**
 * Assembles everything the stock page needs.
 *
 * Reads live from the providers rather than the database so a stock page works
 * immediately after deploy, before any ingest has run and for any symbol in
 * EDGAR — not just the precomputed screening universe. Responses are cached by
 * the fetch layer, so repeat views are cheap.
 *
 * Optional sources fail soft: missing news or an unset price key degrades that
 * section only, never the page.
 */
export async function getStockPageData(symbol: string): Promise<StockPageData> {
  const provider = getProvider();
  const upper = symbol.toUpperCase();

  // Bitcoin and the December wheat contract file no accounts anywhere, so the
  // whole fundamentals path is skipped rather than run and discarded. That is
  // not only tidier: getFundamentalsWithSource would otherwise go and ask SEC
  // EDGAR about "GC=F" on every page view, spending a request on a question
  // whose answer is knowable from the symbol.
  const assetClass = classify(upper);
  if (assetClass) return getInstrumentPageData(upper, assetClass);

  const [
    profile,
    fundamentals,
    quote,
    news,
    filings,
    peers,
    providerType,
    insider,
    stakes,
    upcoming,
    rawShortInterest,
    analysts,
  ] = await Promise.all([
      getCompanyProfile(upper).catch(() => null),
      getFundamentalsWithSource(upper).catch(() => ({
        fundamentals: null,
        currency: null,
        source: "SEC EDGAR",
      })),
      provider.getQuote(upper).catch(() => null),
      getNewsWithSource(upper, 12).then(
        ({ news: items, source }) => ({ items, source, error: null as Error | null }),
        (err: unknown) => ({
          items: [] as NewsItem[],
          source: null as string | null,
          error: err instanceof Error ? err : new Error(String(err)),
        }),
      ),
      provider.getFilings(upper, 20).catch(() => []),
      getPeers(upper).catch(() => []),
      getInstrumentType(upper).catch(() => "unknown" as InstrumentType),
      getInsiderActivity(upper).catch(
        (): InsiderActivity => ({ trades: [], pendingSales: [] }),
      ),
      getStakeFilings(upper).catch((): StakeFiling[] => []),
      /*
        A multi-year window, not the chart's usual one — projectNextEvents
        needs several observed cycles to trust a cadence at all, and the price
        chart's own default of a year would rarely clear that bar. Fetched
        here rather than reusing the chart's client-side /api/events call
        because that call is scoped to whatever range the visitor has chosen
        to view, which is the wrong lifetime for a projection.
      */
      getCorporateEvents(upper, new Date(Date.now() - 3 * 365 * 86_400_000), new Date())
        .then((events) => projectNextEvents(events))
        .catch((): ProjectedEvent[] => []),
      // Fetched without the share count, which is not known until the
      // fundamentals above resolve. Turning that into a percentage is one
      // division, and making this request wait for it would add a round trip
      // to every page load — so withOwnership finishes the job below.
      getShortInterest(upper).catch((): ShortInterest | null => null),
      getAnalystView(upper).catch((): AnalystView | null => null),
    ]);

  /*
    Figures are shown in the currency the shares trade in.

    SK hynix keeps its books in won and lists in New York; reporting ₩42.92T is
    faithful to the filing and close to useless to somebody deciding whether to
    buy it in dollars. One rate, today's, is used for every year — an accountant
    would use each year's own rate, but that mixes business performance with
    currency movement, and the comparison a reader is making is between the
    years, not between the currencies. The page says the figures are converted.
  */
  const reportingCurrency = fundamentals.currency;
  const listingCurrency = quote?.currency ?? currencyForExchange(profile?.exchange) ?? "USD";

  let resolvedFundamentals = fundamentals.fundamentals;
  let converted: { from: string; rate: number } | null = null;

  if (
    resolvedFundamentals &&
    reportingCurrency &&
    reportingCurrency.toUpperCase() !== listingCurrency.toUpperCase()
  ) {
    const rate = await getRate(reportingCurrency, listingCurrency).catch(() => null);
    // No rate means the figures stay as filed. A converted number at an invented
    // rate would be worse than an honest one in an unfamiliar currency.
    if (rate) {
      resolvedFundamentals = convertFundamentals(resolvedFundamentals, rate, listingCurrency);
      converted = { from: reportingCurrency, rate };
    }
  }

  const displayCurrency = converted ? listingCurrency : (reportingCurrency ?? listingCurrency);

  const sector = sectorFromSic(profile?.sicCode);

  // Prefer the provider's market cap; otherwise derive it from the live price
  // and the share count in the filings.
  let marketCap = profile?.marketCap ?? null;
  if (marketCap == null && quote?.price && resolvedFundamentals) {
    const shares =
      fieldValue(resolvedFundamentals.annual[0], "sharesOutstanding") ??
      profile?.sharesOutstanding ??
      null;
    if (shares) marketCap = quote.price * shares;
  }

  const report = resolvedFundamentals?.annual.length
    ? buildHealthReport(resolvedFundamentals, sector, marketCap)
    : null;

  // Solved from the price, so it needs the market cap resolved above rather
  // than the filings alone. Returns null far more often than not, which is the
  // intended behaviour rather than a gap to fill in.
  const expectations = resolvedFundamentals
    ? buildImpliedExpectations(resolvedFundamentals, sector, marketCap)
    : null;

  // The share count both ownership figures are measured against. Prefers the
  // filings over the provider's figure for the same reason every other number
  // on this page does: it is the one a reader can go and check.
  const shares =
    fieldValue(resolvedFundamentals?.annual[0], "sharesOutstanding") ??
    profile?.sharesOutstanding ??
    null;

  const shortInterest = withOwnership(rawShortInterest, shares);

  // Read from the database rather than fetched, so it needs the share count
  // that only exists once the filings above have resolved. One indexed query
  // against a handful of rows, and null whenever the quarterly ingest has not
  // run — which is the ordinary state on a fresh deployment.
  const ownership = await getInstitutionalOwnership(upper, shares).catch(() => null);

  const instrumentType = resolveType(
    providerType,
    Boolean(resolvedFundamentals?.annual.length),
    profile?.entityType,
    profile?.sicCode,
  );

  return {
    symbol: upper,
    profile,
    fundamentals: resolvedFundamentals,
    quote,
    news: news.items,
    newsStatus: describeNews(news.error),
    newsSource: news.source,
    filings,
    peers,
    sector,
    marketCap,
    report,
    expectations,
    shortInterest,
    analysts,
    ownership,
    instrumentType,
    assetClass: instrumentType === "etf" ? "etf" : "equity",
    instrument: null,
    earlySignals: { insider, stakes, upcoming },
    reportingCurrency,
    displayCurrency,
    converted,
  };
}

/**
 * Turns whatever the news provider threw into something the page can explain.
 *
 * Sorted by the error's type rather than by reading its text. Matching on the
 * message looked equivalent and was not: the message for a *refused* key names
 * the variable to go and check, so a substring test for "FINNHUB_API_KEY"
 * classified a rejected key as an absent one and told an operator who had set
 * one to go and set it.
 */
export function describeNews(error: Error | null): StockPageData["newsStatus"] {
  if (!error) return { state: "ok", message: null };

  if (error instanceof ProviderNotConfiguredError) {
    return { state: "not-configured", message: error.message };
  }
  return { state: "failed", message: error.message };
}

/** Extracts a yearly series of one canonical field, oldest first, for charting. */
export function yearlySeries(
  fundamentals: NormalizedFundamentals | null,
  field: Parameters<typeof fieldValue>[1],
  years = 6,
): { year: number; value: number }[] {
  if (!fundamentals) return [];
  return fundamentals.annual
    .slice(0, years)
    .map((p) => ({ year: p.fiscalYear, value: fieldValue(p, field) }))
    .filter((d): d is { year: number; value: number } => d.value != null)
    .reverse();
}

/**
 * The page payload for something that is not a company.
 *
 * A deliberately thin version of the assembly above. There is no profile to
 * fetch, no filings, no peers and no fundamentals — asking for them would be
 * four network calls whose answers are known in advance to be empty, and the
 * emptiness would then have to be distinguished from a genuine failure further
 * up. Only two things exist for these symbols: a price and, sometimes, news.
 *
 * The currency comes from the quote rather than being assumed. That is what
 * carries `USX` through for the eleven contracts quoted in cents, and it is
 * the single point where reading corn as dollars per bushel gets prevented.
 */
async function getInstrumentPageData(
  upper: string,
  assetClass: AssetClass,
): Promise<StockPageData> {
  const provider = getProvider();
  const instrument = findInstrument(upper);

  const [quote, news] = await Promise.all([
    provider.getQuote(upper).catch(() => null),
    getNewsWithSource(upper, 12).then(
      ({ news: items, source }) => ({ items, source, error: null as Error | null }),
      (err: unknown) => ({
        items: [] as NewsItem[],
        source: null as string | null,
        error: err instanceof Error ? err : new Error(String(err)),
      }),
    ),
  ]);

  const displayCurrency = quote?.currency ?? "USD";

  return {
    symbol: upper,
    profile: null,
    fundamentals: null,
    quote,
    news: news.items,
    newsStatus: describeNews(news.error),
    newsSource: news.source,
    filings: [],
    peers: [],
    // Sector only ever steers which scoring model applies, and none applies
    // here. "other" is the neutral value rather than a claim about gold.
    sector: "other",
    // A commodity has a spot price, not a market capitalisation. Deriving one
    // from a contract price and an invented share count would be meaningless.
    marketCap: null,
    report: null,
    // Gold has a price but no free cash flow, so there is no growth rate for
    // that price to be assuming, and no shares for anyone to have borrowed.
    expectations: null,
    shortInterest: null,
    analysts: null,
    ownership: null,
    instrumentType: "unknown",
    assetClass,
    instrument,
    // Gold files no Form 4s. These are simply empty rather than fetched and
    // discarded — see the classify() short-circuit above this function.
    earlySignals: { insider: { trades: [], pendingSales: [] }, stakes: [], upcoming: [] },
    reportingCurrency: null,
    displayCurrency,
    converted: null,
  };
}
