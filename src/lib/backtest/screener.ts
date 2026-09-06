import type { SectorKind } from "../scoring/applicability";
import { buildHealthReport } from "../scoring/health";
import type { Bar } from "../providers/types";
import { buildPointInTimeFundamentals, type FinancialsRow } from "./point-in-time";
import { simulateInvestment, isInvestmentError, type InvestmentPoint } from "./single-stock";

/**
 * "If I had bought the healthiest companies on this app and rebalanced every
 * year, how would that have done against the market?"
 *
 * This is the feature that actually tests WylthIQ's own premise — that a
 * higher health score means something — rather than just displaying one.
 * Everything that decides the basket runs through `buildHealthReport`
 * unmodified, against a fundamentals snapshot containing only what was
 * actually filed as of each rebalance date. Getting that snapshot right is
 * point-in-time.ts's job; this module's job is turning a sequence of baskets
 * into one equity curve.
 *
 * Ranks by health score and takes the top N, rather than reproducing the live
 * screener's preset thresholds. Those presets compile to SQL conditions run
 * against the `scores` table (see presetConditions in screener.ts) — reusing
 * them here would mean either querying a table this backtest cannot use for
 * a past date, or hand-copying the threshold values into a second
 * implementation that can silently drift from the first. Ranking by score
 * avoids that duplication and is arguably the more direct test of this app's
 * actual claim: does a higher score, not a specific preset's cutoff, predict
 * a better outcome.
 */

export interface CandidateData {
  symbol: string;
  cik: string;
  entityName: string;
  sector: SectorKind;
  financialsRows: FinancialsRow[];
  bars: Bar[];
  dividends: { time: number; amount: number }[];
}

export interface BasketMember {
  symbol: string;
  healthScore: number;
  /** This holding's share of the portfolio at the start of the period. */
  startValue: number;
  endValue: number;
}

export interface RebalancePeriod {
  start: number;
  end: number;
  /** Symbols considered but excluded from the basket, and why — for the results page. */
  skipped: { symbol: string; reason: string }[];
  basket: BasketMember[];
  portfolioValueStart: number;
  portfolioValueEnd: number;
}

export interface ScreenerBacktestResult {
  periods: RebalancePeriod[];
  /** The stitched equity curve across every period, for charting. */
  series: InvestmentPoint[];
  initialAmount: number;
  finalValue: number;
  totalReturn: number;
  cagr: number | null;
  /** Largest peak-to-trough decline over the whole backtest, as a fraction. */
  maxDrawdown: number;
}

const DAY_SECONDS = 86_400;
const DAYS_PER_YEAR = 365.25;
const MIN_DAYS_FOR_CAGR = 30;

/** The closing price on or nearest before a date, or null if the date precedes all data. */
function priceAt(bars: Bar[], time: number): number | null {
  let candidate: Bar | null = null;
  for (const bar of bars) {
    if (bar.time > time) break;
    candidate = bar;
  }
  return candidate?.close ?? null;
}

/**
 * Runs the full backtest: builds a basket at each rebalance date, holds it to
 * the next, and chains the results.
 *
 * `rebalanceDates` must be sorted ascending and include the backtest's final
 * boundary as its last entry (typically "now") — each pair of consecutive
 * dates is one holding period, so N dates produce N-1 periods.
 */
