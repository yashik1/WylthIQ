import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { parseExchangeSuffix } from "@/lib/exchange-suffix";
import { BalanceSheetVisual } from "@/components/stock/balance-sheet";
import { FundamentalsChart, type TrendSeries } from "@/components/stock/fundamentals-chart";
import { FilingsList, NewsList, ResearchLinks } from "@/components/stock/links";
import { QuestionCard, QuestionSummary, VerdictCard } from "@/components/stock/verdict";
import { Scorecard } from "@/components/stock/scorecard";
import { WhatChanged } from "@/components/stock/what-changed";
import { FilingTimeline } from "@/components/stock/filing-timeline";
import { buildFilingTimeline } from "@/lib/filings/timeline";
import { HealthBreakdownCard, HealthHistoryCard } from "@/components/stock/health-breakdown";
import { StatementExplorer } from "@/components/stock/statement-explorer";
import { PeerSnapshot } from "@/components/stock/peer-snapshot";
import { ThesisPanel } from "@/components/thesis/thesis-panel";
import { buildHealthBreakdown } from "@/lib/scoring/health-breakdown";
import { buildHealthHistory } from "@/lib/scoring/health-history";
import { buildStatements } from "@/lib/fundamentals/statements";
import { loadPeerScores } from "@/lib/peers";
import { figuresFromFundamentals } from "@/lib/peer-context";
import { getThesis } from "@/lib/thesis/actions";
import { buildThesisReality } from "@/lib/thesis/reality";
import { MovementContextCard } from "@/components/stock/movement-context";
import { ResearchJourney } from "@/components/stock/research-journey";
import { buildMovementContext } from "@/lib/movement-context";
import { sectorMove } from "@/lib/sector-moves";
import { displaySectorFromSic } from "@/lib/scoring/sectors";
import { getProvider } from "@/lib/providers";
import { AskAboutFigures } from "@/components/stock/ask-about-figures";
import { DataChecks } from "@/components/stock/data-checks";
import { validateFundamentals } from "@/lib/fundamentals/validate";
import { isAiConfigured } from "@/lib/ai/config";
import { AI_QUESTION_OPTIONS } from "@/lib/ai/questions";
import { PricePanel } from "@/components/stock/peer-chart";
import { RecordVisit, WatchButton } from "@/components/watchlist";
import { StrengthsAndRisks, WhatItDoes } from "@/components/stock/orientation";
import { buildBusinessSummary } from "@/lib/scoring/business";
import { buildHighlights } from "@/lib/scoring/highlights";
import { Badge, Card, CardHeader, EmptyState, RatingBadge, SectionHeading } from "@/components/ui";
import { fieldValue } from "@/lib/fundamentals/normalize";
import { calendarDate, money, price as fmtPrice, signedPercent } from "@/lib/format";
import { getStockPageData, yearlySeries } from "@/lib/stock-data";
import { Suspense } from "react";
import { StockSkeleton } from "@/components/stock/skeleton";
import { UnsupportedListing } from "@/components/stock/unsupported";
import { resolveUnsupported, type UnsupportedSymbol } from "@/lib/symbol-resolver";
import { cikForSymbol } from "@/lib/providers/sec-edgar";
import { ASSET_CLASS_LABEL, classify, findInstrument } from "@/lib/instruments";
import { NotACompany } from "@/components/stock/not-a-company";
import { FundProfile } from "@/components/stock/fund-profile";
import { FundFacts } from "@/components/stock/fund-facts";
import { Subsidiaries } from "@/components/stock/subsidiaries";
import { getFundReport, loadFundMap } from "@/lib/etf/fund-filings";
import { getEtfProfile, yahoo } from "@/lib/providers";
import { isSameListing, summariseIncome } from "@/lib/etf/income";
import { getFundAnalytics } from "@/lib/etf/fund-analytics";
import { getSubsidiaries } from "@/lib/company/subsidiaries";
import { EarlySignals } from "@/components/stock/early-signals";
import { displayName } from "@/lib/company-name";
import { breadcrumbLd, corporationLd, investmentFundLd } from "@/lib/structured-data";
import { StructuredData } from "@/components/structured-data";
import { buildWarnings } from "@/lib/scoring/warnings";
import { buildDividendReport } from "@/lib/scoring/dividends";
import { WarningSigns } from "@/components/stock/warning-signs";
import { Dividends } from "@/components/stock/dividends";
import { auth } from "@/lib/auth";
import { listWatchlist } from "@/lib/watchlist/actions";
import { KeyFiguresPanel } from "@/components/stock/key-figures";
import { buildKeyFigures } from "@/lib/scoring/key-figures";
import { buildChangeReport } from "@/lib/scoring/changes";
import { buildInvestorBrief } from "@/lib/scoring/investor-brief";
import { InvestorBriefCard } from "@/components/stock/investor-brief";
import { LocalTime } from "@/components/local-time";
import { describeQuoteTime } from "@/lib/quote-time";
import { MarketExpects, hasMarketExpectations } from "@/components/stock/market-expects";
import { Section, SectionNav, type StockSection } from "@/components/stock/section-nav";

export const revalidate = 900;

/**
 * How fresh a price is, as a word.
 *
 * Sits beside the figure rather than in a badge: a reader scanning the change
 * needs to know it is fifteen minutes old at the same moment they read it,
 * and a word survives greyscale and a screen reader where a coloured pill
 * does not.
 */
