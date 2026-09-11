import { snapshotAsOf, snapshotPeriods } from "../fundamentals/as-reported";
import { fieldValue } from "../fundamentals/normalize";
import type { FinancialPeriod, NormalizedFundamentals } from "../fundamentals/types";
import { money } from "../format";
import { div } from "../scoring/math";
import { debtToEbitda, freeCashFlowOf, returnOnInvestedCapital } from "../scoring/returns";
import {
  describeTarget,
  THESIS_METRICS,
  type ThesisCondition,
  type ThesisMetricKey,
} from "./metrics";

/**
 * Thesis vs reality: a reader's own conditions, set against the figures.
 *
 * Two readings per condition. "Then" is what the filings showed on the day the
 * thesis was written, rebuilt from the annual report as it was first filed,
 * so a later restatement cannot make the starting point look different from
 * what the reader actually saw. "Now" is the latest annual report.
 *
 * Four outcomes only — on track, above expectation, below expectation, not
 * enough data. None of them is a recommendation, and the thesis status stays
 * whatever the reader set: a condition falling short is information for the
 * reader, not a decision made for them.
 */

export type ConditionStatus = "on-track" | "above" | "below" | "no-data";

export const CONDITION_STATUS_LABEL: Record<ConditionStatus, string> = {
  "on-track": "On track",
  above: "Above expectation",
  below: "Below expectation",
  "no-data": "Not enough data",
};

export interface Reading {
  fiscalYear: number;
  /** In display units: 10.2 for 10.2%, 1.8 for 1.8x, or the amount itself. */
  value: number | null;
  text: string;
}

export interface ConditionResult {
  condition: ThesisCondition;
  label: string;
  target: string;
  then: Reading | null;
  now: Reading | null;
  status: ConditionStatus;
}

export interface ThesisReality {
  /** The ISO date the thesis was written. */
  writtenOn: string;
  /** The annual report the "then" readings come from, and when it was filed. */
  baseline: { fiscalYear: number; asOf: string | null } | null;
  latest: { fiscalYear: number; filedAt: string | null; newSinceThesis: boolean } | null;
  results: ConditionResult[];
  counts: Record<ConditionStatus, number>;
}

const growth = (now: number | null, before: number | null): number | null =>
  now == null || before == null || before === 0 ? null : (now - before) / Math.abs(before);

/**
 * One metric from a year and the year before it, in display units. Growth
 * needs the prior year to be the one immediately before; a gap is no data.
 */
export function metricValue(
  metric: ThesisMetricKey,
  latest: FinancialPeriod | undefined,
  prior: FinancialPeriod | undefined,
): number | null {
  if (!latest) return null;
  const v = (field: Parameters<typeof fieldValue>[1]) => fieldValue(latest, field);
  const consecutive = prior && prior.fiscalYear === latest.fiscalYear - 1 ? prior : undefined;
  const p = (field: Parameters<typeof fieldValue>[1]) => fieldValue(consecutive, field);

  const revenue = v("revenue");
  const fcf = freeCashFlowOf(v("operatingCashFlow"), v("capex"));
  const percent = (x: number | null) => (x == null ? null : x * 100);

  switch (metric) {
    case "revenueGrowth":
      return percent(growth(revenue, p("revenue")));
    case "epsGrowth":
      return percent(
        growth(div(v("netIncome"), v("sharesOutstanding")), div(p("netIncome"), p("sharesOutstanding"))),
      );
    case "grossMargin":
      return percent(div(v("grossProfit"), revenue));
    case "operatingMargin":
      return percent(div(v("operatingIncome"), revenue));
    case "netMargin":
      return percent(div(v("netIncome"), revenue));
    case "fcfMargin":
      return percent(div(fcf, revenue));
    case "freeCashFlow":
      return fcf;
    case "returnOnEquity":
      return percent(div(v("netIncome"), v("equity")));
    case "returnOnInvestedCapital":
      return percent(returnOnInvestedCapital(latest));
    case "debtToEquity":
      return div(v("liabilities"), v("equity"));
    case "debtToEbitda":
      return debtToEbitda(latest);
    case "currentRatio":
      return div(v("currentAssets"), v("currentLiabilities"));
    case "interestCover": {
      const interest = v("interestExpense");
      return interest != null && interest > 0 ? div(v("operatingIncome"), interest) : null;
    }
    case "shareCountChange":
      return percent(growth(v("sharesOutstanding"), p("sharesOutstanding")));
  }
}