export function runScreenerBacktest(
  candidates: CandidateData[],
  rebalanceDates: Date[],
  amount: number,
  topN: number,
): ScreenerBacktestResult | { error: string } {
  if (rebalanceDates.length < 2) {
    return { error: "Need at least two rebalance dates to form one holding period." };
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return { error: "The amount invested must be a positive number." };
  }
  if (candidates.length === 0) {
    return { error: "No candidates were supplied to score." };
  }

  const periods: RebalancePeriod[] = [];
  const series: InvestmentPoint[] = [];
  let portfolioValue = amount;

  for (let i = 0; i < rebalanceDates.length - 1; i++) {
    const start = Math.floor(rebalanceDates[i].getTime() / 1000);
    const end = Math.floor(rebalanceDates[i + 1].getTime() / 1000);

    const skipped: RebalancePeriod["skipped"] = [];
    const scored: { symbol: string; healthScore: number }[] = [];

    for (const c of candidates) {
      const fundamentals = buildPointInTimeFundamentals(
        c.financialsRows,
        c.cik,
        c.entityName,
        rebalanceDates[i],
      );
      if (!fundamentals) {
        skipped.push({ symbol: c.symbol, reason: "No financial history was public yet." });
        continue;
      }

      const price = priceAt(c.bars, start);
      const shares = fundamentals.annual[0]?.facts.sharesOutstanding?.value ?? null;
      const marketCap = price != null && shares != null ? price * shares : null;

      const report = buildHealthReport(fundamentals, c.sector, marketCap);
      if (report.score == null) {
        skipped.push({ symbol: c.symbol, reason: "Not enough was reported to score it." });
        continue;
      }

      scored.push({ symbol: c.symbol, healthScore: report.score });
    }

    scored.sort((a, b) => b.healthScore - a.healthScore);
    const chosen = scored.slice(0, topN);

    for (const s of scored.slice(topN)) {
      skipped.push({ symbol: s.symbol, reason: "Scored, but outside the top " + topN + "." });
    }

    if (chosen.length === 0) {
      // Nothing qualified this period — the portfolio sits in cash rather
      // than the backtest failing outright. A single bad period should not
      // discard everything learned in the periods around it.
      periods.push({
        start, end, skipped, basket: [],
        portfolioValueStart: portfolioValue, portfolioValueEnd: portfolioValue,
      });
      series.push({ time: start, value: portfolioValue, shares: 0 });
      continue;
    }

    const allocationPerHolding = portfolioValue / chosen.length;
    const basket: BasketMember[] = [];
    let periodEndValue = 0;

    for (const pick of chosen) {
      const c = candidates.find((x) => x.symbol === pick.symbol)!;
      const windowBars = c.bars.filter((b) => b.time >= start && b.time <= end);

      if (windowBars.length === 0) {
        // No price data for this specific window — the allocation is
        // preserved in cash for this holding rather than silently vanishing
        // from the portfolio total.
        basket.push({
          symbol: c.symbol, healthScore: pick.healthScore,
          startValue: allocationPerHolding, endValue: allocationPerHolding,
        });
        periodEndValue += allocationPerHolding;
        continue;
      }

      const sim = simulateInvestment(
        windowBars, c.dividends, rebalanceDates[i], allocationPerHolding, true,
      );
      const endValue = isInvestmentError(sim) ? allocationPerHolding : sim.finalValue;

      basket.push({
        symbol: c.symbol, healthScore: pick.healthScore,
        startValue: allocationPerHolding, endValue,
      });
      periodEndValue += endValue;
    }

    periods.push({
      start, end, skipped, basket,
      portfolioValueStart: portfolioValue, portfolioValueEnd: periodEndValue,
    });

    series.push({ time: start, value: portfolioValue, shares: 0 });
    portfolioValue = periodEndValue;
  }

  const lastPeriod = rebalanceDates[rebalanceDates.length - 1];
  series.push({ time: Math.floor(lastPeriod.getTime() / 1000), value: portfolioValue, shares: 0 });

  const finalValue = portfolioValue;
  const totalReturn = finalValue / amount - 1;

  const windowDays =
    (rebalanceDates[rebalanceDates.length - 1].getTime() - rebalanceDates[0].getTime()) /
    (DAY_SECONDS * 1000);
  const years = windowDays / DAYS_PER_YEAR;
  const cagr =
    windowDays >= MIN_DAYS_FOR_CAGR && years > 0
      ? (finalValue / amount) ** (1 / years) - 1
      : null;

  let peak = series[0]?.value ?? amount;
  let maxDrawdown = 0;
  for (const point of series) {
    if (point.value > peak) peak = point.value;
    const drawdown = peak > 0 ? (peak - point.value) / peak : 0;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  return { periods, series, initialAmount: amount, finalValue, totalReturn, cagr, maxDrawdown };
}
