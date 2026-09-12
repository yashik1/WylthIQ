import { getBarsWithSource } from "../providers";
import type { Bar } from "../providers/types";

/**
 * What a fund has returned over its whole life.
 *
 * The figure every fund factsheet leads with, and the one comparison that
 * does not depend on where a chart window happens to start: a reader looking
 * at three dividend ETFs wants to know how each has done since it existed,
 * not how each has done since last March.
 *
 * Two honesty rules are built in. The window is reported as the dates
 * actually priced rather than the launch date, because a provider's history
 * often starts years after a fund did, and a return labelled "since
 * inception" that quietly covers half the life is worse than no figure. And
 * whether distributions are in the closes is carried through, never assumed:
 * on a fund yielding 4% the difference over a decade is most of the answer.
 */

export interface SinceInception {
  /**
   * The launch date the fund's own manager states, where it is published.
   *
   * Null for most Canadian funds: Vanguard Canada's fund list does not carry
   * one, and a manager this app has no reader for carries nothing at all. The
   * figure is still worth having without it — it is then the history on
   * record rather than the life of the fund, and the card says which.
   */
  inceptionDate: string | null;
  /** The first date there is a price for, which is not always the launch. */
  from: string;
  /** The last date priced. */
  to: string;
  /** The change across that window, as a fraction: 2.12 is +212%. */
  totalReturn: number;
  /** That return compounded per year, or null under a year of history. */
  perYear: number | null;
  years: number;
  /** Whether the closes behind it already have distributions reinvested. */
  includesDividends: boolean | null;
  /** True when the priced window starts well after a known launch date. */
  partial: boolean;
}

const DAY = 86_400_000;
const YEAR_DAYS = 365.25;

/**
 * How late the first price may be before the gap is disclosed.
 *
 * A few days is the ordinary distance between a launch and the first close a
 * provider kept. A third of a year is a different fund's worth of history.
 */
const LATE_START_DAYS = 120;

/** How far back to look when no launch date is published. Older than any ETF. */
const FULL_HISTORY_YEARS = 30;

export function sinceInception(
  bars: Bar[],
  inceptionDate: string | null,
  includesDividends: boolean | null,
): SinceInception | null {
  const parsed = inceptionDate ? Date.parse(`${inceptionDate}T00:00:00Z`) : null;
  const launched = parsed != null && Number.isFinite(parsed) ? parsed : null;
  // A date that was given and could not be read is a fault, not an absence.
  if (inceptionDate && launched == null) return null;

  // A day's grace: a weekly series can put the first bar just before launch.
  const priced = bars.filter(
    (b) => b.close > 0 && (launched == null || b.time * 1000 >= launched - DAY),
  );
  const first = priced[0];
  const last = priced[priced.length - 1];
  if (!first || !last || first.time === last.time) return null;

  const years = ((last.time - first.time) * 1000) / (YEAR_DAYS * DAY);
  if (years <= 0) return null;

  const totalReturn = last.close / first.close - 1;

  return {
    inceptionDate: launched == null ? null : inceptionDate,
    from: isoDate(first.time),
    to: isoDate(last.time),
    totalReturn,
    /*
      Compounding a few months into a yearly rate states a pace the fund has
      never actually held for a year, and it reads as a forecast rather than a
      record. Under a year, the plain change is the whole of what is known.
    */
    perYear: years >= 1 ? (1 + totalReturn) ** (1 / years) - 1 : null,
    years,
    includesDividends,
    partial: launched != null && first.time * 1000 - launched > LATE_START_DAYS * DAY,
  };
}

/**
 * The same, for a listed fund, from the price history the charts already use.
 *
 * Without a launch date it reads the longest history the providers hold,
 * which for a fund usually begins within weeks of its listing. That is not
 * the same claim as "since inception" and the card does not make it — but it
 * is the same useful figure, and refusing to show one because a manager does
 * not publish a date would have left it off two of the three Canadian
 * dividend funds this was built for.
 */
export async function getSinceInception(
  symbol: string,
  inceptionDate: string | null,
): Promise<SinceInception | null> {
  const parsed = inceptionDate ? Date.parse(`${inceptionDate}T00:00:00Z`) : null;
  const launched = parsed != null && Number.isFinite(parsed) ? parsed : null;
  if (inceptionDate && launched == null) return null;

  try {
    // Weekly: a fund's whole life in daily bars is thousands of points to
    // read two of them.
    const { bars, includesDividends } = await getBarsWithSource(
      symbol,
      "1Week",
      new Date(launched ?? Date.now() - FULL_HISTORY_YEARS * 365 * DAY),
      new Date(),
    );
    return sinceInception(bars, inceptionDate, includesDividends);
  } catch {
    return null;
  }
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}
