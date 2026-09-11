/**
 * How far a figure has to move before it is worth a reader's attention — the
 * one place those lines are drawn.
 *
 * These used to be three constants inside changes.ts, with nothing to say how
 * a move just past the line differed from one ten times larger. Every panel
 * that grades a change reads this file instead, so What Changed and the
 * investor brief cannot disagree about what counts as a big move.
 *
 *  - normal: under the line. Counted as steady and never listed.
 *  - notable: past it. Worth listing.
 *  - significant: a move a reader would expect the company to explain.
 *  - critical: large enough to change the picture of the company for the
 *    period — and any figure that crossed zero, which always is.
 *
 * Measured three ways because the same number means different things. Money
 * moves relatively, margins move in percentage points, and the share count
 * gets the tightest band: a company quietly issuing three per cent more stock
 * has taken three per cent of everything from the holders it already had.
 */

export type ChangeSeverity = "normal" | "notable" | "significant" | "critical";

export type ChangeMeasure = "amount" | "margin" | "shares";

interface Bands {
  notable: number;
  significant: number;
  critical: number;
}

export const CHANGE_BANDS: Readonly<Record<ChangeMeasure, Bands>> = {
  // A relative change: 0.05 is a 5% move.
  amount: { notable: 0.05, significant: 0.15, critical: 0.4 },
  // Percentage points, as fractions: 0.01 is one point.
  margin: { notable: 0.01, significant: 0.03, critical: 0.08 },
  // A relative change in shares in issue.
  shares: { notable: 0.01, significant: 0.05, critical: 0.1 },
};

/**
 * Grades a move by its size alone, whichever direction it went.
 *
 * The caller rounds a margin to the precision it prints before asking: two
 * percent to three percent is 0.009999999999999998 in floating point, and a
 * move shown as "+1.0 pts" must not be graded as smaller than one point.
 */
export function classifyChange(measure: ChangeMeasure, magnitude: number): ChangeSeverity {
  if (!Number.isFinite(magnitude)) return "normal";

  const size = Math.abs(magnitude);
  const band = CHANGE_BANDS[measure];

  if (size >= band.critical) return "critical";
  if (size >= band.significant) return "significant";
  if (size >= band.notable) return "notable";
  return "normal";
}

/** A figure that crossed zero — a profit turning into a loss — is the largest move there is. */
export const CROSSED_ZERO: ChangeSeverity = "critical";

const RANK: Record<ChangeSeverity, number> = {
  critical: 0,
  significant: 1,
  notable: 2,
  normal: 3,
};

/** Sort comparator: the largest moves first. Stable for equal grades. */
export function bySeverity<T extends { severity: ChangeSeverity }>(a: T, b: T): number {
  return RANK[a.severity] - RANK[b.severity];
}

/** The larger of two grades. */
export function atLeast(grade: ChangeSeverity, floor: ChangeSeverity): ChangeSeverity {
  return RANK[grade] <= RANK[floor] ? grade : floor;
}

export const SEVERITY_LABEL: Readonly<Record<ChangeSeverity, string>> = {
  normal: "Normal",
  notable: "Notable",
  significant: "Significant",
  critical: "Critical",
};
