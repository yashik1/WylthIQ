import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { BalanceSheetVisual } from "@/components/stock/balance-sheet";
import { FundamentalsChart, type TrendSeries } from "@/components/stock/fundamentals-chart";
import { FilingsList, NewsList, PeersList, ResearchLinks } from "@/components/stock/links";
import { QuestionCard, QuestionSummary, VerdictCard } from "@/components/stock/verdict";
import { Scorecard } from "@/components/stock/scorecard";
import { WhatChanged } from "@/components/stock/what-changed";
import { PricePanel } from "@/components/stock/peer-chart";
import { RecordVisit, WatchButton } from "@/components/watchlist";
import { StrengthsAndRisks, WhatItDoes } from "@/components/stock/orientation";
import { buildBusinessSummary } from "@/lib/scoring/business";
import { buildHighlights } from "@/lib/scoring/highlights";
import { Badge, Card, CardHeader, EmptyState, RatingBadge, SectionHeading } from "@/components/ui";
import { fieldValue } from "@/lib/fundamentals/normalize";
import { money, price as fmtPrice, signedPercent } from "@/lib/format";
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
import { getFundReport } from "@/lib/etf/fund-filings";
import { alphaVantage } from "@/lib/providers/alphavantage";
import { EarlySignals } from "@/components/stock/early-signals";
import { displayName } from "@/lib/company-name";
import { breadcrumbLd, corporationLd } from "@/lib/structured-data";
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
  "delayed-15min": "delayed 15 min",
  "end-of-day": "at close",
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
    The name leads, the ticker follows.

    This page used to be titled "AAPL — financial health in plain English",
    because the metadata is generated before any company data is fetched. But
    a ticker is an identifier and a name is the subject: somebody looking for
    this page searches "Apple", and shares a link whose preview should say
    what it is about. displayName resolves it without a new round trip — see
    src/lib/company-name.ts for why that constraint shapes the whole helper.
  */
  const name = instrument ? instrument.name : await displayName(upper);
  const subject = name ? `${name} (${upper})` : upper;
  const shortSubject = name ?? upper;

  const title = instrument
    ? `${subject} — price history and backtesting`
    : `${subject} — financial health in plain English`;
  const description = instrument
    ? `Live price, long-run history and backtesting for ${shortSubject}. It files no accounts, so the company health scores do not apply.`
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
    const cik = await cikForSymbol(upper).catch(() => null);

    // Absent from EDGAR. Resolve it here, before streaming, so a genuine typo
    // can still answer 404 — but do not decide the page from that alone. A
    // fallback provider may hold statements for this company, and
    // short-circuiting to the coverage explainer here meant the fallback was
    // never asked.
    if (!cik) {
      unsupported = await resolveUnsupported(upper).catch(() => null);
      if (!unsupported) notFound();
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
  const isFund = Boolean(fund) || data.instrumentType === "etf";
  const fundProfile = isFund
    ? await alphaVantage.getEtfProfile(upper).catch(() => null)
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
    warnings.length > 0 && { id: "warning-signs", label: "Warnings" },
    { id: "health", label: "Health" },
    changes && { id: "what-changed", label: "What changed" },
    { id: "price", label: "Price" },
    hasMarketExpectations(data) && { id: "expectations", label: "Market expects" },
    report && { id: "questions", label: "Five questions" },
    keyFigures && { id: "key-figures", label: "Key figures" },
    dividends && { id: "dividend", label: "Dividend" },
    filesAccounts && { id: "financials", label: "Financials" },
    data.assetClass === "equity" && { id: "early-signals", label: "Early signals" },
    { id: "sources", label: "Sources" },
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
          ...(filesAccounts
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
      <header className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,340px),1fr))] items-end gap-6 border-b border-border pt-10 pb-[22px]">
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
          {quote?.price != null && (
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
              {/* Market value follows the price rather than the health score.
                  It is the price multiplied by the share count, so it belongs
                  to the same clock as the figure above it. */}
              {marketCap != null && (
                <p className="tnum mt-0.5 text-xs text-faint">
                  {money(marketCap)} market value
                </p>
              )}
            </div>
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

      <Section id="what-it-does">{business && <WhatItDoes summary={business} />}</Section>

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
      ) : data.instrumentType === "etf" || fund ? (
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

          {fundProfile && <FundFacts profile={fundProfile} quote={quote} />}

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

      <Section id="strengths">
        {highlights && <StrengthsAndRisks highlights={highlights} />}
      </Section>

      {/* ---- price chart ---- */}
      <Section id="price">
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
        {keyFigures && <KeyFiguresPanel figures={keyFigures} currency={currency} />}
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
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-2">
        {filesAccounts && <FilingsList filings={data.filings} />}
        <div className="space-y-4">
          <NewsList
            news={data.news}
            symbol={upper}
            status={data.newsStatus}
            source={data.newsSource}
          />
          {filesAccounts && <PeersList peers={data.peers} />}
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

      {/* ---- provenance ---- */}
      {latest && (
        <p className="text-xs text-muted">
          Financial figures are from {upper}&apos;s {latest.form} for fiscal year{" "}
          {latest.fiscalYear} (period ending {latest.end}), reported under the{" "}
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
