import { eq, inArray } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { companies, scores } from "../db/schema";
import { getBarsWithSource } from "../providers";
import { computeBeta, type BetaResult } from "./beta";
import { weightedPe, type HoldingWeight, type PortfolioValuation } from "./portfolio-pe";

/**
 * The two figures a fund page can work out for itself.
 *
 * Both are numbers every other site buys, and both are computable from what
 * this app already has: a beta from price history it fetches for the chart,
 * and a portfolio valuation from the several hundred companies it already
 * scores out of their filings. Computing them is not only cheaper, it is the
 * only way they can be stated with a basis — a bought beta has an undisclosed
 * window and a bought P/E an undisclosed method, and neither is comparable
 * between two funds on the same page.
 */

/** What beta is measured against. The most widely held US equity benchmark. */
const BENCHMARK = "SPY";
/** Five years of monthly returns is the convention `beta.ts` documents. */
const BETA_YEARS = 5;

/**
 * Price-to-earnings for a set of tickers, from the nightly scores.
 *
 * One query for the whole holdings list rather than one per holding. Returns
 * an empty map rather than throwing when there is no database — a fund page
 * without a valuation is a smaller loss than a fund page that 500s.
 */
export async function peForSymbols(symbols: string[]): Promise<Map<string, number | null>> {
  const empty = new Map<string, number | null>();
  if (!isDatabaseConfigured() || symbols.length === 0) return empty;

  const wanted = [...new Set(symbols.map((s) => s.toUpperCase().trim()))].filter(Boolean);
  if (wanted.length === 0) return empty;

  try {
    const rows = await getDb()
      .select({ symbol: companies.symbol, peRatio: scores.peRatio })
      .from(companies)
      .innerJoin(scores, eq(scores.companyId, companies.id))
      .where(inArray(companies.symbol, wanted));

    const map = new Map<string, number | null>();
    for (const row of rows) map.set(row.symbol.toUpperCase(), row.peRatio);
    return map;
  } catch {
    return empty;
  }
}

export interface FundAnalytics {
  valuation: PortfolioValuation | null;
  beta: BetaResult | null;
  benchmark: string;
}

/**
 * Works out both, from the fund's holdings and its price history.
 *
 * Failure of either is an ordinary answer, not an error: a fund holding
 * nothing this site scores has no valuation, and one younger than three years
 * has no beta. The page omits what it did not get.
 *
 * The benchmark's own page asks for its beta against itself, which is 1 by
 * definition and not worth two price fetches to discover, so it is skipped.
 */
export async function getFundAnalytics(
  symbol: string,
  holdings: HoldingWeight[],
): Promise<FundAnalytics> {
  const upper = symbol.toUpperCase();

  const [valuation, beta] = await Promise.all([
    valuationFor(holdings),
    upper === BENCHMARK ? Promise.resolve(null) : betaFor(upper),
  ]);

  return { valuation, beta, benchmark: BENCHMARK };
}

async function valuationFor(holdings: HoldingWeight[]): Promise<PortfolioValuation | null> {
  if (holdings.length === 0) return null;
  const pes = await peForSymbols(holdings.map((h) => h.symbol));
  if (pes.size === 0) return null;
  return weightedPe(holdings, pes);
}

async function betaFor(symbol: string): Promise<BetaResult | null> {
  const to = new Date();
  const from = new Date(to);
  from.setFullYear(from.getFullYear() - BETA_YEARS);

  try {
    /*
      Both series on the same timeframe and window, which matters more than it
      looks. Beta is a comparison, and two series fetched over different spans
      or intervals produce a slope that partly reflects the mismatch. Weekly
      bars rather than daily: five years of daily bars is 1,250 rows per
      symbol to produce sixty monthly returns, and the month-end sampling in
      `computeBeta` throws almost all of them away.
    */
    const [fund, market] = await Promise.all([
      getBarsWithSource(symbol, "1Week", from, to),
      getBarsWithSource(BENCHMARK, "1Week", from, to),
    ]);
    return computeBeta(fund.bars, market.bars);
  } catch {
    return null;
  }
}