/** How far past the target counts as comfortably past it, rather than just past it. */
function margin(metric: ThesisMetricKey, target: number): number {
  const relative = Math.abs(target) * 0.25;
  return THESIS_METRICS[metric].unit === "percent" ? Math.max(2, relative) : Math.max(0.25, relative);
}

export function evaluateCondition(condition: ThesisCondition, actual: number | null): ConditionStatus {
  if (actual == null || !Number.isFinite(actual)) return "no-data";

  switch (condition.operator) {
    case "positive":
      return actual > 0 ? "on-track" : "below";
    case "negative":
      return actual < 0 ? "on-track" : "below";
    case "above": {
      const target = condition.target ?? 0;
      if (actual < target) return "below";
      return actual >= target + margin(condition.metric, target) ? "above" : "on-track";
    }
    case "below": {
      // "Above expectation" here means comfortably better than the ceiling the
      // reader set — lower debt than they required, say.
      const target = condition.target ?? 0;
      if (actual > target) return "below";
      return actual <= target - margin(condition.metric, target) ? "above" : "on-track";
    }
  }
}

function formatReading(metric: ThesisMetricKey, value: number | null, currency: string): string {
  if (value == null) return "Not reported";
  switch (THESIS_METRICS[metric].unit) {
    case "percent":
      return `${value.toFixed(1)}%`;
    case "multiple":
      return `${value.toFixed(2)}x`;
    case "amount":
      return money(value, currency);
  }
}

function reading(
  metric: ThesisMetricKey,
  periods: FinancialPeriod[],
): Reading | null {
  const [latest, prior] = periods;
  if (!latest) return null;
  const currency = latest.facts.revenue?.unit ?? latest.facts.assets?.unit ?? "USD";
  const value = metricValue(metric, latest, prior);
  return { fiscalYear: latest.fiscalYear, value, text: formatReading(metric, value, currency) };
}

/**
 * The annual periods that were public on a date.
 *
 * Prefers an as-reported snapshot, which holds the figures as first filed.
 * Without one — a fallback provider supplies none — it keeps the years filed
 * by that date, whose values may include later restatements, and a year with
 * no filing date at all is left out rather than assumed to have been known.
 */
function periodsKnownOn(fundamentals: NormalizedFundamentals, isoDate: string): {
  periods: FinancialPeriod[];
  asOf: string | null;
} {
  const snapshot = snapshotAsOf(fundamentals, isoDate);
  if (snapshot) return { periods: snapshotPeriods(snapshot), asOf: snapshot.asOf };

  const periods = fundamentals.annual.filter((p) => p.filedAt != null && p.filedAt <= isoDate);
  return { periods, asOf: periods[0]?.filedAt ?? null };
}

export function buildThesisReality(
  conditions: ThesisCondition[],
  writtenAt: Date,
  fundamentals: NormalizedFundamentals | null,
): ThesisReality {
  const writtenOn = writtenAt.toISOString().slice(0, 10);
  const counts: Record<ConditionStatus, number> = { "on-track": 0, above: 0, below: 0, "no-data": 0 };

  const current = fundamentals?.annual ?? [];
  const known = fundamentals ? periodsKnownOn(fundamentals, writtenOn) : { periods: [], asOf: null };

  const results = conditions.map((condition): ConditionResult => {
    const now = reading(condition.metric, current);
    const then = reading(condition.metric, known.periods);
    const status = evaluateCondition(condition, now?.value ?? null);
    counts[status] += 1;
    return {
      condition,
      label: THESIS_METRICS[condition.metric].label,
      target: describeTarget(condition),
      then,
      now,
      status,
    };
  });

  const latest = current[0];
  return {
    writtenOn,
    baseline: known.periods[0] ? { fiscalYear: known.periods[0].fiscalYear, asOf: known.asOf } : null,
    latest: latest
      ? {
          fiscalYear: latest.fiscalYear,
          filedAt: latest.filedAt,
          newSinceThesis: latest.filedAt != null && latest.filedAt > writtenOn,
        }
      : null,
    results,
    counts,
  };
}
