import type { FinancialPeriod, NormalizedFundamentals } from "../fundamentals/types";
import type { Filing } from "../providers/types";
import { comparePeriods, quarterLabel, type Change } from "../scoring/changes";
import { describeEightK, type ItemSeverity } from "../signals/eight-k-items";

/**
 * A company's filings as a timeline, newest first.
 *
 * Every event is a filing the company made, linked to the document itself.
 * An event is labelled only with what the evidence says: the form tells
 * whether it is an annual or quarterly report, and an 8-K's item codes tell
 * whether it announced results, a deal, a change at the top or new shares.
 * An 8-K whose items say none of those is a material event and nothing more.
 *
 * Nothing is inferred from prose. There is no "buyback" or "dividend" label,
 * because neither has an 8-K item of its own, and guessing one from a
 * headline is exactly the kind of claim this app is careful not to make.
 *
 * A report carries the figures it contains — the moves in revenue and margin
 * against the comparable earlier period — when the page holds both periods.
 */

export type TimelineCategory =
  | "annual-report"
  | "quarterly-report"
  | "earnings"
  | "acquisition"
  | "executive-change"
  | "share-issuance"
  | "material-agreement"
  | "accounting"
  | "proxy"
  | "registration"
  | "material-event";

export interface ClassifiedFiling {
  category: TimelineCategory;
  /** The kind of event, in two or three words. */
  label: string;
  /** What the filing says happened. */
  title: string;
  severity: ItemSeverity;
}

export interface TimelineEvent extends ClassifiedFiling {
  /** The date it was filed. */
  date: string;
  form: string;
  /** "Q3 FY2026" or "FY2025", for a report whose figures the page holds. */
  period: string | null;
  /** The period the highlights are measured against. */
  comparedWith: string | null;
  /** "Revenue +8.2%", "Operating margin −0.7 pts". */
  highlights: string[];
  url: string;
}

export interface TimelineYear {
  year: string;
  events: TimelineEvent[];
}

const ANNUAL_FORM = /^(10-K|20-F|40-F)(\/A)?$/;
const QUARTERLY_FORM = /^10-Q(\/A)?$/;
const EIGHT_K = /^8-K(\/A)?$/;

/** 8-K items that name a kind of event. Every other item is a material event. */
const ITEM_CATEGORY: Record<string, { category: TimelineCategory; label: string }> = {
  "2.02": { category: "earnings", label: "Earnings" },
  "2.01": { category: "acquisition", label: "Acquisition or disposal" },
  "5.02": { category: "executive-change", label: "Executive change" },
  "3.02": { category: "share-issuance", label: "Share issuance" },
  "1.01": { category: "material-agreement", label: "Material agreement" },
  "1.02": { category: "material-agreement", label: "Material agreement" },
  "4.01": { category: "accounting", label: "Accounting" },
  "4.02": { category: "accounting", label: "Accounting" },
};

/** Exhibits attached — paperwork, not an event. */
const BOILERPLATE_ITEM = "9.01";

/** What one filing was, from its form and item codes alone. */
export function classifyFiling(filing: Filing): ClassifiedFiling {
  const form = filing.form.trim().toUpperCase();

  if (ANNUAL_FORM.test(form)) {
    return {
      category: "annual-report",
      label: "Annual report",
      title: `Annual report on Form ${filing.form}`,
      severity: "routine",
    };
  }

  if (QUARTERLY_FORM.test(form)) {
    return {
      category: "quarterly-report",
      label: "Quarterly report",
      title: `Quarterly report on Form ${filing.form}`,
      severity: "routine",
    };
  }

  if (EIGHT_K.test(form)) {
    const summary = describeEightK(filing.items);
    const events = summary.items.filter((item) => item.code !== BOILERPLATE_ITEM);
    // describeEightK lists the most significant items first, so the first
    // item with a kind of its own is the one the event is named after.
    const named = events.find((item) => ITEM_CATEGORY[item.code]);

    return {
      category: named ? ITEM_CATEGORY[named.code].category : "material-event",
      label: named ? ITEM_CATEGORY[named.code].label : "Material event",
      title: events.length > 0 ? events.map((item) => item.label).join(" · ") : summary.headline,
      severity: summary.severity,
    };
  }

  if (form === "DEF 14A") {
    return {
      category: "proxy",
      label: "Proxy statement",
      title: "Proxy statement for a shareholder meeting",
      severity: "routine",
    };
  }

  if (/^S-1(\/A)?$/.test(form)) {
    return {
      category: "registration",
      label: "Registration statement",
      title: "Registration statement for an offering of securities",
      severity: "notable",
    };
  }

  if (/^6-K(\/A)?$/.test(form)) {
    return {
      category: "material-event",
      label: "Foreign issuer report",
      title: "Report filed on Form 6-K",
      severity: "routine",
    };
  }

  return {
    category: "material-event",
    label: filing.form,
    title: filing.description ?? `Filed on Form ${filing.form}`,
    severity: "routine",
  };
}

