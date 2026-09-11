import { fieldValue } from "./fundamentals/normalize";
import { getInstrumentType, getProvider } from "./providers";
import type { InstrumentType, Quote } from "./providers/types";
import { sectorFromSic, type SectorKind } from "./scoring/applicability";
import { buildHealthReport, type HealthReport } from "./scoring/health";
import { buildKeyFigures } from "./scoring/key-figures";
import { div } from "./scoring/math";
import { enterpriseValueToEbitda, returnOnInvestedCapital } from "./scoring/returns";
import { classify, findInstrument, type AssetClass } from "./instruments";

/** Most symbols a single comparison will load. */
export const MAX_COMPARE = 4;

export interface CompareItem {
  symbol: string;
  name: string;
  type: InstrumentType;
  /**
   * What kind of thing this is, in the reader's terms.
   *
   * `type` answers whether statements exist; this answers what the row is.
   * Both are needed, because "no statements" covers a fund, a commodity and a
   * coin, and the comparison table says something different for each.
   */
  assetClass: AssetClass;
  quote: Quote | null;
  marketCap: number | null;
  sector: SectorKind;
  industry: string | null;
  /** Null for funds and anything without XBRL statements. */
  report: HealthReport | null;
  metrics: {
    peRatio: number | null;
    pbRatio: number | null;
    psRatio: number | null;
    netMargin: number | null;
    revenueGrowth: number | null;
    returnOnAssets: number | null;
    debtToEquity: number | null;
    revenue: number | null;
    netIncome: number | null;
    grossMargin: number | null;
    operatingMargin: number | null;
    fcfMargin: number | null;
    returnOnEquity: number | null;
    /** Approximate — see src/lib/scoring/returns.ts. */
    returnOnInvestedCapital: number | null;
    /** Approximate — see src/lib/scoring/returns.ts. */
    evToEbitda: number | null;
  };
  /** Set when the symbol could not be resolved at all. */
  error?: string;
}

const EMPTY_METRICS: CompareItem["metrics"] = {
  peRatio: null, pbRatio: null, psRatio: null, netMargin: null,
  revenueGrowth: null, returnOnAssets: null, debtToEquity: null,
  revenue: null, netIncome: null, grossMargin: null, operatingMargin: null,
  fcfMargin: null, returnOnEquity: null, returnOnInvestedCapital: null, evToEbitda: null,
};

/**
 * Decides whether a symbol is a company or a fund.
 *
 * Ordered by how much each signal can be trusted:
 *  1. Real financial statements mean an operating company, whatever anything
 *     else claims.
 *  2. EDGAR's own entityType: "investment" is definitive for funds (QQQ),
 *     "operating" for companies.
 *  3. Otherwise, a symbol with no statements and no SIC code is not an
 *     operating business. SPY sits here — EDGAR files it as "other" with no
 *     SIC and returns 404 for its financial facts.
 *
 * Everything else stays "unknown" rather than being guessed at, so the UI can
 * say it does not know instead of asserting something wrong.
 */
export function resolveType(
  providerType: InstrumentType,
  hasFinancials: boolean,
  entityType?: string | null,
  sicCode?: string | null,
): InstrumentType {
  if (hasFinancials) return "stock";
  if (entityType === "investment") return "etf";
  if (providerType === "etf") return "etf";
  if (entityType === "operating") return "unknown";
  if (entityType && !sicCode) return "etf";
  return providerType === "stock" ? "unknown" : providerType;
}

/**
 * Loads one side of a comparison.
 *
 * Funds are handled explicitly rather than being allowed to fall through the
 * company path: an ETF has no revenue, equity or balance sheet, so every
 * fundamental metric stays null and the UI says why instead of showing dashes
 * that look like missing data.
 */
