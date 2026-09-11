import { fieldValue } from "../fundamentals/normalize";
import type { CanonicalField, FinancialPeriod, NormalizedFundamentals } from "../fundamentals/types";
import { money, num, signedPercent } from "../format";
import {
  atLeast,
  bySeverity,
  classifyChange,
  CROSSED_ZERO,
  type ChangeSeverity,
} from "./change-thresholds";
import { div, round } from "./math";
import { periodLabel } from "../fundamentals/period-label";
import { freeCashFlowOf } from "./returns";

/**
 * What moved between two reported periods.
 *
 * The rest of this app describes where a company stands. This describes what
 * changed to get it there, which is a different and often more useful question:
 * a 12% margin means little on its own, and a 12% margin that was 19% last year
 * means a great deal.
 *
 * Three comparisons, each only when it is a fair one: the latest fiscal year
 * against the one before, the latest quarter against the same quarter a year
 * earlier, and the latest quarter against the quarter before it. Nothing about
 * narrative disclosure: this reads XBRL facts, and the management discussion
 * lives in the filing's prose, which is never fetched.
 *
 * Three rules keep this honest.
 *
 * Only material moves are reported. Every figure changes by something every
 * period, and a list that says so is noise a reader has to filter for
 * themselves; the bands in change-thresholds.ts are the filter, and what falls
 * under them is counted rather than listed, so "nothing much moved" stays a
 * visible answer.
 *
 * A percentage is never printed across a sign change. A company going from a
 * $100M loss to a $50M profit has not improved by "150%" — the figure is
 * arithmetically true and tells the reader nothing, and the same expression
 * gives a *positive* percentage to a company sliding from profit into loss.
 * Those cases get a sentence instead.
 *
 * Direction is withheld where the direction is genuinely arguable. Capital
 * spending rising is investment or bloat depending on facts not in the filing,
 * so it carries no better-or-worse mark at all rather than a confident wrong
 * one.
 */

/** Whether a move reads as an improvement, a deterioration, or neither. */
export type ChangeDirection = "better" | "worse" | "neutral";

export interface Change {
  key: string;
  /** What moved, in plain words. */
  label: string;
  /** The earlier period's figure, formatted. */
  from: string;
  /** The latest figure, formatted. */
  to: string;
  /**
   * The move itself — "+12.4%", "+1.8 pts", "$3.10B narrower". Never a
   * percentage computed across zero.
   */
  delta: string;
  direction: ChangeDirection;
  /**
   * How large the move is, graded on the shared scale. Never "normal": a move
   * that small is counted as steady rather than listed.
   */
  severity: Exclude<ChangeSeverity, "normal">;
  /** Why this measure matters, and what would make a move in it not matter. */
  meaning: string;
}

/** What moved between one pair of periods. */
export interface PeriodComparison {
  changes: Change[];
  /** How many measures were compared and found to have barely moved. */
  steady: number;
}

/** Two quarters compared. */
export interface QuarterComparison extends PeriodComparison {
  kind: "year-over-year" | "sequential";
  /** The latest quarter, e.g. "Q3 FY2026". */
  toLabel: string;
  /** The quarter it is measured against. */
  fromLabel: string;
  form: string | null;
  /** When the latest quarter's figures became public. */
  filedAt: string | null;
  sourceFilingUrl: string | null;
}

export interface ChangeReport extends PeriodComparison {
  /** The earlier of the two fiscal years compared. */
  fromYear: number;
  /** The later of the two. */
  toYear: number;
  /** The filing form the latest figures came from, e.g. `10-K`. */
  form: string | null;
  /** When the latest annual figures became public. */
  filedAt: string | null;
  sourceFilingUrl: string | null;
  /**
   * Comparisons between reported quarters newer than the latest annual
   * report. Empty for a company that files no 10-Q, and for one whose latest
   * news is the annual report itself.
   */
  quarterly: QuarterComparison[];
}

/** Days apart two same-quarter period ends may be and still be a year apart. */
const YEAR_APART = { min: 350, max: 380 };
/** Days apart two back-to-back quarters' period ends may be. */
const QUARTER_APART = { min: 80, max: 100 };

