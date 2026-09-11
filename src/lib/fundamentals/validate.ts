import type { SectorKind } from "../scoring/applicability";
import type { CanonicalField, FinancialPeriod, NormalizedFundamentals } from "./types";

/**
 * Automated checks on a company's figures before they are trusted.
 *
 * XBRL data is the company's own tagging of its own statements, and tagging
 * mistakes happen: a figure in thousands tagged as units, a total tagged with
 * the wrong concept, a split that changes the share count overnight. None of
 * these checks changes a number. Each one says where the figures disagree with
 * themselves, so a reader knows which part of the filing to check before
 * relying on a ratio built from it.
 *
 * Two levels. A note describes something usually innocent that still affects
 * the figures, such as equity belonging to minority shareholders. A warning
 * describes something that more often means the data is wrong.
 */

export type CheckSeverity = "note" | "warning";

export interface DataCheck {
  key: string;
  severity: CheckSeverity;
  /** The period the check concerns, e.g. "FY2025". */
  period: string | null;
  message: string;
}

const COUNT_FIELDS: ReadonlySet<CanonicalField> = new Set(["sharesOutstanding"]);
const BALANCE_TOLERANCE = 0.02;
const BALANCE_WARNING = 0.1;
const DAY_MS = 86_400_000;

const pct = (value: number) => `${(Math.abs(value) * 100).toFixed(1)}%`;

function label(period: FinancialPeriod): string {
  if (period.fiscalPeriod === "FY") return `FY${period.fiscalYear}`;
  return /^Q[1-4]$/.test(period.fiscalPeriod)
    ? `${period.fiscalPeriod} FY${period.fiscalYear}`
    : `the quarter to ${period.end}`;
}

const value = (period: FinancialPeriod | undefined, field: CanonicalField) => {
  const fact = period?.facts[field];
  return fact && Number.isFinite(fact.value) ? fact.value : null;
};

export function validateFundamentals(
  fundamentals: NormalizedFundamentals,
  sector: SectorKind = "other",
  now: Date = new Date(),
): DataCheck[] {
  const checks: DataCheck[] = [];
  const financial = sector === "financial";
  const periods = [...fundamentals.annual.slice(0, 3), ...(fundamentals.quarterly ?? []).slice(0, 4)];

  for (const period of periods) {
    const name = label(period);
    const facts = Object.entries(period.facts) as [CanonicalField, NonNullable<FinancialPeriod["facts"][CanonicalField]>][];

    if (facts.some(([, fact]) => !Number.isFinite(fact.value))) {
      checks.push({
        key: "invalid-number",
        severity: "warning",
        period: name,
        message: `A figure reported for ${name} is not a valid number and was left out of the calculations.`,
      });
    }

    const currencies = new Set(facts.filter(([field]) => !COUNT_FIELDS.has(field)).map(([, fact]) => fact.unit));
    if (currencies.size > 1) {
      checks.push({
        key: "mixed-currency",
        severity: "warning",
        period: name,
        message: `${name} mixes figures reported in ${[...currencies].join(" and ")}, so ratios between them may be unreliable.`,
      });
    }
  }

  const annual = fundamentals.annual.slice(0, 3);
  annual.forEach((period, index) => {
    const name = label(period);
    const assets = value(period, "assets");
    const liabilities = value(period, "liabilities");
    const equity = value(period, "equity");

    // A derived liabilities figure is assets less equity, so it cannot disagree.
    if (assets != null && assets > 0 && liabilities != null && equity != null && !period.facts.liabilities?.derived) {
      const gap = (assets - liabilities - equity) / assets;
      if (Math.abs(gap) > BALANCE_TOLERANCE) {
        checks.push({
          key: "balance-identity",
          severity: Math.abs(gap) > BALANCE_WARNING ? "warning" : "note",
          period: name,
          message:
            `In ${name}, total assets differ from liabilities plus equity by ${pct(gap)}. This is usually equity ` +
            `belonging to minority shareholders or another item reported separately, but figures built on equity may be affected.`,
        });
      }
    }

    const revenue = value(period, "revenue");
    const ocf = value(period, "operatingCashFlow");
    const capex = value(period, "capex");
    const netIncome = value(period, "netIncome");

    if (!financial && revenue != null && revenue > 0) {
      if (ocf != null && Math.abs(ocf) > revenue * 2) {
        checks.push({
          key: "cash-flow-scale",
          severity: "warning",
          period: name,
          message: `In ${name}, operating cash flow is more than twice revenue, which is rare outside financial companies. A tagging or units error in the filing data is possible.`,
        });
      }
      if (capex != null && Math.abs(capex) > revenue) {
        checks.push({
          key: "capex-scale",
          severity: "note",
          period: name,
          message: `In ${name}, capital spending exceeded revenue. That happens during heavy investment, and it makes free cash flow for that year unrepresentative.`,
        });
      }
      if (netIncome != null && netIncome > revenue * 1.5) {
        checks.push({
          key: "one-off-income",
          severity: "note",
          period: name,
          message: `In ${name}, profit exceeded revenue, which almost always means a one-off gain. Margins for that year are not representative.`,
        });
      }
    }

    const prior = fundamentals.annual[index + 1];
    const shares = value(period, "sharesOutstanding");
    const priorShares = value(prior, "sharesOutstanding");
    if (prior && prior.fiscalYear === period.fiscalYear - 1 && shares != null && priorShares != null && priorShares > 0) {
      const change = (shares - priorShares) / priorShares;
      if (change > 0.5 || change < -0.33) {
        checks.push({
          key: "share-count",
          severity: "warning",
          period: name,
          message:
            `Shares outstanding changed by ${change > 0 ? "+" : "−"}${pct(change)} between FY${prior.fiscalYear} and ${name} — ` +
            `a stock split, a merger or a data error. Per-share figures across the two years may not be comparable.`,
        });
      }
    }
  });

  const latest = fundamentals.annual[0];
  if (latest) {
    const end = Date.parse(`${latest.end}T00:00:00Z`);
    if (Number.isFinite(end) && now.getTime() - end > 548 * DAY_MS) {
      checks.push({
        key: "stale-annual",
        severity: "note",
        period: label(latest),
        message: `The latest annual report on file covers the year to ${latest.end}, more than eighteen months ago. These figures may be out of date.`,
      });
    }
  }

  return checks.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "warning" ? -1 : 1));
}
