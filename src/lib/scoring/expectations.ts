import { fieldValue } from "../fundamentals/normalize";
import type { NormalizedFundamentals } from "../fundamentals/types";
import type { SectorKind } from "./applicability";
import { freeCashFlow } from "./returns";

/**
 * What growth the current price is already assuming.
 *
 * Everything else in this app reads a filing and reports what a company did.
 * This reads the price and reports what somebody buying at it must believe.
 * The two together are the comparison that matters: a company can be growing
 * well and still be priced for growing far better.
 *
 * The method is Rappaport and Mauboussin's, from Expectations Investing. An
 * ordinary discounted cash flow picks a growth rate and produces a value; this
 * runs it backwards — the value is known, because it is the price, so solve for
 * the growth rate that makes the arithmetic balance. That inversion is the whole
 * idea, and it is why nothing here is a forecast: it makes no claim about what
 * the company will do, only about what the market has already paid for.
 *
 * Deliberately not a fourth score, and deliberately not a verdict. A high
 * implied growth rate is not a sell signal and a low one is not a bargain —
 * both are the market's price restated in units a reader can compare against a
 * track record. Saying which of the two is right would be a prediction, and
 * this app does not make those.
 *
 * Licensing-clean by construction: every input is already ingested from SEC
 * filings or already displayed on the page. Nothing new is fetched, so nothing
 * new is redistributed.
 */

/** Years modelled explicitly before the perpetuity takes over. */
const HORIZON_YEARS = 10;

/**
 * Growth assumed forever after the horizon, set at roughly long-run inflation.
 *
 * No company grows faster than the economy indefinitely, so anything above a
 * couple of percent here quietly does most of the work and hides it inside the
 * terminal value. Kept low, and stated in the UI, for that reason.
 */
const TERMINAL_GROWTH = 0.025;

/**
 * The discount rates the answer is solved at.
 *
 * Three rather than one, because the result is genuinely sensitive to this and
 * a single number would imply a precision the method does not have. A proper
 * cost of capital would need a beta and an equity risk premium, neither of
 * which this app holds and both of which are themselves estimates — so a
 * stated, ordinary range is a more honest instrument than a computed WACC
 * carrying invented inputs.
 */
const DISCOUNT_RATES = [0.08, 0.09, 0.1] as const;

/** The bracket the solver searches. Outside it, no answer is reported. */
const MIN_GROWTH = -0.2;
const MAX_GROWTH = 0.6;

/** Enough halvings to pin the rate far finer than it is ever displayed. */
const BISECTION_STEPS = 60;

/** Years of free cash flow needed before any of this is attempted. */
const MIN_HISTORY = 3;

/**
 * How far below its own recent norm the latest year's cash flow may fall
 * before the whole calculation is abandoned.
 *
 * The one genuine weakness of the method, and the reason this constant exists.
 * The base year is the denominator of everything downstream, so a company in a
 * heavy investment year — where capital spending has temporarily swallowed the
 * cash flow — produces an implied growth rate that is arithmetically correct
 * and completely misleading. Amazon in FY2025 is the worked example: record
 * datacentre spending left $7.7bn of free cash flow against an enterprise
 * value of $2.7tn, and the model duly reported that the price assumes 46% a
 * year. True, and not a fact about the price at all — a fact about one year of
 * capex.
 *
 * A reader able to spot that does not need this panel. The reader this app is
 * written for would take 46% as a verdict. So a base that far below the
 * company's own recent record is treated as unrepresentative and nothing is
 * shown, on exactly the reasoning that stops projectNextEvents guessing at
 * Coca-Cola's next dividend.
 *
 * The threshold is set where the distortion starts to outweigh the panel's own
 * stated uncertainty. Across DISCOUNT_RATES the answer moves by roughly four
 * points, and that band is presented to the reader as the margin of error; a
 * base around two-thirds of normal shifts the answer by more than that, so the
 * band would be understating the uncertainty rather than describing it. Below
 * this line the honest output is silence. Coca-Cola's FY2025 sits at 55% of
 * its own recent norm and is refused for exactly that reason.
 *
 * Deliberately one-sided. A base far *above* the recent norm depresses the
 * implied rate, but for a genuinely fast-growing company that is the signal
 * rather than the distortion, and suppressing it would discard the real cases
 * along with the flukes.
 */
const MIN_BASE_SHARE_OF_NORM = 0.7;

/** Prior years compared against, when judging whether the base is typical. */
const NORM_WINDOW = 4;

