import { eq, inArray } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { companies, financials, scores } from "../db/schema";
import { getRate } from "../fx";
import { getProvider } from "../providers";
import { freeCashFlowOf } from "../scoring/returns";
import { brokerSummaries, type BrokerSummary } from "./brokers";
import { chartHoldings, commonCurrency, type PortfolioChart } from "./charts";
import { buildIntelligence, type HoldingProfile, type PortfolioIntelligence } from "./intelligence";
import { valueHoldings, type CurrencyTotal, type PricedHolding, type ValuedHolding } from "./math";
import type { PortfolioInput } from "./sources";

/**
 * Prices, scores and exposures for a reader's holdings.
 *
 * Prices come from the stored quotes first — refreshed through the day for
 * the scored universe — and only fall back to a live lookup for holdings the
 * store does not cover or holds a stale quote for, capped so a large
 * portfolio cannot fan out into dozens of provider calls. Every price carries
 * where it came from and when, so the page can say so.
 */

export interface PortfolioView {
  holdings: ValuedHolding[];
  totals: CurrencyTotal[];
  intelligence: PortfolioIntelligence | null;
  /** The currency exposures are weighted in. */
  baseCurrency: string;
  /** Currencies that could not be converted, and so are left out of the exposures. */
  unconverted: string[];
  /** Holdings a live price was not looked up for, because of the cap. */
  livePriceSkipped: number;
  /** Stored scores for each holding, for the table. Absent for anything unscored. */
  scored: Record<string, { healthScore: number | null; displaySector: string | null }>;
  /** Every priced holding in one currency, for the allocation and map charts. */
  chart: PortfolioChart;
  /** What is held at each broker, in the charts' currency. */
  brokers: BrokerSummary[];
}

const BASE_CURRENCY = "USD";
const STALE_AFTER_MS = 3 * 86_400_000;
const MAX_LIVE_QUOTES = 20;
const LIVE_BATCH = 5;

type ScoreRow = {
  id: number;
  symbol: string;
  name: string;
  sectorKind: string;
  displaySector: string;
  price: number | null;
  priceUpdatedAt: Date | null;
  healthScore: number | null;
  peRatio: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  mFlagged: boolean | null;
  mApplicable: boolean | null;
  zZone: string | null;
  zApplicable: boolean | null;
};

async function storedScores(symbols: string[]): Promise<{
  bySymbol: Map<string, ScoreRow>;
  freeCashFlow: Map<number, number | null>;
}> {
  const empty = { bySymbol: new Map<string, ScoreRow>(), freeCashFlow: new Map<number, number | null>() };
  if (symbols.length === 0 || !isDatabaseConfigured()) return empty;

  try {
    const db = getDb();
    const rows = await db
      .select({
        id: companies.id,
        symbol: companies.symbol,
        name: companies.name,
        sectorKind: companies.sectorKind,
        displaySector: companies.displaySector,
        price: scores.price,
        priceUpdatedAt: scores.priceUpdatedAt,
        healthScore: scores.healthScore,
        peRatio: scores.peRatio,
        debtToEquity: scores.debtToEquity,
        currentRatio: scores.currentRatio,
        mFlagged: scores.mFlagged,
        mApplicable: scores.mApplicable,
        zZone: scores.zZone,
        zApplicable: scores.zApplicable,
      })
      .from(companies)
      .innerJoin(scores, eq(scores.companyId, companies.id))
      .where(inArray(companies.symbol, symbols));

    const ids = rows.map((row) => row.id);
    const years = ids.length
      ? await db
          .select({
            companyId: financials.companyId,
            fiscalYear: financials.fiscalYear,
            operatingCashFlow: financials.operatingCashFlow,
            capex: financials.capex,
          })
          .from(financials)
          .where(inArray(financials.companyId, ids))
      : [];

    const latest = new Map<number, (typeof years)[number]>();
    for (const year of years) {
      const current = latest.get(year.companyId);
      if (!current || year.fiscalYear > current.fiscalYear) latest.set(year.companyId, year);
    }

    const freeCashFlow = new Map<number, number | null>();
    for (const [companyId, year] of latest) {
      freeCashFlow.set(companyId, freeCashFlowOf(year.operatingCashFlow, year.capex));
    }

    return { bySymbol: new Map(rows.map((row) => [row.symbol, row])), freeCashFlow };
  } catch {
    return empty;
  }
}

/** The currency a Canadian-suffixed listing trades in, and USD for the rest of the covered universe. */
function currencyForSymbol(symbol: string): string {
  return /\.(TO|V)$/.test(symbol) ? "CAD" : "USD";
}

