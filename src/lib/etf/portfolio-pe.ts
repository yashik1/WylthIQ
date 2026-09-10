/**
 * What a fund's holdings are valued at, from this site's own scores.
 *
 * A price-to-earnings ratio for a fund is not a figure any fund reports; it is
 * a property of what it owns. Every other site buys it. This one can compute
 * it, because it already scores several hundred companies from their filings —
 * so a fund's valuation here is the same numbers, from the same source, as the
 * company pages a reader can click through to and check.
 *
 * Coverage is reported alongside it and is not a footnote. The scored universe
 * is not the whole market, so any fund holding something outside it is priced
 * on a part of itself. A P/E over 71% of a fund is useful; the same number
 * presented as though it covered all of it is not.
 */

export interface HoldingWeight {
  symbol: string;
  /** Share of the fund, as a fraction. */
  weight: number;
}

export interface PortfolioValuation {
  /** Weighted price-to-earnings of the holdings that could be priced. */
  peRatio: number;
  /** Share of the fund those holdings represent, as a fraction. */
  coverage: number;
  /** How many holdings contributed. */
  priced: number;
  /**
   * Weight excluded for having no meaningful ratio — a loss-maker has a
   * negative P/E, which is not a cheaper one. Reported so the coverage figure
   * can be read honestly: this is weight deliberately left out, not weight
   * that was missing.
   */
  excludedWeight: number;
}

/**
 * A P/E above this is treated as no answer.
 *
 * A company earning almost nothing produces an enormous ratio that is
 * arithmetically true and analytically meaningless, and under the harmonic
 * weighting below it contributes almost nothing anyway — but it does distort
 * the coverage figure by counting as priced. Index providers apply a cap for
 * the same reason.
 */
const MAX_SENSIBLE_PE = 200;

/**
 * Weighted P/E of a portfolio.
 *
 * The weighting is harmonic, and that is the whole correctness of this
 * function rather than a refinement. A portfolio's P/E is its total price
 * divided by its total earnings, which in weight terms is
 * `Σw / Σ(w / pe)` — not `Σ(w × pe)`. The arithmetic mean is the intuitive
 * version and it is wrong in a specific direction: it lets one holding on a
 * P/E of 150 drag the whole fund upwards far beyond its share of the
 * earnings, because a high multiple means a *small* contribution to earnings,
 * not a large one. On a fund holding a couple of expensive names the two
 * methods differ by a third.
 *
 * Loss-makers are excluded rather than clamped. A negative P/E is not a low
 * one, and including it would subtract from the denominator and quietly raise
 * the fund's apparent multiple.
 */
export function weightedPe(
  holdings: HoldingWeight[],
  peBySymbol: Map<string, number | null>,
): PortfolioValuation | null {
  let weightSum = 0;
  let earningsSum = 0;
  let priced = 0;
  let excludedWeight = 0;

  for (const holding of holdings) {
    if (!Number.isFinite(holding.weight) || holding.weight <= 0) continue;

    const pe = peBySymbol.get(holding.symbol.toUpperCase());
    if (pe == null || !Number.isFinite(pe)) continue;

    if (pe <= 0 || pe > MAX_SENSIBLE_PE) {
      excludedWeight += holding.weight;
      continue;
    }

    weightSum += holding.weight;
    earningsSum += holding.weight / pe;
    priced += 1;
  }

  if (priced === 0 || earningsSum <= 0) return null;

  return {
    peRatio: weightSum / earningsSum,
    coverage: weightSum,
    priced,
    excludedWeight,
  };
}
