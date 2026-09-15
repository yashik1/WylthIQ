import { eq, sql } from "drizzle-orm";
import { getDb } from "./db";
import { companies, financials, ingestRuns, scores } from "./db/schema";
import { fieldValue } from "./fundamentals/normalize";
import type { CanonicalField, NormalizedFundamentals } from "./fundamentals/types";
import { finnhub, getProvider, quoteSourcesFor, secEdgar } from "./providers";
import { fetchQuoteWithFailover } from "./providers/failover";
import type { Quote } from "./providers/types";
import { priceTime } from "./quote-session";
import { cikForSymbol } from "./providers/sec-edgar";
import { sectorFromSic } from "./scoring/applicability";
import { displaySectorFromSic } from "./scoring/sectors";
import { buildHealthReport } from "./scoring/health";
import { div } from "./scoring/math";
import { isCanadian } from "./universe";

/**
 * SEC fair use is 10 requests/second. Each symbol costs two EDGAR calls, so a
 * concurrency of 4 with a small delay keeps well clear of the limit — exceeding
 * it earns roughly a 10 minute IP block.
 */
const CONCURRENCY = 4;
const DELAY_MS = 120;

export interface IngestResult {
  processed: number;
  failed: number;
  errors: { symbol: string; error: string }[];
  durationMs: number;
}

/** Runs `worker` over `items` with bounded concurrency. */
async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;

  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
      if (DELAY_MS) await new Promise((r) => setTimeout(r, DELAY_MS));
    }
  });

  await Promise.all(runners);
  return results;
}

const FINANCIAL_COLUMNS: CanonicalField[] = [
  "assets", "liabilities", "equity", "currentAssets", "currentLiabilities",
  "cash", "receivables", "inventory", "ppe", "longTermDebt", "shortTermDebt",
  "retainedEarnings", "revenue", "costOfRevenue", "grossProfit", "operatingIncome",
  "netIncome", "incomeBeforeTax", "interestExpense", "sga", "depreciation",
  "operatingCashFlow", "capex", "dividendsPaid", "sharesOutstanding",
];

/**
 * Resolves market capitalisation.
 *
 * Prefers Finnhub's reported figure, then falls back to a live price
 * multiplied by the share count from the filings. The fallback matters because
 * market cap drives the P/E, P/B and P/S ratios and the Altman leverage term.
 *
 * The fallback asks `getProvider()` rather than Twelve Data directly, and that
 * is the whole fix. Every other price read in the app goes through the
 * failover chain, which ends at Yahoo — keyless, unmetered, and the source
 * actually serving quotes on the live deployment. This one function reached
 * past it to two named providers: Finnhub, whose key the deployment has
 * rejected for weeks, and Twelve Data, whose free tier is 8 requests a minute
 * against a universe of 542 companies. So `marketCap` came back null for
 * essentially every company, and with it every P/E, P/B, P/S and dividend
 * yield in the database — the screener showed a column of dashes while the
 * dashboard, reading the same prices through the chain, worked perfectly.
 */
async function resolveMarketCap(
  symbol: string,
  fundamentals: NormalizedFundamentals,
): Promise<number | null> {
  if (finnhub.isConfigured()) {
    const profile = await finnhub.getProfile(symbol).catch(() => null);
    if (profile?.marketCap) return profile.marketCap;
  }

  const shares = fieldValue(fundamentals.annual[0], "sharesOutstanding");
  if (!shares) return null;

  const quote = await getProvider().getQuote(symbol).catch(() => null);
  return quote?.price ? quote.price * shares : null;
}