export async function loadPortfolio(
  inputs: PortfolioInput[],
  theses: { symbol: string; status: string }[],
): Promise<PortfolioView> {
  // One lookup per company, however many rows hold it.
  const symbols = [...new Set(inputs.map((holding) => holding.symbol))];
  const { bySymbol, freeCashFlow } = await storedScores(symbols);
  const now = Date.now();

  // Which companies need a live price: not stored, or stored too long ago.
  const needLive = symbols.filter((symbol) => {
    const row = bySymbol.get(symbol);
    return !row?.price || !row.priceUpdatedAt || now - row.priceUpdatedAt.getTime() > STALE_AFTER_MS;
  });
  const lookups = needLive.slice(0, MAX_LIVE_QUOTES);
  const live = new Map<string, { price: number | null; currency: string | null; asOf: string | null }>();
  for (let i = 0; i < lookups.length; i += LIVE_BATCH) {
    const batch = lookups.slice(i, i + LIVE_BATCH);
    const quotes = await Promise.all(batch.map((symbol) => getProvider().getQuote(symbol).catch(() => null)));
    batch.forEach((symbol, index) => {
      const quote = quotes[index];
      if (quote?.price != null) {
        live.set(symbol, { price: quote.price, currency: quote.currency ?? null, asOf: quote.asOf });
      }
    });
  }

  const priced: PricedHolding[] = inputs.map((holding) => {
    const row = bySymbol.get(holding.symbol);
    const fromLive = live.get(holding.symbol);
    const storedFresh =
      row?.price != null && row.priceUpdatedAt != null && now - row.priceUpdatedAt.getTime() <= STALE_AFTER_MS;
    const fallbackCurrency = currencyForSymbol(holding.symbol);

    const price = storedFresh ? row!.price : (fromLive?.price ?? null);
    const priceCurrency = storedFresh ? fallbackCurrency : (fromLive?.currency ?? fallbackCurrency).toUpperCase();
    // A synced holding says what currency its cost is in. A price in another
    // currency would turn the gain into a comparison of two different units,
    // so that row is shown at cost with no price rather than valued wrongly.
    const currencyAgrees = !holding.currency || holding.currency === priceCurrency;

    return {
      key: holding.key,
      source: holding.source,
      sourceLabel: holding.sourceLabel,
      connection: holding.connection,
      reportedAt: holding.reportedAt,
      holdingId: holding.holdingId,
      accountId: holding.accountId,
      account: holding.account,
      accountType: holding.accountType,
      symbol: holding.symbol,
      name: row?.name ?? null,
      quantity: holding.quantity,
      averageCost: holding.averageCost,
      purchaseDate: holding.purchaseDate,
      price: currencyAgrees ? price : null,
      currency: holding.currency ?? priceCurrency,
      priceAsOf: currencyAgrees ? (storedFresh ? row!.priceUpdatedAt!.toISOString() : (fromLive?.asOf ?? null)) : null,
      priceSource: !currencyAgrees ? null : storedFresh ? "stored" : fromLive ? "live" : null,
    };
  });

  const { holdings, totals } = valueHoldings(priced);

  // Exposures are weighted in one currency. A currency with no rate is left
  // out of them, and named, rather than added in at an invented rate.
  const rates = new Map<string, number | null>([[BASE_CURRENCY, 1]]);
  for (const currency of new Set(holdings.map((h) => h.currency))) {
    if (!rates.has(currency)) {
      rates.set(currency, await getRate(currency, BASE_CURRENCY).catch(() => null));
    }
  }

  // The exposures describe companies, so a company held in two rows counts
  // once, at its combined weight — otherwise it would appear twice among the
  // flags and could be named the largest holding at half its real size.
  const weightBySymbol = new Map<string, number | null>();
  for (const holding of holdings) {
    const rate = rates.get(holding.currency) ?? null;
    const weight = holding.value != null && rate != null ? holding.value * rate : null;
    const sofar = weightBySymbol.get(holding.symbol);
    weightBySymbol.set(holding.symbol, weight == null ? (sofar ?? null) : (sofar ?? 0) + weight);
  }

  const thesisBySymbol = new Map(theses.map((t) => [t.symbol, t.status]));
  const profiles: HoldingProfile[] = [...weightBySymbol].map(([symbol, weight]) => {
    const row = bySymbol.get(symbol);
    return {
      symbol,
      weight,
      covered: Boolean(row),
      sectorKind: row?.sectorKind ?? null,
      displaySector: row?.displaySector ?? null,
      healthScore: row?.healthScore ?? null,
      peRatio: row?.peRatio ?? null,
      debtToEquity: row?.debtToEquity ?? null,
      currentRatio: row?.currentRatio ?? null,
      freeCashFlow: row ? (freeCashFlow.get(row.id) ?? null) : null,
      mFlagged: row?.mFlagged ?? null,
      mApplicable: row?.mApplicable ?? null,
      zZone: row?.zZone ?? null,
      zApplicable: row?.zApplicable ?? null,
      thesisStatus: thesisBySymbol.get(symbol) ?? null,
    };
  });

  const sectors = Object.fromEntries([...bySymbol].map(([symbol, row]) => [symbol, row.displaySector]));

  return {
    holdings,
    totals,
    chart: chartHoldings(holdings, rates, sectors, BASE_CURRENCY),
    brokers: brokerSummaries(holdings, commonCurrency(holdings, rates, BASE_CURRENCY).rateFor),
    intelligence: buildIntelligence(profiles),
    baseCurrency: BASE_CURRENCY,
    unconverted: [...rates].filter(([, rate]) => rate == null).map(([currency]) => currency),
    livePriceSkipped: Math.max(0, needLive.length - MAX_LIVE_QUOTES),
    scored: Object.fromEntries(
      [...bySymbol].map(([symbol, row]) => [
        symbol,
        { healthScore: row.healthScore, displaySector: row.displaySector },
      ]),
    ),
  };
}