/**
 * Builds the timeline, grouped by the year each filing was made.
 *
 * `fundamentals` supplies the figures behind reports; without it the timeline
 * still lists every filing, just without highlights.
 */
export function buildFilingTimeline(
  filings: Filing[],
  fundamentals: NormalizedFundamentals | null,
  currency = "USD",
): TimelineYear[] {
  const events = [...filings]
    .sort((a, b) => b.filedAt.localeCompare(a.filedAt))
    .map((filing) => toEvent(filing, fundamentals, currency));

  const years = new Map<string, TimelineEvent[]>();
  for (const event of events) {
    const year = event.date.slice(0, 4);
    const list = years.get(year);
    if (list) list.push(event);
    else years.set(year, [event]);
  }

  return [...years].map(([year, yearEvents]) => ({ year, events: yearEvents }));
}

function toEvent(
  filing: Filing,
  fundamentals: NormalizedFundamentals | null,
  currency: string,
): TimelineEvent {
  const classified = classifyFiling(filing);
  const report = reportPeriods(filing, fundamentals);
  const comparison =
    report?.earlier ? comparePeriods(report.period, report.earlier, currency) : null;

  return {
    ...classified,
    title: report ? `${classified.label} for ${periodLabel(report.period)}` : classified.title,
    date: filing.filedAt,
    form: filing.form,
    period: report ? periodLabel(report.period) : null,
    comparedWith: report?.earlier ? periodLabel(report.earlier) : null,
    highlights: comparison ? highlightsOf(comparison.changes) : [],
    url: filing.url,
  };
}

/**
 * The period a report covers, and the period its figures are fairly compared
 * against: the previous fiscal year for an annual report, the same quarter a
 * year earlier for a quarterly one. Null when the page does not hold the
 * period the filing reports on.
 */
function reportPeriods(
  filing: Filing,
  fundamentals: NormalizedFundamentals | null,
): { period: FinancialPeriod; earlier: FinancialPeriod | null } | null {
  if (!fundamentals || !filing.periodOfReport) return null;
  const form = filing.form.trim().toUpperCase();

  if (ANNUAL_FORM.test(form)) {
    const index = fundamentals.annual.findIndex((p) => p.end === filing.periodOfReport);
    if (index < 0) return null;
    const period = fundamentals.annual[index];
    const candidate = fundamentals.annual[index + 1];
    // A missing year between the two would make this a two-year comparison.
    const earlier = candidate && candidate.fiscalYear === period.fiscalYear - 1 ? candidate : null;
    return { period, earlier };
  }

  if (QUARTERLY_FORM.test(form)) {
    const quarters = fundamentals.quarterly ?? [];
    const period = quarters.find((q) => q.end === filing.periodOfReport);
    if (!period) return null;
    const earlier =
      quarters.find(
        (q) =>
          q !== period &&
          q.fiscalPeriod === period.fiscalPeriod &&
          daysBetween(q.end, period.end) >= 350 &&
          daysBetween(q.end, period.end) <= 380,
      ) ?? null;
    return { period, earlier };
  }

  return null;
}

function periodLabel(period: FinancialPeriod): string {
  return period.fiscalPeriod === "FY" ? `FY${period.fiscalYear}` : quarterLabel(period);
}

function daysBetween(earlierEnd: string, laterEnd: string): number {
  return (Date.parse(laterEnd) - Date.parse(earlierEnd)) / 86_400_000;
}

/**
 * Up to three moves: revenue, a margin, then the largest of the rest.
 *
 * Only moves the What Changed rules count as material appear at all, so a
 * quarter where revenue barely moved simply shows no revenue line.
 */
function highlightsOf(changes: Change[]): string[] {
  const picked: Change[] = [];
  const add = (change: Change | undefined) => {
    if (change && !picked.includes(change) && picked.length < 3) picked.push(change);
  };

  add(changes.find((c) => c.key === "revenue"));
  add(changes.find((c) => c.key === "operatingMargin") ?? changes.find((c) => c.key === "netMargin"));
  for (const change of changes) add(change);

  return picked.map((change) => `${change.label} ${change.delta}`);
}