/** Fetches, scores and stores one company. */
export async function ingestSymbol(symbol: string): Promise<void> {
  const db = getDb();

  const cik = await cikForSymbol(symbol);
  if (!cik) throw new Error(`no CIK found in EDGAR for ${symbol}`);

  const [fundamentals, profile] = await Promise.all([
    secEdgar.getFundamentalsByCik(cik),
    secEdgar.getProfile(symbol),
  ]);

  if (!fundamentals || fundamentals.annual.length === 0) {
    throw new Error(`no XBRL financial data for ${symbol}`);
  }

  const sector = sectorFromSic(profile?.sicCode);
  const marketCap = await resolveMarketCap(symbol, fundamentals);
  const report = buildHealthReport(fundamentals, sector, marketCap);

  const finnhubProfile = finnhub.isConfigured()
    ? await finnhub.getProfile(symbol).catch(() => null)
    : null;

  // ---- company ----
  const [company] = await db
    .insert(companies)
    .values({
      symbol: symbol.toUpperCase(),
      cik,
      name: profile?.name ?? fundamentals.entityName,
      exchange: finnhubProfile?.exchange ?? profile?.exchange ?? null,
      country: isCanadian(symbol) ? "CA" : (finnhubProfile?.country ?? "US"),
      sicCode: profile?.sicCode ?? null,
      sicDescription: profile?.sicDescription ?? null,
      sectorKind: sector,
      displaySector: displaySectorFromSic(profile?.sicCode),
      industry: finnhubProfile?.industry ?? profile?.sicDescription ?? null,
      logoUrl: finnhubProfile?.logo ?? null,
      website: finnhubProfile?.website ?? null,
      isCanadian: isCanadian(symbol),
      isActive: true,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: companies.symbol,
      set: {
        cik,
        name: profile?.name ?? fundamentals.entityName,
        sicCode: profile?.sicCode ?? null,
        sicDescription: profile?.sicDescription ?? null,
        sectorKind: sector,
        displaySector: displaySectorFromSic(profile?.sicCode),
        industry: finnhubProfile?.industry ?? profile?.sicDescription ?? null,
        logoUrl: finnhubProfile?.logo ?? null,
        website: finnhubProfile?.website ?? null,
        updatedAt: new Date(),
      },
    })
    .returning({ id: companies.id });

  // ---- financials, one row per fiscal year ----
  for (const period of fundamentals.annual) {
    const row: Record<string, unknown> = {
      companyId: company.id,
      fiscalYear: period.fiscalYear,
      endDate: period.end,
      form: period.form,
      currency: period.facts.assets?.unit ?? "USD",
      sourceFilingUrl: period.facts.assets?.sourceFilingUrl ?? null,
      // The date this period's own facts were filed — see the column comment
      // in schema.ts. Explicitly re-set on conflict, unlike currency and
      // sourceFilingUrl above: a restatement moves this date forward, and a
      // point-in-time backtest depends on it being current.
      filedAt: period.filedAt,
    };
    for (const field of FINANCIAL_COLUMNS) {
      row[field] = period.facts[field]?.value ?? null;
    }

    await db
      .insert(financials)
      .values(row as typeof financials.$inferInsert)
      .onConflictDoUpdate({
        target: [financials.companyId, financials.fiscalYear],
        set: {
          ...Object.fromEntries(FINANCIAL_COLUMNS.map((f) => [f, row[f] ?? null])),
          filedAt: row.filedAt ?? null,
        } as Partial<typeof financials.$inferInsert>,
      });
  }

  // ---- derived screening metrics ----
  const latest = fundamentals.annual[0];
  const prior = fundamentals.annual[1];
  const netIncome = fieldValue(latest, "netIncome");
  const revenue = fieldValue(latest, "revenue");
  const priorRevenue = prior ? fieldValue(prior, "revenue") : null;

  await db
    .insert(scores)
    .values({
      companyId: company.id,
      fiscalYear: report.fiscalYear,
      healthScore: report.score,
      fScore: report.piotroski.score,
      fScoreMax: report.piotroski.maxScore,
      zScore: report.altman.value?.z ?? null,
      zZone: report.altman.value?.zone ?? null,
      zApplicable: report.altman.applicable,
      mScore: report.beneish.value?.m ?? null,
      mFlagged: report.beneish.value?.flagged ?? null,
      mApplicable: report.beneish.applicable,
      marketCap,
      peRatio: netIncome && netIncome > 0 ? div(marketCap, netIncome) : null,
      pbRatio: div(marketCap, fieldValue(latest, "equity")),
      psRatio: div(marketCap, revenue),
      dividendYield: div(
        Math.abs(fieldValue(latest, "dividendsPaid") ?? 0) || null,
        marketCap,
      ),
      revenueGrowth:
        revenue != null && priorRevenue != null && priorRevenue !== 0
          ? (revenue - priorRevenue) / Math.abs(priorRevenue)
          : null,
      netMargin: div(netIncome, revenue),
      returnOnAssets: div(netIncome, fieldValue(latest, "assets")),
      debtToEquity: div(fieldValue(latest, "liabilities"), fieldValue(latest, "equity")),
      currentRatio: div(
        fieldValue(latest, "currentAssets"),
        fieldValue(latest, "currentLiabilities"),
      ),
      questions: report.questions,
      headline: report.headline,
      computedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: scores.companyId,
      set: {
        fiscalYear: report.fiscalYear,
        healthScore: report.score,
        fScore: report.piotroski.score,
        fScoreMax: report.piotroski.maxScore,
        zScore: report.altman.value?.z ?? null,
        zZone: report.altman.value?.zone ?? null,
        zApplicable: report.altman.applicable,
        mScore: report.beneish.value?.m ?? null,
        mFlagged: report.beneish.value?.flagged ?? null,
        mApplicable: report.beneish.applicable,
        marketCap,
        peRatio: netIncome && netIncome > 0 ? div(marketCap, netIncome) : null,
        pbRatio: div(marketCap, fieldValue(latest, "equity")),
        psRatio: div(marketCap, revenue),
        revenueGrowth:
          revenue != null && priorRevenue != null && priorRevenue !== 0
            ? (revenue - priorRevenue) / Math.abs(priorRevenue)
            : null,
        netMargin: div(netIncome, revenue),
        returnOnAssets: div(netIncome, fieldValue(latest, "assets")),
        debtToEquity: div(fieldValue(latest, "liabilities"), fieldValue(latest, "equity")),
        currentRatio: div(
          fieldValue(latest, "currentAssets"),
          fieldValue(latest, "currentLiabilities"),
        ),
        questions: report.questions,
        headline: report.headline,
        computedAt: new Date(),
      },
    });
}