async function loadOne(symbol: string): Promise<CompareItem> {
  const provider = getProvider();
  const upper = symbol.toUpperCase();

  // A coin or a contract has a price and nothing else. Fetching a profile and
  // statements for it would be two calls whose answers are known to be empty.
  const assetClass = classify(upper);
  if (assetClass) {
    const quote = await provider.getQuote(upper).catch(() => null);
    return {
      symbol: upper,
      name: findInstrument(upper)?.name ?? upper,
      type: "unknown",
      assetClass,
      quote,
      // A commodity has a price, not a market capitalisation.
      marketCap: null,
      sector: "other",
      industry: findInstrument(upper)?.category ?? null,
      report: null,
      metrics: EMPTY_METRICS,
    };
  }

  const [profile, fundamentals, quote, type] = await Promise.all([
    provider.getProfile(upper).catch(() => null),
    provider.getFundamentals(upper).catch(() => null),
    provider.getQuote(upper).catch(() => null),
    getInstrumentType(upper).catch(() => "unknown" as InstrumentType),
  ]);

  const hasFinancials = Boolean(fundamentals?.annual.length);
  const resolvedType = resolveType(type, hasFinancials, profile?.entityType, profile?.sicCode);

  if (!profile && !hasFinancials && !quote) {
    return {
      symbol: upper, name: upper, type: "unknown", assetClass: "equity", quote: null, marketCap: null,
      sector: "other", industry: null, report: null, metrics: EMPTY_METRICS,
      error: "Not found. Check the ticker, or it may not be covered by the configured data sources.",
    };
  }

  const sector = sectorFromSic(profile?.sicCode);

  let marketCap = profile?.marketCap ?? null;
  if (marketCap == null && quote?.price && fundamentals) {
    const shares = fieldValue(fundamentals.annual[0], "sharesOutstanding");
    if (shares) marketCap = quote.price * shares;
  }

  if (!hasFinancials || !fundamentals) {
    return {
      symbol: upper,
      name: profile?.name ?? upper,
      type: resolvedType,
      assetClass: resolvedType === "etf" ? "etf" : "equity",
      quote,
      marketCap,
      sector,
      industry: profile?.industry ?? null,
      report: null,
      metrics: EMPTY_METRICS,
    };
  }

  const report = buildHealthReport(fundamentals, sector, marketCap);
  const figures = buildKeyFigures(fundamentals, marketCap);
  const latest = fundamentals.annual[0];
  const prior = fundamentals.annual[1];
  const revenue = fieldValue(latest, "revenue");
  const priorRevenue = prior ? fieldValue(prior, "revenue") : null;
  const netIncome = fieldValue(latest, "netIncome");

  return {
    symbol: upper,
    name: profile?.name ?? fundamentals.entityName,
    type: "stock",
    assetClass: "equity",
    quote,
    marketCap,
    sector,
    industry: profile?.industry ?? null,
    report,
    metrics: {
      peRatio: netIncome && netIncome > 0 ? div(marketCap, netIncome) : null,
      pbRatio: div(marketCap, fieldValue(latest, "equity")),
      psRatio: div(marketCap, revenue),
      netMargin: div(netIncome, revenue),
      revenueGrowth:
        revenue != null && priorRevenue != null && priorRevenue !== 0
          ? (revenue - priorRevenue) / Math.abs(priorRevenue)
          : null,
      returnOnAssets: div(netIncome, fieldValue(latest, "assets")),
      debtToEquity: div(fieldValue(latest, "liabilities"), fieldValue(latest, "equity")),
      revenue,
      netIncome,
      grossMargin: figures.grossMargin,
      operatingMargin: figures.operatingMargin,
      fcfMargin: figures.fcfMargin,
      returnOnEquity: figures.returnOnEquity,
      returnOnInvestedCapital: returnOnInvestedCapital(latest),
      evToEbitda: enterpriseValueToEbitda(latest, marketCap),
    },
  };
}

/** Loads every symbol in a comparison. One bad ticker never fails the rest. */
export async function loadComparison(symbols: string[]): Promise<CompareItem[]> {
  const unique = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  return Promise.all(unique.slice(0, MAX_COMPARE).map(loadOne));
}

/** Parses the `symbols` query parameter into a clean list. */
export function parseSymbols(raw: string | string[] | undefined): string[] {
  const value = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  return value
    .split(/[,\s]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, MAX_COMPARE);
}
