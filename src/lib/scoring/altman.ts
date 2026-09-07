import { fieldValue } from "../fundamentals/normalize";
import type { FinancialPeriod } from "../fundamentals/types";
import {
  FINANCIAL_SUPPRESSION_REASON,
  INSUFFICIENT_DATA_REASON,
  type SectorKind,
} from "./applicability";
import { add, coalesce, div, round, sub } from "./math";
import type { AltmanResult, AltmanVariant, Rating, ScoreResult } from "./types";

/**
 * Where each variant puts the boundary between its zones.
 *
 * The three models were fitted on different populations and do not share a
 * scale: a Z of 2.7 is the safe zone for a service company and the grey zone
 * for a manufacturer. These numbers used to sit as literals at the three
 * return sites below, which was fine while nothing else needed them — the
 * score page now prints the thresholds beside the figure, and a second copy of
 * them would eventually disagree with the first.
 */
export const ALTMAN_ZONES: Record<
  AltmanVariant,
  { safeAbove: number; distressBelow: number }
> = {
  manufacturing: { safeAbove: 2.99, distressBelow: 1.81 },
  "manufacturing-book": { safeAbove: 2.9, distressBelow: 1.23 },
  "non-manufacturing": { safeAbove: 2.6, distressBelow: 1.1 },
};

/** Which zone a score falls in, and the rating that follows from it. */
export function altmanZone(
  z: number,
  variant: AltmanVariant,
): { zone: AltmanResult["zone"]; rating: Rating } {
  const { safeAbove, distressBelow } = ALTMAN_ZONES[variant];
  if (z > safeAbove) return { zone: "safe", rating: "good" };
  if (z >= distressBelow) return { zone: "grey", rating: "fair" };
  return { zone: "distress", rating: "poor" };
}

/**
 * Altman Z-Score — distance from bankruptcy.
 *
 * Two variants are used, matching the populations they were fitted on:
 *
 *  - Manufacturers (SIC 2000-3999) get the original 1968 five-factor model,
 *    which uses market capitalisation in the leverage term.
 *  - Everyone else gets the four-factor Z'' model, which drops asset turnover
 *    (it varies too much across service industries to be comparable) and uses
 *    book equity instead of market value.
 *
 * Financial companies get no score at all. The model has no meaning for a
 * balance sheet with no working capital, and reporting one anyway would be
 * worse than reporting nothing.
 */
export function altmanZScore(
  period: FinancialPeriod | undefined,
  sector: SectorKind,
  marketCap: number | null,
): ScoreResult<AltmanResult> {
  if (sector === "financial") {
    return { value: null, applicable: false, reason: FINANCIAL_SUPPRESSION_REASON };
  }
  if (!period) {
    return { value: null, applicable: false, reason: INSUFFICIENT_DATA_REASON };
  }

  const f = (k: Parameters<typeof fieldValue>[1]) => fieldValue(period, k);

  const assets = f("assets");
  const liabilities = f("liabilities");
  const workingCapital = sub(f("currentAssets"), f("currentLiabilities"));

  // EBIT: prefer operating income, else rebuild it from pre-tax income.
  const ebit = coalesce(
    f("operatingIncome"),
    add(f("incomeBeforeTax"), f("interestExpense")),
  );

  const x1 = div(workingCapital, assets);
  const x2 = div(f("retainedEarnings"), assets);
  const x3 = div(ebit, assets);

  const isManufacturing = sector === "manufacturing";

  // The original model needs market value of equity. When no price source is
  // configured there is no market cap, so fall back to Altman's own 1983 Z'
  // revision, which re-fitted every coefficient around book equity for exactly
  // this situation. That keeps the score available on a zero-key install
  // instead of dropping it entirely.
  const useBookValue = isManufacturing && marketCap == null;
  const equityValue = isManufacturing && !useBookValue ? marketCap : f("equity");
  const x4 = div(equityValue, liabilities);

  if (x1 == null || x2 == null || x3 == null || x4 == null) {
    return { value: null, applicable: false, reason: INSUFFICIENT_DATA_REASON };
  }

  if (isManufacturing) {
    const x5 = div(f("revenue"), assets);
    if (x5 == null) {
      return { value: null, applicable: false, reason: INSUFFICIENT_DATA_REASON };
    }

    if (useBookValue) {
      // Z' (1983): distinct coefficients and thresholds from the 1968 model.
      const z = 0.717 * x1 + 0.847 * x2 + 3.107 * x3 + 0.42 * x4 + 0.998 * x5;
      return {
        value: {
          z: round(z),
          variant: "manufacturing-book",
          ...altmanZone(z, "manufacturing-book"),
        },
        applicable: true,
      };
    }

    const z = 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5;
    return {
      value: {
        z: round(z),
        variant: "manufacturing",
        ...altmanZone(z, "manufacturing"),
      },
      applicable: true,
    };
  }

  const z = 6.56 * x1 + 3.26 * x2 + 6.72 * x3 + 1.05 * x4;
  return {
    value: {
      z: round(z),
      variant: "non-manufacturing",
      ...altmanZone(z, "non-manufacturing"),
    },
    applicable: true,
  };
}