/**
 * Ingests a list of symbols, recording the run for auditability.
 *
 * Individual failures are collected rather than aborting the batch: one company
 * with malformed XBRL should not stop the other several hundred.
 */
export async function ingestSymbols(
  symbols: string[],
  onProgress?: (done: number, total: number, symbol: string) => void,
): Promise<IngestResult> {
  const db = getDb();
  const started = Date.now();

  const [run] = await db.insert(ingestRuns).values({ status: "running" }).returning({
    id: ingestRuns.id,
  });

  const errors: { symbol: string; error: string }[] = [];
  let done = 0;

  await mapLimit(symbols, CONCURRENCY, async (symbol) => {
    try {
      await ingestSymbol(symbol);
    } catch (err) {
      errors.push({ symbol, error: err instanceof Error ? err.message : String(err) });
    } finally {
      onProgress?.(++done, symbols.length, symbol);
    }
  });

  const result: IngestResult = {
    processed: symbols.length - errors.length,
    failed: errors.length,
    errors,
    durationMs: Date.now() - started,
  };

  await db
    .update(ingestRuns)
    .set({
      finishedAt: new Date(),
      processed: result.processed,
      failed: result.failed,
      status: errors.length === symbols.length ? "failed" : "completed",
      notes: errors.length
        ? errors.slice(0, 20).map((e) => `${e.symbol}: ${e.error}`).join("; ")
        : null,
    })
    .where(eq(ingestRuns.id, run.id));

  return result;
}

/**
 * Returns the symbols whose scores are most out of date.
 *
 * Used by the refresh endpoint, which processes a bounded slice per call so a
 * single request cannot run for an unbounded time. `npm run ingest` refreshes
 * everything in one pass.
 */
/**
 * The symbols whose stored quote is oldest.
 *
 * The quote cron used to take `getUniverse().slice(0, batch)`, which is the
 * same first 120 symbols on every single call. Scheduled hourly, that would
 * refresh those 120 forever and leave the other 400-odd frozen at whenever
 * somebody last ran the script by hand — and because the movers list ranks
 * across the whole universe, the stalest rows would sit at the top of
 * "biggest risers" permanently. A list that never changes is exactly what
 * that looks like from outside.
 *
 * Ordering by `priceUpdatedAt` instead means consecutive calls walk the whole
 * universe and then come back around.
 */
export async function getStaleQuoteSymbols(limit: number): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ symbol: companies.symbol })
    .from(companies)
    .leftJoin(scores, eq(scores.companyId, companies.id))
    .where(eq(companies.isActive, true))
    // NULLS FIRST so a company that has never had a quote is fetched before
    // one that merely has an old a one.
    .orderBy(sql`${scores.priceUpdatedAt} ASC NULLS FIRST`)
    .limit(limit);

  return rows.map((r) => r.symbol);
}

export async function getStaleSymbols(limit: number): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ symbol: companies.symbol })
    .from(companies)
    .leftJoin(scores, eq(scores.companyId, companies.id))
    .where(eq(companies.isActive, true))
    .orderBy(sql`${scores.computedAt} ASC NULLS FIRST`)
    .limit(limit);

  return rows.map((r) => r.symbol);
}


/**
 * Refreshes the stored quote for a list of symbols.
 *
 * Kept separate from the fundamentals ingest because the two move at completely
 * different speeds: filings change quarterly, prices change constantly. Running
 * this on its own means the movers list and the sector heatmap can be current
 * without re-reading every annual report.
 *
 * Concurrency is lower than the fundamentals pass because this hits the price
 * providers rather than SEC EDGAR, and the free plans there are the tighter
 * constraint — Finnhub allows 60 requests a minute.
 */