/**
 * Builds the comparison, or null when there is nothing to compare against.
 *
 * A first-year filer and a company whose prior year never made it into the
 * data are the same case here: one period is not a comparison, and an empty
 * panel claiming "no significant changes" would be a statement about the
 * company rather than about the data.
 */
export function buildChangeReport(
  fundamentals: NormalizedFundamentals,
  currency = "USD",
): ChangeReport | null {
  const latest = fundamentals.annual[0];
  const prior = fundamentals.annual[1];
  if (!latest || !prior) return null;

  const { changes, steady } = comparePeriods(latest, prior, currency);

  return {
    fromYear: prior.fiscalYear,
    toYear: latest.fiscalYear,
    form: latest.form ?? null,
    filedAt: latest.filedAt ?? null,
    changes,
    steady,
    sourceFilingUrl: latest.facts.assets?.sourceFilingUrl ?? null,
    quarterly: buildQuarterComparisons(fundamentals.quarterly, latest.end, currency),
  };
}

/**
 * The fair comparisons for the latest reported quarter.
 *
 * "Never compare incompatible periods", in practice:
 *  - only a quarter newer than the latest annual report is "the latest
 *    quarter" — otherwise the annual comparison is the newer news;
 *  - a year-over-year pair must be the same fiscal quarter, a year apart;
 *  - a sequential pair must be back to back and in fiscal order.
 *
 * A first quarter never gets a sequential comparison. The quarter before it
 * is a fourth quarter, which no company files on its own, and working one out
 * as the annual total less nine months would be a number nobody reported.
 */
export function buildQuarterComparisons(
  quarters: FinancialPeriod[] | undefined,
  latestAnnualEnd: string | null,
  currency = "USD",
): QuarterComparison[] {
  if (!quarters || quarters.length < 2) return [];

  const [latest, ...earlier] = quarters;
  if (!isQuarterLabel(latest.fiscalPeriod)) return [];
  if (latestAnnualEnd && latest.end <= latestAnnualEnd) return [];

  const out: QuarterComparison[] = [];

  const yearAgo = earlier.find(
    (q) =>
      q.fiscalPeriod === latest.fiscalPeriod &&
      within(daysApart(q.end, latest.end), YEAR_APART),
  );
  if (yearAgo) out.push(describeQuarters("year-over-year", latest, yearAgo, currency));

  const previous = earlier[0];
  if (
    previous &&
    within(daysApart(previous.end, latest.end), QUARTER_APART) &&
    followsInFiscalYear(previous, latest)
  ) {
    out.push(describeQuarters("sequential", latest, previous, currency));
  }

  return out;
}

function describeQuarters(
  kind: QuarterComparison["kind"],
  latest: FinancialPeriod,
  earlier: FinancialPeriod,
  currency: string,
): QuarterComparison {
  const anchor = latest.facts.revenue ?? latest.facts.netIncome;
  return {
    kind,
    toLabel: periodLabel(latest),
    fromLabel: periodLabel(earlier),
    form: latest.form ?? null,
    filedAt: latest.filedAt ?? null,
    sourceFilingUrl: anchor?.sourceFilingUrl ?? null,
    ...comparePeriods(latest, earlier, currency),
  };
}

function isQuarterLabel(fiscalPeriod: string): boolean {
  return /^Q[1-3]$/.test(fiscalPeriod);
}

/** Q2 after Q1, or Q3 after Q2, in the same fiscal year. */
function followsInFiscalYear(previous: FinancialPeriod, latest: FinancialPeriod): boolean {
  if (!isQuarterLabel(previous.fiscalPeriod) || !isQuarterLabel(latest.fiscalPeriod)) return false;
  return (
    previous.fiscalYear === latest.fiscalYear &&
    Number(latest.fiscalPeriod[1]) === Number(previous.fiscalPeriod[1]) + 1
  );
}

function daysApart(earlierEnd: string, laterEnd: string): number {
  return (Date.parse(laterEnd) - Date.parse(earlierEnd)) / 86_400_000;
}

function within(days: number, range: { min: number; max: number }): boolean {
  return Number.isFinite(days) && days >= range.min && days <= range.max;
}

