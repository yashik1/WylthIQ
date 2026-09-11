import { snapshotFundamentals } from "../fundamentals/as-reported";
import type { NormalizedFundamentals } from "../fundamentals/types";
import type { SectorKind } from "./applicability";
import { buildHealthReport } from "./health";
import { round } from "./math";

/**
 * How a company's health score has moved, year by year.
 *
 * Each point is scored from that year's annual report as it was first filed,
 * never from today's figures: a restatement published later does not reach
 * back into an earlier point, and a year that had not been reported yet is
 * not there. That is what makes "a year ago it scored 7.9" true of a year ago
 * rather than of today's knowledge about a year ago.
 *
 * Every point is scored without a share price, including the latest. There is
 * no stored price for each past filing date, and scoring only the newest year
 * with one would put a difference of method into the change. So the latest
 * point can sit slightly apart from the headline score, which does use the
 * current price, and the page says so.
 */

export interface HealthHistoryPoint {
  fiscalYear: number;
  /** The day that year's annual report was filed. Nothing filed later was used. */
  asOf: string;
  form: string;
  sourceFilingUrl: string | null;
  score: number;
  fScore: number | null;
  fScoreMax: number | null;
}

export interface HealthHistory {
  /** Oldest first, for charting. */
  points: HealthHistoryPoint[];
  latest: HealthHistoryPoint;
  /** The point for the fiscal year before the latest, when there is one. */
  yearEarlier: HealthHistoryPoint | null;
  /** Latest minus a year earlier, to one decimal. */
  change: number | null;
}

export function buildHealthHistory(
  fundamentals: NormalizedFundamentals | null,
  sector: SectorKind,
): HealthHistory | null {
  const snapshots = fundamentals?.asReported ?? [];
  if (!fundamentals || snapshots.length === 0) return null;

  const points: HealthHistoryPoint[] = [];
  for (const snapshot of snapshots) {
    const report = buildHealthReport(snapshotFundamentals(snapshot, fundamentals), sector, null);
    if (report.score == null) continue;

    const evaluated = report.piotroski.maxScore > 0;
    points.push({
      fiscalYear: snapshot.fiscalYear,
      asOf: snapshot.asOf,
      form: snapshot.form,
      sourceFilingUrl: snapshot.sourceFilingUrl,
      score: report.score,
      fScore: evaluated ? report.piotroski.score : null,
      fScoreMax: evaluated ? report.piotroski.maxScore : null,
    });
  }

  // One point is a score, not a history.
  if (points.length < 2) return null;

  points.sort((a, b) => a.fiscalYear - b.fiscalYear);
  const latest = points[points.length - 1];
  const yearEarlier = points.find((p) => p.fiscalYear === latest.fiscalYear - 1) ?? null;

  return {
    points,
    latest,
    yearEarlier,
    change: yearEarlier ? round(latest.score - yearEarlier.score, 1) : null,
  };
}