export interface ImpliedExpectations {
  /** Implied annual free-cash-flow growth at the middle discount rate. */
  impliedGrowth: number;
  /** The same figure at the lowest and highest discount rates tried. */
  growthLow: number;
  growthHigh: number;
  /** The assumptions, carried so the UI can state them rather than bury them. */
  discountLow: number;
  discountHigh: number;
  terminalGrowth: number;
  horizonYears: number;
  /** The cash flow the whole calculation rests on, and the year it was filed for. */
  baseFreeCashFlow: number;
  fiscalYear: number;
  /** Enterprise value: what the market pays for the business, debt included. */
  enterpriseValue: number;
  /**
   * What free cash flow actually did, annualised, over `actualYears`.
   *
   * Null when the earliest year in the window was negative — a growth rate from
   * a negative base is arithmetically defined and completely meaningless, and
   * this is the single comparison a reader will lean on hardest.
   */
  actualGrowth: number | null;
  actualYears: number;
}

/**
 * Present value of a cash flow growing at `growth`, then at TERMINAL_GROWTH forever.
 *
 * Strictly increasing in `growth`, which is what lets the solver below bisect
 * rather than iterate towards a root it might overshoot.
 */
function presentValue(base: number, growth: number, discount: number): number {
  let flow = base;
  let value = 0;

  for (let year = 1; year <= HORIZON_YEARS; year++) {
    flow *= 1 + growth;
    value += flow / (1 + discount) ** year;
  }

  // The perpetuity. Safe only because every rate in DISCOUNT_RATES is above
  // TERMINAL_GROWTH; a terminal rate at or above the discount rate would make
  // the denominator zero or negative and value the company at infinity.
  const terminal = (flow * (1 + TERMINAL_GROWTH)) / (discount - TERMINAL_GROWTH);
  return value + terminal / (1 + discount) ** HORIZON_YEARS;
}

/**
 * The growth rate at which the model's value equals what the market is paying,
 * or null when that rate lies outside the bracket.
 *
 * Returning null at the edges is deliberate. A price implying growth beyond
 * these bounds is usually a sign the model does not fit the company — a
 * turnaround, a peak-cycle year, a business whose cash flow says little about
 * what it is worth — and reporting "at least 60%" would dress that mismatch up
 * as a finding.
 */
function solveGrowth(base: number, target: number, discount: number): number | null {
  if (presentValue(base, MIN_GROWTH, discount) > target) return null;
  if (presentValue(base, MAX_GROWTH, discount) < target) return null;

  let low = MIN_GROWTH;
  let high = MAX_GROWTH;

  for (let step = 0; step < BISECTION_STEPS; step++) {
    const mid = (low + high) / 2;
    if (presentValue(base, mid, discount) < target) low = mid;
    else high = mid;
  }

  return (low + high) / 2;
}

/**
 * Free cash flow per fiscal year, newest first, skipping any year that did not
 * report both halves of it.
 */
function freeCashFlowSeries(
  fundamentals: NormalizedFundamentals,
): { fiscalYear: number; value: number }[] {
  return fundamentals.annual
    .map((period) => {
      const value = freeCashFlow(period);
      return value == null ? null : { fiscalYear: period.fiscalYear, value };
    })
    .filter((entry): entry is { fiscalYear: number; value: number } => entry !== null);
}

/** Middle value of a list, averaging the two middle ones when it is even. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Whether the latest year's cash flow is typical enough of the company to
 * build on.
 *
 * A median rather than a mean, so a single year of heavy investment — or a
 * single windfall — sets the comparison rather than skewing it.
 *
 * Only the prior years that actually generated cash count towards the norm.
 * The question being asked is what this company produces in an ordinary year,
 * and a year it consumed cash is not an answer to it. Including the loss years
 * is what let Amazon through on the first attempt: two negative years either
 * side of the median pulled the norm down to $8.5bn, which a base of $7.7bn
 * duly cleared, and the panel went on reporting 46%. Against the years it did
 * generate cash the norm is $35bn, and the base is plainly not one of them.
 *
 * A company with no positive prior years has no norm to be unrepresentative
 * of, and the check passes: its cash flow is volatile, which the discount band
 * and the historical figure beside it already say.
 */
function baseIsRepresentative(series: { value: number }[]): boolean {
  const prior = series
    .slice(1, 1 + NORM_WINDOW)
    .map((entry) => entry.value)
    .filter((value) => value > 0);

  const norm = median(prior);
  if (norm == null) return true;

  return series[0].value >= norm * MIN_BASE_SHARE_OF_NORM;
}

