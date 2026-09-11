/**
 * What a thesis can be tracked against, and the rules for reading one back.
 *
 * Plain data and validation only, so the form that builds conditions and the
 * action that stores them agree without the form importing any scoring code.
 *
 * The thesis is the reader's own. Nothing here suggests a condition, a target
 * or a status; it only checks that what was entered can be measured.
 */

export type MetricUnit = "percent" | "multiple" | "amount";
export type ConditionOperator = "above" | "below" | "positive" | "negative";

export const THESIS_METRICS = {
  revenueGrowth: { label: "Revenue growth", unit: "percent" },
  epsGrowth: { label: "Earnings per share growth", unit: "percent" },
  grossMargin: { label: "Gross margin", unit: "percent" },
  operatingMargin: { label: "Operating margin", unit: "percent" },
  netMargin: { label: "Net margin", unit: "percent" },
  fcfMargin: { label: "Free cash flow margin", unit: "percent" },
  freeCashFlow: { label: "Free cash flow", unit: "amount" },
  returnOnEquity: { label: "Return on equity", unit: "percent" },
  returnOnInvestedCapital: { label: "Return on invested capital", unit: "percent" },
  debtToEquity: { label: "Debt to equity", unit: "multiple" },
  debtToEbitda: { label: "Debt to EBITDA", unit: "multiple" },
  currentRatio: { label: "Current ratio", unit: "multiple" },
  interestCover: { label: "Interest cover", unit: "multiple" },
  shareCountChange: { label: "Change in shares outstanding", unit: "percent" },
} as const satisfies Record<string, { label: string; unit: MetricUnit }>;

export type ThesisMetricKey = keyof typeof THESIS_METRICS;

/** Which comparisons make sense for each kind of figure. */
export const OPERATORS_FOR: Record<MetricUnit, readonly ConditionOperator[]> = {
  percent: ["above", "below"],
  multiple: ["above", "below"],
  amount: ["positive", "negative"],
};

export const OPERATOR_LABEL: Record<ConditionOperator, string> = {
  above: "above",
  below: "below",
  positive: "positive",
  negative: "negative",
};

export interface ThesisCondition {
  metric: ThesisMetricKey;
  operator: ConditionOperator;
  /** In display units: 8 means 8% for a percentage, 2 means 2.0x. Null for a sign. */
  target: number | null;
}

export const THESIS_STATUSES = {
  active: "Active",
  "under-review": "Under review",
  intact: "Intact",
  "at-risk": "At risk",
  invalidated: "Invalidated",
} as const;

export type ThesisStatus = keyof typeof THESIS_STATUSES;

export const TIME_HORIZONS = {
  "under-1y": "Under a year",
  "1-3y": "One to three years",
  "3-5y": "Three to five years",
  "5y-plus": "Five years or more",
} as const;

export type TimeHorizon = keyof typeof TIME_HORIZONS;

export const MAX_CONDITIONS = 8;
export const MAX_THESIS_TEXT = 4000;

/** Targets beyond this are typing mistakes, not theses. */
const MAX_TARGET = 10_000;

export function cleanThesisText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  // Control characters out, line breaks and tabs kept.
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, MAX_THESIS_TEXT);
}

export function cleanStatus(raw: unknown): ThesisStatus {
  return typeof raw === "string" && raw in THESIS_STATUSES ? (raw as ThesisStatus) : "active";
}

export function cleanHorizon(raw: unknown): TimeHorizon | null {
  return typeof raw === "string" && raw in TIME_HORIZONS ? (raw as TimeHorizon) : null;
}

/**
 * Conditions as they come back from a form or from JSON.
 *
 * Rebuilt field by field rather than trusted. A condition that cannot be
 * measured — an unknown metric, an operator that does not fit it, a missing
 * or absurd target — is dropped rather than stored, and the list is capped.
 */
export function parseConditions(raw: unknown): ThesisCondition[] {
  if (!Array.isArray(raw)) return [];
  const out: ThesisCondition[] = [];

  for (const item of raw) {
    if (out.length >= MAX_CONDITIONS) break;
    if (!item || typeof item !== "object") continue;
    const { metric, operator, target } = item as Record<string, unknown>;

    if (typeof metric !== "string" || !(metric in THESIS_METRICS)) continue;
    const unit = THESIS_METRICS[metric as ThesisMetricKey].unit;
    if (typeof operator !== "string" || !OPERATORS_FOR[unit].includes(operator as ConditionOperator)) {
      continue;
    }

    if (operator === "above" || operator === "below") {
      const number = typeof target === "string" ? Number(target) : target;
      if (typeof number !== "number" || !Number.isFinite(number) || Math.abs(number) > MAX_TARGET) {
        continue;
      }
      out.push({ metric: metric as ThesisMetricKey, operator, target: number });
    } else {
      out.push({ metric: metric as ThesisMetricKey, operator: operator as ConditionOperator, target: null });
    }
  }

  return out;
}

/** "above 8%", "below 2.0x", "positive". */
export function describeTarget(condition: ThesisCondition): string {
  if (condition.target == null) return OPERATOR_LABEL[condition.operator];
  const unit = THESIS_METRICS[condition.metric].unit;
  const figure = unit === "percent" ? `${formatNumber(condition.target)}%` : `${condition.target.toFixed(1)}x`;
  return `${OPERATOR_LABEL[condition.operator]} ${figure}`;
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