/**
 * Every measure compared between two periods of the same length.
 *
 * Exported so a quarter and a year go through exactly the same rules; the
 * caller is responsible for handing it two comparable periods.
 */
export function comparePeriods(
  latest: FinancialPeriod,
  prior: FinancialPeriod,
  currency = "USD",
): PeriodComparison {
  const f = (k: CanonicalField) => fieldValue(latest, k);
  const p = (k: CanonicalField) => fieldValue(prior, k);

  const changes: Change[] = [];
  let steady = 0;

  /** Records a comparison, or counts it as steady, or drops it as unreportable. */
  const consider = (change: Change | "steady" | null) => {
    if (change === "steady") steady += 1;
    else if (change) changes.push(change);
  };

  const amount = (v: number | null) => money(v, currency);

  // ---- the top line ----
  consider(
    amountChange({
      key: "revenue",
      label: "Revenue",
      from: p("revenue"),
      to: f("revenue"),
      format: amount,
      rising: "better",
      meaning:
        "Sales are what everything else is built on. A fall can be lost customers, lower prices, " +
        "or a business the company sold — the filing itself says which.",
    }),
  );

  consider(
    amountChange({
      key: "grossProfit",
      label: "Gross profit",
      from: p("grossProfit"),
      to: f("grossProfit"),
      format: amount,
      rising: "better",
      meaning:
        "What is left of sales after the direct cost of producing them. It normally moves with " +
        "revenue, so a move out of step with revenue is the part worth noticing.",
    }),
  );

  consider(
    amountChange({
      key: "operatingIncome",
      label: "Operating income",
      from: p("operatingIncome"),
      to: f("operatingIncome"),
      format: amount,
      rising: "better",
      meaning:
        "Profit from running the business, before interest and tax. Less exposed than profit to " +
        "one-off financing and tax items, so a clearer read on the business itself.",
    }),
  );

  // ---- the bottom line ----
  consider(
    amountChange({
      key: "netIncome",
      label: "Profit",
      from: p("netIncome"),
      to: f("netIncome"),
      format: amount,
      rising: "better",
      meaning:
        "Profit swings far more than sales do, and one-off items — a legal settlement, a tax " +
        "charge, an asset sale — move it without the underlying business changing.",
    }),
  );

  // ---- margins, in points rather than per cent ----
  consider(
    marginChange({
      key: "grossMargin",
      label: "Gross margin",
      from: div(p("grossProfit"), p("revenue")),
      to: div(f("grossProfit"), f("revenue")),
      meaning:
        "What survives each sale before overheads. Falling gross margin usually means the company " +
        "is discounting or its input costs rose — it is the earliest place pricing pressure shows.",
    }),
  );

  consider(
    marginChange({
      key: "operatingMargin",
      label: "Operating margin",
      from: div(p("operatingIncome"), p("revenue")),
      to: div(f("operatingIncome"), f("revenue")),
      meaning:
        "What survives each sale after running the business. A falling operating margin beside a " +
        "steady gross margin points at overheads — wages, marketing, research — rather than pricing.",
    }),
  );

  consider(
    marginChange({
      key: "netMargin",
      label: "Profit margin",
      from: div(p("netIncome"), p("revenue")),
      to: div(f("netIncome"), f("revenue")),
      meaning:
        "What survives to the very end of each sale. Worth reading beside revenue: growing sales " +
        "on a shrinking margin means the company is buying its growth.",
    }),
  );

  // ---- cash the business actually generated ----
  consider(
    amountChange({
      key: "freeCashFlow",
      label: "Free cash flow",
      from: freeCashFlowOf(p("operatingCashFlow"), p("capex")),
      to: freeCashFlowOf(f("operatingCashFlow"), f("capex")),
      format: amount,
      rising: "better",
      meaning:
        "Cash left after paying for the plant that produced it — the money genuinely available " +
        "for dividends, buybacks or paying down debt. Harder to flatter than profit.",
    }),
  );

  // ---- per share ----
  consider(
    amountChange({
      key: "eps",
      label: "Earnings per share",
      from: perShare(p("netIncome"), p("sharesOutstanding")),
      to: perShare(f("netIncome"), f("sharesOutstanding")),
      format: amount,
      rising: "better",
      meaning:
        "Profit divided by the shares in issue at the period end, so it sits close to but not on " +
        "the company's own reported figure. It can rise with no growth in profit when the company " +
        "buys back stock — read it beside the share count.",
    }),
  );

  // ---- what it owes ----
  consider(
    amountChange({
      key: "longTermDebt",
      label: "Long-term debt",
      from: p("longTermDebt"),
      to: f("longTermDebt"),
      format: amount,
      rising: "worse",
      meaning:
        "Rising debt is not automatically bad — borrowing to build something that earns more than " +
        "the interest is ordinary. It matters when it grows faster than the profit meant to service it.",
    }),
  );

  // ---- what it holds ----
  consider(
    amountChange({
      key: "cash",
      label: "Cash",
      from: p("cash"),
      to: f("cash"),
      format: amount,
      rising: "better",
      meaning:
        "A falling cash pile is only a warning if the company is consuming it. Paying down debt, " +
        "buying back stock and paying a dividend all reduce cash by choice.",
    }),
  );

  // ---- who owns it ----
  consider(
    shareCountChange({
      from: p("sharesOutstanding"),
      to: f("sharesOutstanding"),
    }),
  );

  // ---- what it paid out, deliberately unrated ----
  consider(
    amountChange({
      key: "dividendsPaid",
      label: "Dividends paid",
      from: absOrNull(p("dividendsPaid")),
      to: absOrNull(f("dividendsPaid")),
      format: amount,
      rising: "neutral",
      meaning:
        "Cash handed to shareholders. A rise can be a higher dividend or simply more shares, and a " +
        "cut is a decision the company explains in its own filing — neither is rated here.",
    }),
  );

  // ---- spending, deliberately unrated ----
  consider(
    amountChange({
      key: "capex",
      label: "Capital spending",
      from: absOrNull(p("capex")),
      to: absOrNull(f("capex")),
      format: amount,
      rising: "neutral",
      meaning:
        "Neither good nor bad on its own. Heavy spending is a company building capacity or a " +
        "company struggling to stand still, and the two look identical in this figure.",
    }),
  );

  return { changes: changes.sort(bySeverity), steady };
}