export interface QuoteRefreshResult {
  /** Rows written with a current price. */
  updated: number;
  /** Quotes that came back too old to be current, whether or not they were saved. */
  stale: number;
  /** Symbols for which no provider had any price at all. */
  unavailable: number;
  failed: number;
  errors: string[];
  /** Which provider supplied each current price. */
  answeredBy: Record<string, number>;
  /**
   * Provider failures, as "Provider=CATEGORY", counted across symbols.
   *
   * Categories only. A provider's own error text can quote the request URL,
   * and several carry the API key in it, so the raw message is never counted
   * or printed.
   */
  providerFailures: Record<string, number>;
  /** The newest date among the stale quotes, when some came back stale. */
  newestStale: string | null;
}

export async function refreshQuotes(
  symbols: string[],
  onProgress?: (done: number, total: number) => void,
  options: {
    /**
     * Most quote lookups to start per minute. Unset means as fast as the
     * workers go, which is right for a small batch and wrong for the universe.
     */
    perMinute?: number;
  } = {},
): Promise<QuoteRefreshResult> {
  const db = getDb();
  const errors: string[] = [];
  const answeredBy: Record<string, number> = {};
  const providerFailures: Record<string, number> = {};
  let updated = 0;
  let stale = 0;
  let unavailable = 0;
  let newestStale: string | null = null;
  let done = 0;

  /*
    What is stored already, so a stale quote can be judged against it.

    An old close is only worth saving when it is newer than the row, or when
    it is the same price the row already holds — in which case saving it
    replaces a refresh-time stamp with the date the price is really from.
  */
  const companyRows = await db
    .select({
      id: companies.id,
      symbol: companies.symbol,
      price: scores.price,
      priceUpdatedAt: scores.priceUpdatedAt,
    })
    .from(companies)
    .leftJoin(scores, eq(scores.companyId, companies.id));
  const idBySymbol = new Map(companyRows.map((r) => [r.symbol, r.id]));
  const storedById = new Map(
    companyRows.map((r) => [r.id, { price: r.price, priceUpdatedAt: r.priceUpdatedAt }]),
  );

  /*
    The latest reported figures a fresh price can be divided into.

    Market cap and every ratio built on it — P/E, P/B, P/S, dividend yield —
    move with the share price, so computing them once a night during the
    fundamentals pass and leaving them there is wrong twice over: the numbers
    are stale by morning, and if the price lookup failed that night they stay
    null until the next full ingest. On the live deployment they were null for
    all 542 companies while the dashboard displayed current prices for the same
    symbols, which is the shape of the bug this repairs.

    Read once, before the loop, rather than per symbol.
  */
  const latest = await db.execute<{
    company_id: number;
    shares_outstanding: number | null;
    net_income: number | null;
    equity: number | null;
    revenue: number | null;
    dividends_paid: number | null;
  }>(sql`
    SELECT DISTINCT ON (company_id)
      company_id, shares_outstanding, net_income, equity, revenue, dividends_paid
    FROM financials
    ORDER BY company_id, fiscal_year DESC
  `);
  const fundamentalsById = new Map(
    (latest as unknown as Record<string, number | null>[]).map((r) => [
      r.company_id as number,
      r,
    ]),
  );

  // Start times are handed out one slot apart, shared by every worker.
  const gapMs = options.perMinute && options.perMinute > 0 ? 60_000 / options.perMinute : 0;
  let nextSlot = 0;
  const waitForSlot = async () => {
    if (!gapMs) return;
    const now = Date.now();
    const slot = Math.max(now, nextSlot);
    nextSlot = slot + gapMs;
    if (slot > now) await new Promise((resolve) => setTimeout(resolve, slot - now));
  };

  await mapLimit(symbols, 2, async (symbol) => {
    const upper = symbol.toUpperCase();
    const companyId = idBySymbol.get(upper);
    if (!companyId) {
      onProgress?.(++done, symbols.length);
      return;
    }

    try {
      await waitForSlot();

      // The same chain every page quotes through, called directly so the run
      // can say which provider answered and why the others did not.
      const { value: quote, source, attempts } = await fetchQuoteWithFailover(
        quoteSourcesFor(upper),
        upper,
      );
      for (const attempt of attempts) {
        const key = `${attempt.provider}=${attempt.category}`;
        providerFailures[key] = (providerFailures[key] ?? 0) + 1;
      }

      if (quote?.price == null) {
        unavailable++;
        return;
      }

      const { outcome, at } = quoteWrite(
        { price: quote.price, asOf: quote.asOf, freshness: quote.freshness },
        storedById.get(companyId),
      );

      if (outcome !== "fresh") {
        stale++;
        const day = at.toISOString().slice(0, 10);
        if (!newestStale || day > newestStale) newestStale = day;
        if (outcome === "stale-skipped") return;
      }

      await db
        .update(scores)
        .set({
          price: quote.price,
          changePercent: quote.changePercent,
          priceUpdatedAt: at,
          ...priceDerived(quote.price, fundamentalsById.get(companyId)),
        })
        .where(eq(scores.companyId, companyId));

      if (outcome === "fresh") {
        updated++;
        if (source) answeredBy[source] = (answeredBy[source] ?? 0) + 1;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`${upper}: ${message}`);
      // A rate limit will hit every remaining symbol too, so stop rather than
      // grinding through hundreds of guaranteed failures.
      if (/rate limit|quota|credits|429/i.test(message)) {
        throw new Error(`Stopped after ${updated} updates — ${message}`);
      }
    } finally {
      onProgress?.(++done, symbols.length);
    }
  });

  return {
    updated,
    stale,
    unavailable,
    failed: errors.length,
    errors,
    answeredBy,
    providerFailures,
    newestStale,
  };
}