const FRESHNESS_WORD: Record<string, string> = {
  "realtime-iex": "live",
  // Approximate on purpose: the delay varies by provider and exchange, and
  // one of them documents 15 to 20 minutes.
  "delayed-15min": "delayed ~15 min",
  "end-of-day": "at close",
  // No provider had a current price, so this is the last one known.
  stale: "stale — last known price",
  unknown: "timing unknown",
};

export async function generateMetadata({
  params,
}: PageProps<"/stock/[symbol]">): Promise<Metadata> {
  const { symbol } = await params;
  const upper = decodeURIComponent(symbol).toUpperCase();

  // A commodity or a coin gets a title that describes what the page actually
  // offers. "Is gold profitable, growing, or carrying too much debt" is not a
  // question anybody asked, and it is the description search engines would show.
  const instrument = findInstrument(upper);

  /*
    A suffixed ticker names a foreign listing, which the SEC fund file will
    never contain — asking it is a request to be told no.
  */
  const listing = parseExchangeSuffix(upper);

  /*
    The name leads, the ticker follows.

    This page used to be titled "AAPL — financial health in plain English",
    because the metadata is generated before any company data is fetched. But
    a ticker is an identifier and a name is the subject: somebody looking for
    this page searches "Apple", and shares a link whose preview should say
    what it is about. displayName resolves it without a new round trip — see
    src/lib/company-name.ts for why that constraint shapes the whole helper.
  */
  /*
    A foreign listing is named from the symbol directory, never from EDGAR.

    Every tier of `displayName` is EDGAR-backed, and EDGAR knows US securities
    only. Asked about a `.TO` listing's base ticker it usually knows nothing —
    the title read "VGRO.TO on the Toronto Stock Exchange" — and where it does
    know the ticker, it names a different security: CASH.TO, Global X's savings
    ETF, was titled after Pathward Financial, which is CASH in New York. The
    directory names the listing the suffix asked for, and the page body makes
    the same cached request.
  */
  const name = instrument
    ? instrument.name
    : listing
      ? ((await resolveUnsupported(upper).catch(() => null))?.name ?? null)
      : await displayName(upper);
  const subject = name ? `${name} (${upper})` : upper;
  const shortSubject = name ?? upper;

  /*
    A fund gets a fund's title.

    This page was headed "financial health in plain English" and described as
    "Is Invesco QQQ Trust profitable, growing, or carrying too much debt?" —
    for a page whose own first card says the health scores do not apply to it.
    That sentence is what a search engine shows, so the one line most readers
    saw was the one thing the page had already refused to claim.

    The SEC's fund ticker file answers it, and answers it cheaply: the map is
    memoised for the life of the process, so after the first fund page this is
    a lookup rather than a request. Metadata runs before any data is fetched,
    which is why nothing already on the page could be used here.
  */
  const isFund = instrument || listing
    ? Boolean(listing)
    : await loadFundMap()
        .then((map) => map.has(upper))
        .catch(() => false);

  const title = instrument
    ? `${subject} — price history and backtesting`
    : listing
      ? `${subject} on the ${listing.exchange}`
      : isFund
        ? `${subject} — holdings, fees and performance`
        : `${subject} — financial health in plain English`;
  const description = instrument
    ? `Live price, long-run history and backtesting for ${shortSubject}. It files no accounts, so the company health scores do not apply.`
    : listing
      ? `Price history and fund details for ${shortSubject}, the ${listing.exchange} listing — a different security from any same-named ticker elsewhere.`
      : isFund
        ? `What ${shortSubject} holds, what it charges and what it pays out — holdings taken straight from its own filings with the SEC.`
        : `Is ${shortSubject} profitable, growing, or carrying too much debt? Plain-English answers, taken straight from its regulatory filings.`;

  return {
    title,
    description,
    // Canonical, so the same company reached through a differently-cased or
    // query-decorated URL is not read as several competing pages.
    alternates: { canonical: `/stock/${encodeURIComponent(upper)}` },
    openGraph: {
      title: `${title} · WylthIQ`,
      description,
      type: "article",
      url: `/stock/${encodeURIComponent(upper)}`,
    },
    twitter: { card: "summary_large_image", title: `${title} · WylthIQ`, description },
  };
}

/**
 * Resolves the ticker before anything streams, then hands off.
 *
 * The existence check has to happen outside the Suspense boundary: once
 * streaming begins the response status is already committed, and a notFound()
 * after that renders the right page under a 200. The lookup itself is cheap —
 * the EDGAR ticker map is memoised for the life of the process.
 */