/** Profit per share, only where there is a positive share count to divide by. */
function perShare(netIncome: number | null, shares: number | null): number | null {
  if (netIncome == null || shares == null || shares <= 0) return null;
  return netIncome / shares;
}

function absOrNull(v: number | null): number | null {
  return v == null ? null : Math.abs(v);
}

/**
 * A change in an amount of money.
 *
 * Returns `"steady"` when the move is under the notable band, and `null`
 * when there is no honest way to describe it — a missing figure either side.
 */
function amountChange({
  key,
  label,
  from,
  to,
  format,
  rising,
  meaning,
}: {
  key: string;
  label: string;
  from: number | null;
  to: number | null;
  format: (v: number | null) => string;
  rising: ChangeDirection;
  meaning: string;
}): Change | "steady" | null {
  if (from == null || to == null) return null;

  const absolute = to - from;
  const falling: ChangeDirection =
    rising === "better" ? "worse" : rising === "worse" ? "better" : "neutral";
  const direction = absolute === 0 ? "neutral" : absolute > 0 ? rising : falling;

  /*
    A sign change, where a percentage would be actively misleading.

    Loss to profit and profit to loss are the cases that matter, and the naive
    expression gets both wrong: it reports the recovery as a large negative
    change and the collapse as a large positive one, because the arithmetic
    divides by a negative base. These are also the two largest events in this
    whole comparison, so they are always reported, whatever the magnitude.
  */
  if (from <= 0 || to <= 0) {
    if (from <= 0 && to > 0) {
      return {
        key,
        label,
        from: format(from),
        to: format(to),
        delta: "turned positive",
        direction: rising === "neutral" ? "neutral" : rising,
        severity: gradeOf(CROSSED_ZERO),
        meaning,
      };
    }
    if (from > 0 && to <= 0) {
      return {
        key,
        label,
        from: format(from),
        to: format(to),
        delta: "turned negative",
        direction: rising === "neutral" ? "neutral" : falling,
        severity: gradeOf(CROSSED_ZERO),
        meaning,
      };
    }
    // Negative on both sides — a deepening or narrowing loss. The percentage is
    // still meaningless against a negative base, so the amount carries it.
    if (absolute === 0) return "steady";
    return {
      key,
      label,
      from: format(from),
      to: format(to),
      delta: `${format(Math.abs(absolute))} ${absolute > 0 ? "narrower" : "wider"}`,
      direction,
      // Always reported, as it always was; graded by how far the loss moved.
      severity: gradeOf(atLeast(classifyChange("amount", absolute / Math.abs(from)), "notable")),
      meaning,
    };
  }

  const relative = div(absolute, Math.abs(from));
  if (relative == null) return null;

  const severity = classifyChange("amount", relative);
  if (severity === "normal") return "steady";

  return {
    key,
    label,
    from: format(from),
    to: format(to),
    delta: signedPercent(relative, 1),
    direction,
    severity,
    meaning,
  };
}

