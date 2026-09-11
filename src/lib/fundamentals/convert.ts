import type { CanonicalField, Fact, FinancialPeriod, NormalizedFundamentals } from "./types";

/**
 * Restates a filer's figures in another currency.
 *
 * Done once here rather than at each place a number is printed, so every
 * downstream consumer — the health scores, the balance sheet, the trend charts,
 * the plain-English sentences — sees one consistent set of figures and needs to
 * know nothing about the conversion.
 *
 * The ratios are unaffected either way: dividing won by won gives the same
 * answer as dividing dollars by dollars. What changes is whether a reader can
 * judge the size of the company at a glance.
 */

/**
 * Units that are counts rather than money.
 *
 * Converting a share count would be a serious error — it feeds market value and
 * every per-share figure — and it is an easy one to make, because the field sits
 * in the same record as the monetary ones.
 */
const NOT_MONEY = new Set(["shares", "pure", "PURE", "SHARES"]);

export function convertFundamentals(
  fundamentals: NormalizedFundamentals,
  rate: number,
  target: string,
): NormalizedFundamentals {
  if (!Number.isFinite(rate) || rate <= 0) return fundamentals;

  const convert = (period: FinancialPeriod): FinancialPeriod => {
    const facts: Partial<Record<CanonicalField, Fact>> = {};

    for (const [field, fact] of Object.entries(period.facts) as [
      CanonicalField,
      Fact | undefined,
    ][]) {
      if (!fact) continue;
      facts[field] = isMoney(fact.unit)
        ? { ...fact, value: fact.value * rate, unit: target }
        : fact;
    }

    return { ...period, facts };
  };

  return {
    ...fundamentals,
    annual: fundamentals.annual.map(convert),
    // Quarters are converted at the same rate as the years, or a quarter
    // compared against its own year would be two currencies side by side.
    ...(fundamentals.quarterly ? { quarterly: fundamentals.quarterly.map(convert) } : {}),
    // As-reported snapshots stay in the filing currency, labelled as such.
    // Only ratios and signs are ever read from them, and those do not change.
  };
}

function isMoney(unit: string | null | undefined): boolean {
  if (!unit) return false;
  return !NOT_MONEY.has(unit);
}