export default async function StockPage({ params }: PageProps<"/stock/[symbol]">) {
  const { symbol } = await params;
  const upper = decodeURIComponent(symbol).toUpperCase();

  /*
    A suffixed ticker is its own listing, and keeps its own page.

    An earlier version redirected VCN.TO to VCN, which fixed the 404 and lost
    the only thing the suffix was for. QQC is a US fund from Simplify and
    QQC.TO a Canadian one from CI Invesco — different funds, different
    currencies, different holdings — and a bare ticker can only ever resolve
    to one of them. Collapsing the suffixed form meant the other fund had no
    address at all.

    So the suffix survives, the page resolves the listing it names, and the
    canonical tag points at the suffixed URL rather than at the bare one.
  */
  const listing = parseExchangeSuffix(upper);

  /*
    Commodities, contracts and coins skip the EDGAR existence check entirely.

    Not an optimisation — a correctness fix. That check asks whether the SEC
    has heard of the ticker and answers 404 when it has not, which is right for
    a mistyped equity and wrong for gold: BTC-USD and GC=F are absent from
    EDGAR by nature, and both used to 404 despite having decades of price
    history one call away.
  */
  const assetClass = classify(upper);

  let unsupported: UnsupportedSymbol | null = null;
  if (!assetClass) {
    /*
      A foreign listing is never in EDGAR, so asking costs a round trip to be
      told what the suffix already said. `.TO` is a statement that this files
      in Canada.
    */
    const cik = listing ? null : await cikForSymbol(upper).catch(() => null);

    // Absent from EDGAR. Resolve it here, before streaming, so a genuine typo
    // can still answer 404 — but do not decide the page from that alone. A
    // fallback provider may hold statements for this company, and
    // short-circuiting to the coverage explainer here meant the fallback was
    // never asked.
    if (!cik) {
      unsupported = await resolveUnsupported(upper).catch(() => null);
      if (!unsupported) notFound();

      /*
        A bare ticker that trades nowhere in the US opens the listing it names.

        See `address` in symbol-resolver.ts for what the bare page got wrong.
        The SEC's fund file is consulted as well, because a US fund can be
        missing from the symbol directory and must not be sent to a Toronto
        fund that shares its ticker; if the file cannot be read, the page stays
        where it is.

        Temporary rather than permanent: the directory can gain a US listing
        for the same ticker, and a cached 308 would go on sending readers to
        Toronto after it did. The destination's canonical tag already tells
        search engines which address is the page.
      */
      if (!listing && unsupported.address) {
        const usFund = await loadFundMap()
          .then((map) => map.has(upper))
          .catch(() => true);
        if (!usFund) redirect(`/stock/${encodeURIComponent(unsupported.address)}`);
      }
    }
  }

  return (
    <Suspense
      fallback={<StockSkeleton label={assetClass ? "Loading price history…" : undefined} />}
    >
      <StockBody symbol={upper} unsupported={unsupported} />
    </Suspense>
  );
}

/**
 * When the price was last updated, only as precisely as the provider said.
 *
 * A zoned timestamp becomes a time in the reader's own zone; a bare date stays
 * a date; a time with no zone is left out rather than shown in the wrong one —
 * see describeQuoteTime.
 */
function QuoteAsOf({ asOf }: { asOf: string | null }) {
  const time = describeQuoteTime(asOf);
  if (!time) return null;

  return (
    <p className="tnum mt-0.5 text-xs text-faint">
      {time.kind === "instant" ? (
        <>
          Updated <LocalTime value={time.iso} mode="datetime" showZone />
        </>
      ) : (
        <>Last price from {calendarDate(time.date)}</>
      )}
    </p>
  );
}

/**
 * Said, not left blank, when no price came back.
 *
 * An empty space where the price belongs reads as a page still loading. The
 * filings do not depend on a price, so when there are some the reader is told
 * the analysis below still stands.
 */
function PriceUnavailable({ hasFilings }: { hasFilings: boolean }) {
  return (
    <div className="max-w-xs text-left sm:text-right">
      <p className="text-sm font-medium">Price data temporarily unavailable.</p>
      {hasFilings && (
        <p className="mt-0.5 text-xs text-muted">
          Financial analysis is still available using the latest SEC filing.
        </p>
      )}
    </div>
  );
}

/** Rates span tiny and large numbers, so the useful precision varies. */
function formatRate(rate: number): string {
  if (rate >= 100) return rate.toFixed(0);
  if (rate >= 1) return rate.toFixed(2);
  if (rate >= 0.01) return rate.toFixed(4);
  return rate.toPrecision(3);
}

