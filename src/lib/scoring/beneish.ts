import { fieldValue } from "../fundamentals/normalize";
import type { CanonicalField, FinancialPeriod } from "../fundamentals/types";
import {
  FINANCIAL_SUPPRESSION_REASON,
  INSUFFICIENT_DATA_REASON,
  type SectorKind,
} from "./applicability";
import { add, div, round, sub } from "./math";
import type { BeneishResult, ScoreResult } from "./types";

/**
 * Above this threshold, Beneish (1999) flags a company as a likely manipulator.
 *
 * Exported so the score page can print the threshold beside the figure rather
 * than carrying its own copy of the number.
 */
export const MANIPULATION_THRESHOLD = -1.78;

/**
 * Beneish M-Score — the probability that reported earnings have been manipulated.
 *
 * Eight ratios, each comparing this year to last, combined into a single score.
 * It is a screening tool for statistically unusual accounting, not proof of
 * wrongdoing, and the UI is worded accordingly.
 *
 * Suppressed for financial companies: several inputs (asset quality, working
 * capital leverage) are undefined on an unclassified balance sheet.
 */
export function beneishMScore(
  current: FinancialPeriod | undefined,
  prior: FinancialPeriod | undefined,
  sector: SectorKind,
): ScoreResult<BeneishResult> {
  if (sector === "financial") {
    return { value: null, applicable: false, reason: FINANCIAL_SUPPRESSION_REASON };
  }
  if (!current || !prior) {
    return { value: null, applicable: false, reason: INSUFFICIENT_DATA_REASON };
  }

  const c = (k: CanonicalField) => fieldValue(current, k);
  const p = (k: CanonicalField) => fieldValue(prior, k);

  // Days sales in receivables: receivables growing faster than sales.
  const dsri = div(div(c("receivables"), c("revenue")), div(p("receivables"), p("revenue")));

  // Gross margin deterioration.
  const gmNow = div(sub(c("revenue"), c("costOfRevenue")), c("revenue"));
  const gmPrior = div(sub(p("revenue"), p("costOfRevenue")), p("revenue"));
  const gmi = div(gmPrior, gmNow);

  // Asset quality: share of assets that is neither current nor plant.
  const aqNow = sub(1, div(add(c("currentAssets"), c("ppe")), c("assets")));
  const aqPrior = sub(1, div(add(p("currentAssets"), p("ppe")), p("assets")));
  const aqi = div(aqNow, aqPrior);

  // Sales growth.
  const sgi = div(c("revenue"), p("revenue"));

  // Depreciation rate slowdown.
  const depRateNow = div(c("depreciation"), add(c("depreciation"), c("ppe")));
  const depRatePrior = div(p("depreciation"), add(p("depreciation"), p("ppe")));
  const depi = div(depRatePrior, depRateNow);

  // SG&A growing faster than sales.
  const sgai = div(div(c("sga"), c("revenue")), div(p("sga"), p("revenue")));

  // Leverage change.
  const levNow = div(add(c("currentLiabilities"), c("longTermDebt")), c("assets"));
  const levPrior = div(add(p("currentLiabilities"), p("longTermDebt")), p("assets"));
  const lvgi = div(levNow, levPrior);

  // Total accruals to total assets — the heaviest weighted term.
  const tata = div(sub(c("netIncome"), c("operatingCashFlow")), c("assets"));

  const inputs = { dsri, gmi, aqi, sgi, depi, sgai, lvgi, tata };
  if (Object.values(inputs).some((v) => v == null)) {
    return { value: null, applicable: false, reason: INSUFFICIENT_DATA_REASON };
  }

  const m =
    -4.84 +
    0.92 * dsri! +
    0.528 * gmi! +
    0.404 * aqi! +
    0.892 * sgi! +
    0.115 * depi! -
    0.172 * sgai! +
    4.679 * tata! -
    0.327 * lvgi!;

  const flagged = m > MANIPULATION_THRESHOLD;
  return {
    value: {
      m: round(m),
      flagged,
      // A clean reading is reassuring but not conclusive, hence "fair" not "good"
      // for scores sitting just under the threshold.
      rating: flagged ? "poor" : m < -2.22 ? "good" : "fair",
    },
    applicable: true,
  };
}
