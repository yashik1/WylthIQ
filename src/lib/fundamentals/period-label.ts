import type { FinancialPeriod } from "./types";

/**
 * A reporting period in the words every panel uses: "FY2025", "Q3 FY2026",
 * or "Quarter to 2026-06-27" for a quarter whose filing did not say which
 * one it was.
 *
 * Written once rather than in the timeline, the statement explorer, the data
 * checks and What Changed separately, where the same quarter could otherwise
 * be labelled two ways on one page. `inSentence` gives the form that reads
 * mid-sentence — "In the quarter to 2026-06-27, …" — and changes nothing for
 * a year or a numbered quarter.
 */
export function periodLabel(
  period: Pick<FinancialPeriod, "fiscalYear" | "fiscalPeriod" | "end">,
  { inSentence = false }: { inSentence?: boolean } = {},
): string {
  if (period.fiscalPeriod === "FY") return `FY${period.fiscalYear}`;
  if (/^Q[1-4]$/.test(period.fiscalPeriod)) return `${period.fiscalPeriod} FY${period.fiscalYear}`;
  return `${inSentence ? "the quarter" : "Quarter"} to ${period.end}`;
}