/** The slow half: filings, prices and news. Streams behind the skeleton. */
async function StockBody({
  symbol: upper,
  unsupported,
}: {
  symbol: string;
  unsupported: UnsupportedSymbol | null;
}) {
  const [data, session, saved] = await Promise.all([
    getStockPageData(upper),
    auth().catch(() => null),
    listWatchlist(),
  ]);

  /*
    A fund's portfolio, and the thing that decides a fund is a fund.

    Not gated on `instrumentType === "etf"`, which was the obvious gate and the
    wrong one: that classification comes from a price provider's search index,
    and it is frequently absent. VOO — the largest index fund in the world —
    came back unclassified, so the page offered it "no financial data
    available" and stopped, which is the exact hole this is meant to close.

    The SEC's own fund ticker file is the better authority and it is free: a
    symbol listed in it *is* a registered fund, by definition, because that is
    what the file is. So membership of it decides, and the provider's opinion
    is only a fallback for a fund too new or too obscure to have filed yet.

    Skipped for the instruments that are definitionally not funds, and for
    anything that filed real company accounts — a ticker cannot be both, and
    the accounts are the stronger evidence. For an ordinary company page this
    costs one lookup in a map that is already in memory.
  */
  const notAFund =
    data.assetClass === "crypto" ||
    data.assetClass === "commodity" ||
    data.assetClass === "future" ||
    Boolean(data.fundamentals?.annual.length);
  const fund = notAFund ? null : await getFundReport(upper);

  /*
    The commercial facts, asked for only once the page knows it is a fund.

    Sequential on purpose. Alpha Vantage allows 25 requests a day, and asking
    it about every ticker that happens to have no SEC accounts would spend the
    lot on companies. Either signal is enough to ask: the N-PORT filing proves
    it is a registered fund, and `instrumentType` covers the ones that file
    under another form — SPY is a unit investment trust and has no N-PORT, but
    it certainly has an expense ratio.
  */
  /*
    And for a foreign listing, the symbol directory's own word. A Toronto fund
    files no N-PORT and its provider classification is usually absent, so
    VCN.TO and XEQT.TO rendered no fund card at all — not even the note saying
    why a fee was missing.
  */
  const isFund =
    Boolean(fund) || data.instrumentType === "etf" || unsupported?.type === "etf";
  const [fundProfile, fundIncome] = isFund
    ? await Promise.all([
        getEtfProfile(upper),
        /*
          What it paid, and the year's range, from the endpoint the price
          chart's dividend markers already come from. A fund files no accounts,
          so the sequence of payments is the only public record of its income —
          and the same call carries the 52-week high and low, so this is one
          request for both.
        */
        yahoo.getIncomeAndRange(upper).catch(() => null),
      ])
    : [null, null];

  /*
    Only if it is the same security.

    A bare ticker can be a real listing in more than one country, and the two
    are resolved independently: the quote comes from whichever price provider
    answered, the payments from Yahoo's own suffix search. For QQC those are
    two different funds — a US one from Simplify and a Canadian one from CI
    Invesco — and the page printed one's price of $24.31 beside the other's
    52-week range of $37.80–$51.57, both as "$", as though they described one
    thing.

    Currency is the check because it is the fact both sides carry. A mismatch
    means two listings, and there is no way to tell which half is the one the
    reader asked for, so both are dropped rather than guessed between.
  */
  const usableIncome =
    fundIncome && isSameListing(data.quote?.currency, fundIncome.currency)
      ? fundIncome
      : null;
  const income = usableIncome
    ? summariseIncome(usableIncome.dividends, data.quote?.price ?? null)
    : null;

  /*
    The two figures the app can work out for itself, from the holdings it just
    read and the price history it already fetches. Last, because the valuation
    needs the holdings list the profile above carries.
  */
  const analytics = isFund
    ? await getFundAnalytics(upper, fundProfile?.holdings ?? []).catch(() => null)
    : null;
  const signedIn = Boolean(session?.user?.id);
  const alreadySaved = saved.some((s) => s.symbol === upper);

  // The coverage explainer is a last resort, for when there is genuinely
  // nothing to show. Absence from EDGAR alone is not that: a US-listed fund is
  // missing from it by nature, and Roundhill Memory ETF was turned away with an
  // apology about foreign regulators while a perfectly good price history sat
  // one call away. If a price can be drawn, the ordinary page is the better
  // answer — it already explains a fund on its own terms.
  const hasSomethingToShow = Boolean(data.fundamentals?.annual.length || data.quote);
  if (unsupported && !hasSomethingToShow) {
    return <UnsupportedListing info={unsupported} />;
  }

  const { profile, fundamentals, quote, report, sector, marketCap } = data;
  const latest = fundamentals?.annual[0];

  /*
    Whether the accounts-shaped parts of the page apply at all.

    Without this, a Bitcoin page carried an empty "Reported annual figures"
    panel and a filings list apologising that "this company has no recent
    filings indexed on EDGAR" — both of which imply a company that ought to
    have filed and has not, rather than an asset that never could. An empty
    section is not neutral; it makes a claim about what is missing.
  */
  const filesAccounts = data.assetClass === "equity" || data.assetClass === "etf";

  /*
    The companies this one owns, out of Exhibit 21 of the annual report that
    is already in the filings list — no second trip to EDGAR to find a filing
    the page has already fetched. Only for operating companies: a fund holds
    securities rather than subsidiaries and files no such exhibit.
  */
  const subsidiaries =
    filesAccounts && !isFund
      ? await getSubsidiaries(upper, data.filings, profile?.name ?? null).catch(() => null)
      : null;

  // Orientation before analysis: what the business is, then what the filings
  // show going well and going badly.
  const currency = data.displayCurrency;
  const business = buildBusinessSummary(
    profile?.name ?? unsupported?.name ?? fundamentals?.entityName ?? upper,
    profile?.sicCode,
    fundamentals,
    currency,
  );
  const highlights =
    fundamentals && report ? buildHighlights(fundamentals, report, sector, currency) : null;

  /*
    Two additions that answer questions the five did not.

    Warnings compose signals already computed further down the page into one
    block near the top, for the reader who arrived with a ticker from a video
    and will not scroll. Dividends answer "does it pay me, and can it afford
    to" — deliberately outside the health score, for the reason set out in
    src/lib/scoring/dividends.ts.
  */
  const warnings = filesAccounts
    ? buildWarnings({
        report,
        filings: data.filings,
        insider: data.earlySignals.insider,
        currency,
      })
    : [];

  const dividends =
    fundamentals && data.assetClass === "equity"
      ? buildDividendReport(fundamentals, profile?.sicCode)
      : null;

  /*
    The standard figures a reader arriving from any other stock site expects.

    Several were already being ingested and stored and then never read —
    `capex` most starkly, which meant free cash flow did not exist anywhere
    in this app despite both of its inputs sitting in the database.
  */
  const keyFigures = fundamentals && filesAccounts
    ? buildKeyFigures(fundamentals, marketCap)
    : null;

  /*
    What moved since the previous annual filing.

    Null rather than empty for a company with only one year on file: one
    period is not a comparison, and a panel saying "nothing changed" would be
    a claim about the company rather than about the data.
  */
  const changes = fundamentals && filesAccounts
    ? buildChangeReport(fundamentals, currency)
    : null;
  const nextDividend =
    data.earlySignals.upcoming.find((e) => e.kind === "dividend") ?? null;

  const trends: TrendSeries[] = [
    { key: "revenue", label: "Revenue", data: yearlySeries(fundamentals, "revenue"), format: "money", kind: "bar" },
    { key: "netIncome", label: "Profit", data: yearlySeries(fundamentals, "netIncome"), format: "money", kind: "bar" },
    { key: "operatingCashFlow", label: "Cash flow", data: yearlySeries(fundamentals, "operatingCashFlow"), format: "money", kind: "bar" },
    { key: "assets", label: "Total assets", data: yearlySeries(fundamentals, "assets"), format: "money", kind: "line" },
    { key: "liabilities", label: "Total debt", data: yearlySeries(fundamentals, "liabilities"), format: "money", kind: "line" },
    { key: "equity", label: "Shareholder equity", data: yearlySeries(fundamentals, "equity"), format: "money", kind: "line" },
  ];

  const companyName =
    profile?.name ?? unsupported?.name ?? fundamentals?.entityName ?? upper;

  /*
    The filing everything accounts-based on this page came from, named once so
    every panel that cites it cites the same document the same way.
  */
  const filingLabel = latest
    ? `${companyName}'s FY${latest.fiscalYear} ${latest.form}${latest.filedAt ? `, filed ${calendarDate(latest.filedAt)}` : ""}`
    : null;

  /*
    The summary at the top, assembled from the panels already built above
    rather than computed afresh, so the brief and the detail beneath it can
    never disagree. Operating companies only: a fund, a coin and a contract
    have no health report to summarise, and keep the plain description.
  */
  const brief =
    report && latest && filesAccounts
      ? buildInvestorBrief({
          name: companyName,
          business,
          report,
          changes,
          warnings,
          highlights,
          keyFigures,
          latest,
          marketCap,
        })
      : null;

  // Every filing in order, carrying the figures behind each report when this
  // page holds that period. Funds file none of these forms, so theirs is empty.
  const timeline = filesAccounts
    ? buildFilingTimeline(data.filings, fundamentals ?? null, currency)
    : [];

  /*
    The score taken apart, and how it has moved. Each past year is scored from
    its annual report as first filed, so a later restatement never rewrites an
    earlier point. Operating companies only: a fund has no score to explain.
  */
  const breakdown =
    report && fundamentals && filesAccounts && !isFund ? buildHealthBreakdown(report, fundamentals) : null;
  const healthHistory =
    report && filesAccounts && !isFund ? buildHealthHistory(fundamentals, sector) : null;
  const statements =
    fundamentals && filesAccounts && !isFund ? buildStatements(fundamentals, currency) : null;
  const dataChecks =
    fundamentals && filesAccounts && !isFund ? validateFundamentals(fundamentals, sector) : null;

  /*
    The reader's own thesis, this company's peers from the nightly scores, and
    today's move set beside its sector and the market. All independent, so
    they run together; each fails soft to nothing.
  */
  const movesToday = data.assetClass === "equity" && !isFund && quote?.changePercent != null;
  const market = upper.endsWith(".TO")
    ? { symbol: "^GSPTSE", label: "S&P/TSX Composite" }
    : { symbol: "^GSPC", label: "S&P 500" };
  const [thesis, peerScores, sectorReading, marketQuote] = await Promise.all([
    report && signedIn && !isFund ? getThesis(upper) : Promise.resolve(null),
    filesAccounts && !isFund && data.peers.length > 0
      ? loadPeerScores(data.peers)
      : Promise.resolve([]),
    movesToday ? sectorMove(displaySectorFromSic(profile?.sicCode), upper) : Promise.resolve(null),
    movesToday ? getProvider().getQuote(market.symbol).catch(() => null) : Promise.resolve(null),
  ]);
  const movement = movesToday
    ? buildMovementContext({
        symbol: upper,
        stockChange: quote?.changePercent ?? null,
        sector: sectorReading,
        market:
          marketQuote?.changePercent != null
            ? { label: market.label, change: marketQuote.changePercent }
            : null,
        filings: data.filings,
        news: data.news,
        now: new Date(),
      })
    : null;
  const latestReport =
    data.filings.find((filing) => /^(10-K|10-Q|20-F|40-F)(\/A)?$/.test(filing.form)) ?? null;

  // Grounded explanations, only where an operator has switched them on.
  const askable = Boolean(report && latest && !isFund && isAiConfigured());
  const thesisReality = thesis
    ? buildThesisReality(thesis.conditions, thesis.createdAt, fundamentals)
    : null;
  const subjectFigures =
    report && fundamentals
      ? figuresFromFundamentals(upper, fundamentals, marketCap, report.score)
      : null;

  /*
    Jump links, in the order the sections appear.

    Built from the same conditions that decide whether each panel renders, so
    the strip never offers a link to something that is not on the page. Two of
    them — the warning signs and the expectations section — hide themselves on
    conditions this scope cannot see, which is why SectionNav also drops any
    target it cannot find once mounted. "What it does" and the strengths panel
    are deliberately absent: both sit at the very top, where a jump link saves
    a reader nothing.
  */
  const sections: StockSection[] = [
    brief && { id: "overview", label: "Overview" },
    warnings.length > 0 && { id: "warning-signs", label: "Risks" },
    { id: "health", label: "Health" },
    changes && { id: "what-changed", label: "What changed" },
    askable && { id: "ask", label: "Ask" },
    { id: "price", label: "Price" },
    hasMarketExpectations(data) && { id: "expectations", label: "Expectations" },
    report && { id: "questions", label: "Five questions" },
    keyFigures && { id: "key-figures", label: "Key figures" },
    dividends && { id: "dividend", label: "Dividends" },
    filesAccounts && { id: "financials", label: "Financials" },
    statements && { id: "statements", label: "Statements" },
    filesAccounts && data.peers.length > 0 && { id: "peers", label: "Peers" },
    data.assetClass === "equity" && { id: "early-signals", label: "Early signals" },
    timeline.length > 0 && { id: "timeline", label: "Timeline" },
    report && !isFund && { id: "thesis", label: "Thesis" },
    filesAccounts && { id: "filings", label: "Filings" },
    !filesAccounts && { id: "sources", label: "News" },
  ].filter((s): s is StockSection => Boolean(s));

  return (
    <div className="space-y-5">
      {/*
        Structured data, so a search result can say this page is about a
        corporation with a ticker rather than leaving a crawler to infer it
        from the prose. Emitted only for things that actually are companies —
        marking Bitcoin up as a Corporation would be a lie in a machine-readable
        format, which is the worst place to tell one.
      */}
      <StructuredData
        data={[
          /*
            A fund and a company are different things, and were being
            described as the same thing: `filesAccounts` covers both, so every
            ETF was published to crawlers as a Corporation — with no revenue,
            no employees and no business, because it has none.
          */
          ...(fund || fundProfile
            ? [
                investmentFundLd({
                  symbol: upper,
                  name: companyName,
                  expenseRatio: fundProfile?.expenseRatio,
                  holdingCount: fund?.portfolio.holdingCount ?? null,
                }),
              ]
            : filesAccounts
              ? [
                  corporationLd({
                    symbol: upper,
                    name: companyName,
                    exchange: profile?.exchange,
                    website: profile?.website,
                    cik: profile?.cik,
                    industry: profile?.industry,
                  }),
                ]
              : []),
          breadcrumbLd([
            { name: "WylthIQ", path: "/" },
            { name: companyName, path: `/stock/${encodeURIComponent(upper)}` },
          ]),
        ]}
      />

      {/*
        The head answers "what am I looking at, and what is it worth" before
        anything else on the page.

        The company's name carries the h1 and the ticker sits beside it, which
        is the way round a reader thinks: the symbol is an identifier, the name
        is the subject. The price moved here from the verdict card, where it
        sat next to a health score computed from an annual filing — two
        figures on utterly different clocks, presented as a pair.
      */}
      <header
        id="company-header"
        className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-end gap-6 border-b border-border pt-10 pb-[22px]"
      >
        <div className="min-w-0">
          <p className="eyebrow mb-2">
            {[
              profile?.exchange ?? unsupported?.exchange,
              data.instrument ? ASSET_CLASS_LABEL[data.assetClass] : profile?.industry,
              profile?.cik ? `CIK ${profile.cik}` : null,
              data.instrument?.unit,
            ]
              .filter(Boolean)
              .join(" · ") || "Company filing"}
          </p>

          <div className="flex flex-wrap items-baseline gap-x-3.5 gap-y-2">
            <h1 className="font-display text-[2.75rem] leading-none">
              {data.instrument?.name ??
                profile?.name ??
                unsupported?.name ??
                fundamentals?.entityName ??
                upper}
            </h1>
            <span className="text-[1.1875rem] font-bold tracking-[0.06em] text-muted">
              {upper}
            </span>
            {report?.score != null && (
              <RatingBadge
                rating={report.score >= 7.5 ? "good" : report.score >= 5 ? "fair" : "poor"}
                label={`Health ${report.score.toFixed(1)} / 10`}
              />
            )}
            {sector === "financial" && (
              <Badge title="Some scoring models do not apply to financial companies.">
                Financial sector
              </Badge>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end justify-start gap-x-6 gap-y-3 sm:justify-end">
          {quote?.price != null ? (
            <div className="text-left sm:text-right">
              <p className="tnum font-display text-[2.375rem] leading-none">
                {fmtPrice(quote.price, currency)}
              </p>
              <p
                className={`tnum mt-0.5 text-[0.84375rem] ${
                  (quote.changePercent ?? 0) >= 0 ? "text-up" : "text-down"
                }`}
              >
                {signedPercent(quote.changePercent)}
                {/* The word, not just a badge: "delayed" has to survive being
                    read aloud and being seen in greyscale. */}
                <span className="text-muted"> · {FRESHNESS_WORD[quote.freshness]}</span>
              </p>
              <QuoteAsOf asOf={quote.asOf} />
              {/* Market value follows the price rather than the health score.
                  It is the price multiplied by the share count, so it belongs
                  to the same clock as the figure above it. */}
              {marketCap != null && (
                <p className="tnum mt-0.5 text-xs text-faint">
                  {money(marketCap)} market value
                </p>
              )}
            </div>
          ) : (
            <PriceUnavailable hasFilings={Boolean(report)} />
          )}
          <WatchButton
            symbol={upper}
            name={profile?.name ?? unsupported?.name ?? fundamentals?.entityName}
            signedIn={signedIn}
            initialSaved={alreadySaved}
          />
        </div>
      </header>

      <SectionNav sections={sections} />

      <RecordVisit
        symbol={upper}
        name={profile?.name ?? unsupported?.name ?? fundamentals?.entityName}
      />

      {report && !isFund && (
        <ResearchJourney
          symbol={upper}
          hasOverview={Boolean(brief)}
          hasChanges={Boolean(changes)}
          hasPeers={filesAccounts && data.peers.length > 0}
          latestFiling={latestReport ? { form: latestReport.form, url: latestReport.url } : null}
          saved={alreadySaved}
          hasThesis={Boolean(thesis)}
        />
      )}

      {brief ? (
        <Section id="overview">
          <InvestorBriefCard brief={brief} companyName={companyName} />
        </Section>
      ) : (
        <Section id="what-it-does">{business && <WhatItDoes summary={business} />}</Section>
      )}

      <Section id="warning-signs">
        <WarningSigns warnings={warnings} />
      </Section>

      {/* ---- verdict ---- */}
      <Section id="health">
      {report ? (
        <div className="space-y-5">
          <VerdictCard
            report={report}
            companyName={profile?.name ?? unsupported?.name ?? upper}
          />
          {breakdown && <HealthBreakdownCard breakdown={breakdown} />}
          {healthHistory && <HealthHistoryCard history={healthHistory} />}
          {/* The working behind the headline, directly under it. The three
              model figures in the card above are the summary; this is what
              they are made of. */}
          <Scorecard report={report} />
        </div>
      ) : data.assetClass === "crypto" ||
        data.assetClass === "commodity" ||
        data.assetClass === "future" ? (
        <NotACompany
          symbol={upper}
          assetClass={data.assetClass}
          instrument={data.instrument}
        />
      ) : isFund ? (
        /*
          A fund holds other assets rather than running a business, so there is
          no balance sheet to score. Saying that plainly is more useful than an
          empty card implying the data merely failed to load — but on its own
          it was still a dead end, telling a reader what the page could not do
          and nothing about the thing they looked up. A fund is not
          unanalysable, only analysable differently, so when its own portfolio
          filing can be read it goes directly underneath.
        */
        <div className="space-y-5">
          <Card className="p-5">
            <h2 className="text-base font-semibold">This is a fund, not a company</h2>
            <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
              {profile?.name ?? upper} is an ETF or trust — a basket of other holdings. It
              has no revenue, no balance sheet and files no annual report, so the
              profitability, debt and accounting scores used for companies have nothing to
              measure here.{" "}
              {fund
                ? "What it owns is a matter of public record, and it is below."
                : "Price history below still applies."}
            </p>
            {!fund && (
              <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted">
                <Link
                  href={`/compare?symbols=${encodeURIComponent(upper)},SPY`}
                  className="text-accent underline"
                >
                  Comparing its performance
                </Link>{" "}
                against other funds or the wider market is a meaningful way to judge it.
              </p>
            )}
          </Card>

          {(fundProfile || income) && (
            <FundFacts
              profile={fundProfile}
              quote={quote}
              income={income}
              range={usableIncome}
              analytics={analytics}
              currency={data.displayCurrency}
              filesWithSec={Boolean(fund)}
            />
          )}

          {fund && (
            <FundProfile
              symbol={upper}
              portfolio={fund.portfolio}
              filing={fund.filing}
            />
          )}
        </div>
      ) : (
        <Card>
          <EmptyState
            title="No financial data available"
            description={`${upper} has no XBRL financial statements in SEC EDGAR. This usually means it is not a US or Canadian cross-listed filer.`}
          />
        </Card>
      )}

      </Section>

      {/* Directly under the score, because "it scores 9 out of 10" and "its
          margin fell four points" are the same reader's next two questions. */}
      <Section id="what-changed">
        {changes && <WhatChanged report={changes} />}
      </Section>

      <Section id="ask">
        {askable && (
          <AskAboutFigures
            symbol={upper}
            companyName={companyName}
            signedIn={signedIn}
            questions={AI_QUESTION_OPTIONS}
          />
        )}
      </Section>

      <Section id="strengths">
        {highlights && <StrengthsAndRisks highlights={highlights} />}
      </Section>

      {/* ---- price chart ---- */}
      <Section id="price" className="space-y-5">
      {movement && (
        <MovementContextCard
          context={movement}
          freshness={quote ? (FRESHNESS_WORD[quote.freshness] ?? null) : null}
        />
      )}
      <Card>
        <CardHeader
          title="Price history"
          subtitle={
            data.peers.length > 0
              ? "Filter by minute, hour, day or week — or compare against peers"
              : "Filter by minute, hour, day or week"
          }
        />
        <div className="p-5">
          <PricePanel symbol={upper} peers={data.peers} />
        </div>
      </Card>
      </Section>

      {/* ---- what the market expects ---- */}
      {/* Sits with the price because it is about the price, and above the five
          questions so the run of filing-derived answers stays unbroken. */}
      <Section id="expectations">
      <MarketExpects
        expectations={data.expectations}
        analysts={data.analysts}
        shortInterest={data.shortInterest}
        ownership={data.ownership}
        currentPrice={data.quote?.price ?? null}
        currency={currency}
      />
      </Section>

      {/* ---- the five questions ---- */}
      {report && (
        <section id="questions" aria-labelledby="questions-heading">
          <SectionHeading
            eyebrow="The essentials"
            title="The five questions that matter"
            description="Each answered from the filings, with the numbers behind it."
          />
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
              {report.questions.map((q) => (
                <QuestionCard key={q.key} question={q} />
              ))}
            </div>
            <div className="xl:sticky xl:top-20 xl:self-start">
              <QuestionSummary questions={report.questions} />
            </div>
          </div>
        </section>
      )}

      <Section id="key-figures">
        {keyFigures && (
          <KeyFiguresPanel figures={keyFigures} currency={currency} filing={filingLabel} />
        )}
      </Section>

      {/* ---- what it pays out ---- */}
      <Section id="dividend">
      {dividends && (
        <Dividends
          report={dividends}
          currency={currency}
          nextExpected={dividends.paysDividend ? nextDividend : null}
        />
      )}
      </Section>

      {/* ---- balance sheet + trends ---- */}
      <div
        id="financials"
        className="grid grid-cols-[minmax(0,1fr)] gap-4 empty:hidden lg:grid-cols-2"
      >
        {fundamentals && (
          <BalanceSheetVisual fundamentals={fundamentals} sector={sector} currency={currency} />
        )}
        {filesAccounts && (
          <Card>
            <CardHeader
              title="How it has changed over time"
              subtitle="Reported annual figures"
            />
            <FundamentalsChart series={trends} currency={currency} />
          </Card>
        )}
      </div>

      {/* ---- the three statements, annual and quarterly ---- */}
      <Section id="statements">
        {statements && <StatementExplorer data={statements} />}
      </Section>

      {/* ---- against similar companies ---- */}
      <Section id="peers">
        {filesAccounts && data.peers.length > 0 && (
          <PeerSnapshot
            symbol={upper}
            name={companyName}
            subject={subjectFigures}
            subjectFScore={
              report?.piotroski.maxScore
                ? { score: report.piotroski.score, max: report.piotroski.maxScore }
                : null
            }
            peers={peerScores}
            peerSymbols={data.peers}
          />
        )}
      </Section>

      {/*
        Early signals — insider trades, pending sales, ownership stakes, a
        projected calendar. Equity only, not funds: an ETF's trust has
        officers of its own on file, but their trading activity is not the
        thing a reader of a fund page is here to learn about.
      */}
      <Section id="early-signals">
      {data.assetClass === "equity" && (
        <EarlySignals
          symbol={upper}
          insider={data.earlySignals.insider}
          stakes={data.earlySignals.stakes}
          upcoming={data.earlySignals.upcoming}
        />
      )}
      </Section>

      {/* ---- what it filed, in order ---- */}
      <Section id="timeline">
        {timeline.length > 0 && <FilingTimeline years={timeline} />}
      </Section>

      {/* ---- the reader's own thesis ---- */}
      <Section id="thesis">
        {report && !isFund && (
          <ThesisPanel
            symbol={upper}
            companyName={companyName}
            signedIn={signedIn}
            thesis={thesis}
            reality={thesisReality}
          />
        )}
      </Section>

      {/* ---- sources ---- */}
      <Section id="sources" className="space-y-5">
      <SectionHeading
        eyebrow="Go deeper"
        title={filesAccounts ? "Sources and further reading" : "News and further reading"}
        description={
          filesAccounts
            ? "Every figure above traces back to one of these filings."
            : "There are no filings to trace back to, but the market still gets written about."
        }
      />
      {subsidiaries && <Subsidiaries report={subsidiaries} />}

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {filesAccounts && (
          <div id="filings">
            <FilingsList filings={data.filings} />
          </div>
        )}
        <div className="space-y-4">
          <NewsList
            news={data.news}
            symbol={upper}
            status={data.newsStatus}
            source={data.newsSource}
          />
          {filesAccounts && (
            <ResearchLinks
              symbol={upper}
              cik={profile?.cik ?? null}
              website={profile?.website ?? null}
            />
          )}
        </div>
      </div>
      </Section>

      {dataChecks && <DataChecks checks={dataChecks} />}

      {/* ---- provenance ---- */}
      {latest && (
        <p className="text-xs text-muted">
          Financial figures are from {upper}&apos;s {latest.form} for fiscal year{" "}
          {latest.fiscalYear} (period ending {latest.end}
          {latest.filedAt ? `, filed ${calendarDate(latest.filedAt)}` : ""}), reported under the{" "}
          {fundamentals?.taxonomy === "ifrs-full" ? "IFRS" : "US GAAP"} taxonomy.
          {data.converted && (
            <>
              {" "}
              Reported in {data.converted.from} and shown here in{" "}
              {data.displayCurrency}, the currency {upper} trades in, converted at
              today&apos;s rate of {formatRate(data.converted.rate)}. The filing itself
              is in {data.converted.from}.
            </>
          )}
          {report?.sourceFilingUrl && (
            <>
              {" "}
              <a
                className="underline hover:text-foreground"
                href={report.sourceFilingUrl}
                target="_blank"
                rel="noreferrer noopener"
              >
                View the source filing
              </a>
              .
            </>
          )}
          {fundamentals && fieldValue(latest, "liabilities") != null &&
            latest.facts.liabilities?.derived && (
              <> Total liabilities were not tagged directly and were calculated as assets minus equity.</>
            )}
        </p>
      )}
    </div>
  );
}
