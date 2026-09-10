import type { Bar } from "../providers/types";

/**
 * Beta: how much a holding moves when the market does.
 *
 * Computed here rather than bought, because a beta from a data vendor is a
 * number with no stated basis. Every provider picks its own window and
 * interval — three years weekly, five years monthly, one year daily — and the
 * same fund can carry three different betas across three sites, none of them
 * wrong and none of them comparable. The convention below is stated on the
 * page, so two funds on this site can be read against each other.
 *
 * Five years of monthly returns, which is the most widely used convention and
 * the one a reader is most likely to have seen elsewhere. Monthly rather than
 * daily because daily returns of a fund and its benchmark are dominated by the
 * fact that both are open at the same moment; monthly is the interval at which
 * the number says something about exposure rather than about market hours.
 */

export interface BetaResult {
  /** Slope of the fund's returns against the market's. */
  beta: number;
  /** How many monthly returns it was computed from. */
  months: number;
  /**
   * Share of the fund's variance the market explains, 0 to 1.
   *
   * Carried because beta alone is misleading without it. A gold fund and an
   * index fund can both show a beta near 1 — one because it tracks the market
   * and one because a nearly unrelated series happened to fit that slope — and
   * only this tells them apart.
   */
  rSquared: number;
}

/** Minimum monthly returns before a slope means anything. Three years' worth. */
const MIN_MONTHS = 36;

/**
 * The last close of each calendar month, keyed by month.
 *
 * Month-end rather than every-30-days so a fund and its benchmark are sampled
 * on the same dates even when their histories start on different days — two
 * series sampled on offset grids produce a slope that is partly an artefact of
 * the offset.
 */
function monthEndCloses(bars: Bar[]): Map<string, number> {
  const closes = new Map<string, number>();

  for (const bar of [...bars].sort((a, b) => a.time - b.time)) {
    if (!Number.isFinite(bar.close) || bar.close <= 0) continue;
    const date = new Date(bar.time * 1000);
    const key = `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
    // Later bars overwrite earlier ones, leaving the month's last close.
    closes.set(key, bar.close);
  }

  return closes;
}

/**
 * Beta of one series against another, or null.
 *
 * Null when there is not enough overlapping history, or when the market series
 * does not move at all — a zero-variance denominator is not a beta of
 * infinity, it is a question that cannot be asked of that data.
 */
export function computeBeta(fundBars: Bar[], marketBars: Bar[]): BetaResult | null {
  const fund = monthEndCloses(fundBars);
  const market = monthEndCloses(marketBars);

  // Only months both series priced. A month missing from either cannot
  // contribute a return to a comparison.
  const months = [...fund.keys()].filter((m) => market.has(m)).sort();
  if (months.length < MIN_MONTHS + 1) return null;

  const fundReturns: number[] = [];
  const marketReturns: number[] = [];

  for (let i = 1; i < months.length; i += 1) {
    const fPrev = fund.get(months[i - 1])!;
    const mPrev = market.get(months[i - 1])!;
    fundReturns.push(fund.get(months[i])! / fPrev - 1);
    marketReturns.push(market.get(months[i])! / mPrev - 1);
  }

  const n = fundReturns.length;
  if (n < MIN_MONTHS) return null;

  const fMean = mean(fundReturns);
  const mMean = mean(marketReturns);

  let covariance = 0;
  let marketVariance = 0;
  let fundVariance = 0;

  for (let i = 0; i < n; i += 1) {
    const fd = fundReturns[i] - fMean;
    const md = marketReturns[i] - mMean;
    covariance += fd * md;
    marketVariance += md * md;
    fundVariance += fd * fd;
  }

  if (marketVariance <= 0) return null;

  const beta = covariance / marketVariance;
  // r² from the same sums, rather than a second pass. Zero fund variance means
  // a flat series, which correlates with nothing.
  const rSquared =
    fundVariance > 0 ? (covariance * covariance) / (marketVariance * fundVariance) : 0;

  return { beta, months: n, rSquared };
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Beta in words.
 *
 * The number is not self-explanatory and the direction people get wrong is
 * assuming it is a return. It is not a forecast of anything — it says how far
 * this has moved when the market moved, historically.
 */
export function describeBeta(beta: number): string {
  if (beta >= 0.9 && beta <= 1.1) return "moves roughly with the market";
  if (beta > 1.1) return `has moved about ${beta.toFixed(1)}× as far as the market`;
  if (beta > 0) return `has moved about ${Math.round(beta * 100)}% as far as the market`;
  return "has moved against the market";
}