/**
 * A change in a margin, reported in percentage points.
 *
 * Margins are already percentages, so a relative change compounds two of them
 * into a figure nobody can hold in their head: a margin going from 2% to 3% is
 * "up 50%", which sounds like an enormous event and is one point. Points are
 * how these are discussed everywhere else, so they are how they are shown here.
 */
function marginChange({
  key,
  label,
  from,
  to,
  meaning,
}: {
  key: string;
  label: string;
  from: number | null;
  to: number | null;
  meaning: string;
}): Change | "steady" | null {
  if (from == null || to == null) return null;

  /*
    Rounded before the threshold test, not after.

    A margin going from 2% to 3% is 0.03 − 0.02, which in binary floating point
    is 0.009999999999999998 — just under the one-point band, so an exactly
    one-point move was being dropped as immaterial. Rounding to the precision
    the label is printed at also guarantees the two agree: nothing displayed as
    "+1.0 pts" can be filtered out for being smaller than one point.
  */
  const points = round(to - from, 4);
  const severity = classifyChange("margin", points);
  if (severity === "normal") return "steady";

  return {
    key,
    label,
    from: `${num(from * 100, 1)}%`,
    to: `${num(to * 100, 1)}%`,
    delta: `${points > 0 ? "+" : "−"}${num(Math.abs(points) * 100, 1)} pts`,
    direction: points > 0 ? "better" : "worse",
    severity,
    meaning,
  };
}

/**
 * A change in the share count, where the direction is the opposite of the
 * intuition most figures on this page follow.
 *
 * More shares is worse and fewer is better, because the company is divided
 * into them. It is also the one line here a reader is least likely to check
 * for themselves, and the one most likely to move without any announcement.
 */
function shareCountChange({
  from,
  to,
}: {
  from: number | null;
  to: number | null;
}): Change | "steady" | null {
  if (from == null || to == null || from <= 0) return null;

  const relative = div(to - from, from);
  if (relative == null) return null;

  const severity = classifyChange("shares", relative);
  if (severity === "normal") return "steady";

  const issued = relative > 0;
  return {
    key: "sharesOutstanding",
    label: "Shares in issue",
    from: compactShares(from),
    to: compactShares(to),
    delta: signedPercent(relative, 1),
    direction: issued ? "worse" : "better",
    severity,
    meaning: issued
      ? "New shares divide the same company into more pieces, so each existing holding owns " +
        "slightly less of it. Often pay for staff or an acquisition rather than anything wrong."
      : "The company bought back stock, so each remaining holding owns slightly more of it. " +
        "Worth checking it was not funded by borrowing.",
  };
}

/** Narrows a grade already known not to be "normal" to the listed grades. */
function gradeOf(grade: ChangeSeverity): Exclude<ChangeSeverity, "normal"> {
  return grade === "normal" ? "notable" : grade;
}

/** Share counts run to billions; the money formatter would print a currency. */
function compactShares(v: number): string {
  if (v >= 1e9) return `${num(v / 1e9, 2)}B`;
  if (v >= 1e6) return `${num(v / 1e6, 1)}M`;
  return num(v, 0);
}