/**
 * Annualised growth over the longest window that starts from a positive year.
 *
 * Walks outward from the most recent year rather than fixing a window length,
 * because a company that turned cash-flow positive four years ago has a real
 * four-year record and no ten-year one. Fixing the window would either discard
 * that record or compute it from a negative base.
 */
function historicalGrowth(
  series: { fiscalYear: number; value: number }[],
): { growth: number; years: number } | null {
  const latest = series[0];
  if (!latest || latest.value <= 0) return null;

  let best: { growth: number; years: number } | null = null;

  for (let i = MIN_HISTORY - 1; i < Math.min(series.length, HORIZON_YEARS + 1); i++) {
    const earliest = series[i];
    if (!earliest || earliest.value <= 0) continue;

    const years = latest.fiscalYear - earliest.fiscalYear;
    if (years <= 0) continue;

    best = { growth: (latest.value / earliest.value) ** (1 / years) - 1, years };
  }

  return best;
}

/**
 * What the price implies, or null when it cannot honestly be said.
 *
 * Every refusal below is a case where a number could be produced and would
 * mislead. That is the same bar `projectNextEvents` holds to when it declines
 * to project a dividend whose timing has never been regular.
 */
export function buildImpliedExpectations(
  fundamentals: NormalizedFundamentals,
  sector: SectorKind,
  marketCap: number | null,
): ImpliedExpectations | null {
  /*
    Banks and insurers are excluded, for the same reason Altman's Z-Score is
    suppressed for them. Enterprise value subtracts cash and adds debt on the
    premise that both are incidental to the operating business. For a lender
    they *are* the operating business, so the figure it produces is not a
    smaller or larger version of the right answer — it answers a different
    question entirely.
  */
  if (sector === "financial") return null;
  if (marketCap == null || !Number.isFinite(marketCap) || marketCap <= 0) return null;

  const series = freeCashFlowSeries(fundamentals);
  if (series.length < MIN_HISTORY) return null;

  const latest = series[0];
  /*
    A company burning cash has no growth rate that makes the price work: every
    rate applied to a negative base produces a more negative number, so the
    solver has no root to find and the concept has no meaning. The honest
    output is nothing at all.

    The baseline is the latest year rather than an average of several. An
    average would smooth a lumpy capex year, but it would also correspond to no
    filing a reader could open and check — and traceability is the promise the
    rest of this app is built on. The fiscal year is carried out to the UI so
    the figure can be looked up.
  */
  if (latest.value <= 0) return null;

  // A year of unusually heavy capital spending makes the base unrepresentative
  // and the answer misleading. See MIN_BASE_SHARE_OF_NORM.
  if (!baseIsRepresentative(series)) return null;

  const period = fundamentals.annual.find((p) => p.fiscalYear === latest.fiscalYear);
  const longTerm = fieldValue(period, "longTermDebt");
  const shortTerm = fieldValue(period, "shortTermDebt");
  const cash = fieldValue(period, "cash");

  /*
    Net debt, on the same basis as the debt question on the stock page. Note
    that `cash` maps to cash and equivalents only, not to the short-term
    investments where a cash-rich company parks most of its liquidity — the
    same gap that made a net-cash-per-share figure wrong enough to remove from
    key-figures.ts. So a cash-rich company's net debt reads a little high here,
    and its implied growth a little high with it. That overstates what the
    price is demanding rather than understating it, which is the safer
    direction for a number a reader might lean on.
  */
  const netDebt = (longTerm ?? 0) + (shortTerm ?? 0) - (cash ?? 0);
  const enterpriseValue = marketCap + netDebt;
  if (!Number.isFinite(enterpriseValue) || enterpriseValue <= 0) return null;

  const solved = DISCOUNT_RATES.map((rate) => solveGrowth(latest.value, enterpriseValue, rate));
  // Partial answers are not reported. A band whose ends were solved at
  // different rates than the ones named beside it would be a caption that does
  // not describe its own number.
  if (solved.some((growth) => growth == null)) return null;

  const rates = solved as number[];
  const actual = historicalGrowth(series);

  return {
    // A higher discount rate demands more growth to justify the same price, so
    // the band runs the same way round as DISCOUNT_RATES.
    impliedGrowth: rates[1],
    growthLow: rates[0],
    growthHigh: rates[2],
    discountLow: DISCOUNT_RATES[0],
    discountHigh: DISCOUNT_RATES[2],
    terminalGrowth: TERMINAL_GROWTH,
    horizonYears: HORIZON_YEARS,
    baseFreeCashFlow: latest.value,
    fiscalYear: latest.fiscalYear,
    enterpriseValue,
    actualGrowth: actual?.growth ?? null,
    actualYears: actual?.years ?? 0,
  };
}
