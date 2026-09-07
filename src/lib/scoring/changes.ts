import { fieldValue } from "../fundamentals/normalize";
import type { CanonicalField, NormalizedFundamentals } from "../fundamentals/types";
import { money, num, signedPercent } from "../format";
import { div, round, sub } from "./math";

/**
 * What moved between the last two annual filings.
 *
 * The rest of this app describes where a company stands. This describes what
 * changed to get it there, which is a different and often more useful question:
 * a 12% margin means little on its own, and a 12% margin that was 19% last year
 * means a great deal.
 *
 * Annual against annual, because that is what the pipeline holds — `financials`
 * is keyed on `(companyId, fiscalYear)` and stores one row per year, so there
 * are no quarterly periods here to compare. Nothing about narrative disclosure
 * either: this reads XBRL facts, and the management discussion lives in the
 * filing's prose, which the ingest never fetches.
 *
 * Three rules keep this honest.
 *
 * Only material moves are reported. Every figure changes by something every
 * year, and a list that says so is noise a reader has to filter for themselves;
 * the thresholds below are the filter, and what falls under them is counted
 * rather than listed, so "nothing much moved" stays a visible answer.
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
  /** The prior year's figure, formatted. */
  from: string;
  /** The latest figure, formatted. */
  to: string;
  /**
   * The move itself — "+12.4%", "+1.8 pts", "$3.10B more". Never a percentage
   * computed across zero.
   */
  delta: string;
  direction: ChangeDirection;
  /** Whether this move matters, and what would make it not matter. */
  meaning: string;
}

export interface ChangeReport {
  /** The earlier of the two periods compared. */
  fromYear: number;
  /** The later of the two. */
  toYear: number;
  /** The filing form the latest figures came from, e.g. `10-K`. */
  form: string | null;
  changes: Change[];
  /** How many measures were compared and found to have barely moved. */
  steady: number;
  sourceFilingUrl: string | null;
}

/*
  What counts as worth mentioning.

  A percentage-point band for margins and a relative band for amounts, because
  they do not mean the same thing: a margin moving two points is a large event
  and revenue moving two per cent is a rounding difference. The share count
  band is the tightest — a company quietly issuing three per cent more stock
  has taken three per cent of everything from the holders it already had, and
  nobody announces that.
*/
const MATERIAL_RELATIVE = 0.05;
const MATERIAL_MARGIN_POINTS = 0.01;
const MATERIAL_SHARE_CHANGE = 0.01;

/**
 * Builds the comparison, or null when there is nothing to compare against.
 *
 * A first-year filer and a company whose prior year never made it into the
 * database are the same case here: one period is not a comparison, and an
 * empty panel claiming "no significant changes" would be a statement about the
 * company rather than about the data.
 */
export function buildChangeReport(
  fundamentals: NormalizedFundamentals,
  currency = "USD",
): ChangeReport | null {
  const latest = fundamentals.annual[0];
  const prior = fundamentals.annual[1];
  if (!latest || !prior) return null;

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
      from: freeCashFlow(p("operatingCashFlow"), p("capex")),
      to: freeCashFlow(f("operatingCashFlow"), f("capex")),
      format: amount,
      rising: "better",
      meaning:
        "Cash left after paying for the plant that produced it — the money genuinely available " +
        "for dividends, buybacks or paying down debt. Harder to flatter than profit.",
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

  return {
    fromYear: prior.fiscalYear,
    toYear: latest.fiscalYear,
    form: latest.form ?? null,
    changes,
    steady,
    sourceFilingUrl: latest.facts.assets?.sourceFilingUrl ?? null,
  };
}

/** Operating cash flow after capital spending, with capex taken as an outflow. */
function freeCashFlow(ocf: number | null, capex: number | null): number | null {
  // A minority of filers tag capex negative; the magnitude is what matters.
  return sub(ocf, absOrNull(capex));
}

function absOrNull(v: number | null): number | null {
  return v == null ? null : Math.abs(v);
}

/**
 * A change in an amount of money.
 *
 * Returns `"steady"` when the move is under the materiality band, and `null`
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
      meaning,
    };
  }

  const relative = div(absolute, Math.abs(from));
  if (relative == null) return null;
  if (Math.abs(relative) < MATERIAL_RELATIVE) return "steady";

  return {
    key,
    label,
    from: format(from),
    to: format(to),
    delta: signedPercent(relative, 1),
    direction,
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
  if (Math.abs(points) < MATERIAL_MARGIN_POINTS) return "steady";

  return {
    key,
    label,
    from: `${num(from * 100, 1)}%`,
    to: `${num(to * 100, 1)}%`,
    delta: `${points > 0 ? "+" : "−"}${num(Math.abs(points) * 100, 1)} pts`,
    direction: points > 0 ? "better" : "worse",
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
  if (Math.abs(relative) < MATERIAL_SHARE_CHANGE) return "steady";

  const issued = relative > 0;
  return {
    key: "sharesOutstanding",
    label: "Shares in issue",
    from: compactShares(from),
    to: compactShares(to),
    delta: signedPercent(relative, 1),
    direction: issued ? "worse" : "better",
    meaning: issued
      ? "New shares divide the same company into more pieces, so each existing holding owns " +
        "slightly less of it. Often pay for staff or an acquisition rather than anything wrong."
      : "The company bought back stock, so each remaining holding owns slightly more of it. " +
        "Worth checking it was not funded by borrowing.",
  };
}

/** Share counts run to billions; the money formatter would print a currency. */
function compactShares(v: number): string {
  if (v >= 1e9) return `${num(v / 1e9, 2)}B`;
  if (v >= 1e6) return `${num(v / 1e6, 1)}M`;
  return num(v, 0);
}
