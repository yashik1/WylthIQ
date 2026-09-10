/**
 * What a fund paid out, read from its dividend history.
 *
 * A company's distributions can be read out of its own accounts. A fund files
 * no accounts, so the only public record of what it paid is the sequence of
 * dividends themselves — which is enough, because every figure a reader wants
 * here is a property of that sequence: what it paid over the last year, when
 * it last went ex-dividend, and how often it pays.
 *
 * Everything is derived rather than taken on trust from a provider's summary
 * field, which is the point. A "yield" from a data vendor is a number with no
 * stated basis — trailing or forward, one currency or another, before or after
 * withholding — and a reader comparing two funds cannot know whether the two
 * were computed the same way. These are computed one way, and the page says
 * which.
 */

export interface Distribution {
  /** Ex-dividend date, as a calendar date. */
  date: string;
  amount: number;
}

export interface IncomeSummary {
  /** Total paid per share over the last 12 months. */
  trailingTwelveMonths: number | null;
  /** Trailing yield against the current price, as a fraction. */
  yield: number | null;
  /** The most recent ex-dividend date. */
  lastExDate: string | null;
  /** How often it pays, when the history is long enough to tell. */
  frequency: PayoutFrequency | null;
  /** How many payments the trailing figure is built from. */
  paymentsCounted: number;
}

export type PayoutFrequency = "Monthly" | "Quarterly" | "Twice a year" | "Annually";

/**
 * Payments per year to a name.
 *
 * Banded rather than matched exactly, because a fund that pays quarterly can
 * report three or five ex-dates in a rolling year depending on where the
 * window falls relative to its schedule. Reading "5 payments" as anything
 * other than quarterly would be wrong about a fund that did nothing unusual.
 */
function nameFrequency(perYear: number): PayoutFrequency | null {
  if (perYear >= 10) return "Monthly";
  if (perYear >= 3) return "Quarterly";
  if (perYear >= 1.5) return "Twice a year";
  if (perYear >= 0.5) return "Annually";
  return null;
}

/**
 * Summarises a dividend history.
 *
 * `asOf` is injectable so the trailing window is testable — a test that
 * depends on today's date passes until it doesn't.
 */
export function summariseIncome(
  distributions: Distribution[],
  price: number | null,
  asOf: Date = new Date(),
): IncomeSummary {
  const empty: IncomeSummary = {
    trailingTwelveMonths: null,
    yield: null,
    lastExDate: null,
    frequency: null,
    paymentsCounted: 0,
  };
  if (distributions.length === 0) return empty;

  const sorted = [...distributions].sort((a, b) => a.date.localeCompare(b.date));
  const cutoff = new Date(asOf);
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 1);
  const since = cutoff.toISOString().slice(0, 10);

  const recent = sorted.filter((d) => d.date > since);
  const total = recent.reduce((sum, d) => sum + d.amount, 0);

  /*
    Frequency is read from the whole history, not from the trailing year.

    Two years of dates say "quarterly, uninterrupted"; the four in a trailing
    window say the same thing with a quarter of the evidence, and say nothing
    at all for a fund that has just changed schedule or missed one.
  */
  const span = daysBetween(sorted[0].date, sorted[sorted.length - 1].date);
  const perYear = span > 0 ? ((sorted.length - 1) * 365) / span : sorted.length;

  return {
    // A fund that paid nothing in the last year has a trailing figure of zero,
    // which is a fact about it. Null is reserved for not knowing.
    trailingTwelveMonths: total,
    yield: price && price > 0 ? total / price : null,
    lastExDate: sorted[sorted.length - 1].date,
    frequency: sorted.length >= 2 ? nameFrequency(perYear) : null,
    paymentsCounted: recent.length,
  };
}

function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Whether two answers describe the same listing.
 *
 * A bare ticker can be a real security in more than one country, and the
 * quote and the payment history are resolved independently — so "QQC" can
 * return a US fund's price and a Canadian fund's dividends, which the page
 * then prints side by side as though they were one thing, both in "$".
 *
 * Currency is the check because it is the one fact both sides carry. Unknown
 * on either side is treated as agreement rather than as conflict: refusing to
 * show a figure because nobody stated a currency would drop the many ordinary
 * cases to catch the rare bad one.
 */
export function isSameListing(
  quoteCurrency: string | null | undefined,
  dataCurrency: string | null | undefined,
): boolean {
  if (!quoteCurrency || !dataCurrency) return true;
  return quoteCurrency.toUpperCase() === dataCurrency.toUpperCase();
}

/**
 * What a fee costs in money, on a round sum.
 *
 * The single most useful thing this app can do with an expense ratio. "0.03%"
 * and "0.75%" look like the same kind of small number and are a factor of
 * twenty-five apart; "$3 a year" and "$75 a year" do not, and are the same
 * fact. Nobody holds a percentage.
 *
 * Deliberately the simple product rather than a compounded projection. The
 * honest version of "what this costs over ten years" depends on a return
 * assumption, and a page that has never forecast anything should not start
 * here — the yearly figure is exact and needs no assumption at all.
 */
export function feeOn(expenseRatio: number | null, amount: number): number | null {
  if (expenseRatio == null || !Number.isFinite(expenseRatio) || expenseRatio < 0) return null;
  return expenseRatio * amount;
}