type QuoteOutcome = "fresh" | "stale-recorded" | "stale-skipped";

/**
 * Whether a quote may be saved over the stored row, and the date to save.
 *
 * The date is always the price's own. It used to be the moment the refresh
 * ran, so when every provider that could supply a current price failed and
 * the chain fell back to an old close, the old close went in with a fresh
 * time. The dashboard's "as of" and its staleness notice both read that time,
 * so both said current while every price on it was a month old.
 *
 * A stale quote is saved only when it is newer than what is stored, or when it
 * is the very price already there — saving that corrects the row's date
 * without changing a figure, which is how rows stamped wrongly before this fix
 * get their true date back. A stale quote that would replace a newer,
 * different price is skipped.
 */
function quoteWrite(
  quote: Pick<Quote, "asOf" | "freshness"> & { price: number },
  stored: { price: number | null; priceUpdatedAt: Date | string | null } | undefined,
  now: Date = new Date(),
): { outcome: QuoteOutcome; at: Date } {
  const at = priceTime(quote.asOf, now);
  if (quote.freshness !== "stale") return { outcome: "fresh", at };

  const storedAt = stored?.priceUpdatedAt ? new Date(stored.priceUpdatedAt).getTime() : null;
  const newer = storedAt == null || !Number.isFinite(storedAt) || at.getTime() > storedAt;
  const samePrice = stored?.price != null && Math.abs(stored.price - quote.price) < 1e-6;

  return { outcome: newer || samePrice ? "stale-recorded" : "stale-skipped", at };
}

/**
 * The figures a share price implies, recomputed from the newest price.
 *
 * Returns an empty object when the share count is unknown, which matters: the
 * spread is applied over the existing row, so an empty one leaves whatever was
 * stored alone. Filling these with null instead would erase a good market cap
 * — one Finnhub reported directly, say — the first time a filer failed to tag
 * its share count.
 *
 * A dual-class filer whose consolidated share count is tagged loosely will get
 * a rougher figure here than a data vendor would report. That was already true
 * of the ingest's own fallback; this makes it apply more often and stay fresh,
 * which is the better trade against a column that is null for everybody.
 */
function priceDerived(
  price: number,
  latest: Record<string, number | null> | undefined,
): Partial<typeof scores.$inferInsert> {
  const shares = latest?.shares_outstanding ?? null;
  if (!shares || shares <= 0) return {};

  const marketCap = price * shares;
  const netIncome = latest?.net_income ?? null;
  const dividendsPaid = latest?.dividends_paid ?? null;

  return {
    marketCap,
    // A loss makes a P/E meaningless rather than negative, which is the same
    // rule the ingest and the stock page already apply.
    peRatio: netIncome != null && netIncome > 0 ? div(marketCap, netIncome) : null,
    pbRatio: div(marketCap, latest?.equity ?? null),
    psRatio: div(marketCap, latest?.revenue ?? null),
    // Dividends are tagged as an outflow and the sign varies by filer, so the
    // magnitude is what matters — the same reasoning as scoring/dividends.ts.
    dividendYield:
      dividendsPaid != null ? div(Math.abs(dividendsPaid), marketCap) : null,
  };
}

/** Exposed for tests only. */
export const __testing = { priceDerived, quoteWrite };
