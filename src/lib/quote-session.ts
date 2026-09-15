/**
 * When a stored price is from, and whether that is recent enough to call it
 * current.
 *
 * `price_updated_at` used to record when the refresh ran rather than when the
 * price was from. So when every provider that could supply a current price
 * failed and the chain fell back to an old close, that close was saved with
 * tonight's time — and the dashboard read "as of Sep 12" above prices that
 * were every one of them the closes of August 14.
 */

const DAY_MS = 86_400_000;

/**
 * The moment a quote's price is from.
 *
 * Twelve Data dates a daily quote with the day alone. Parsed as written that
 * is midnight UTC, which is the previous evening in New York, so a date-only
 * stamp is read as that day's US close instead. A stamp that cannot be read
 * falls back to now, and nothing is ever dated in the future.
 */
export function priceTime(asOf: string | null | undefined, now: Date = new Date()): Date {
  if (!asOf) return now;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(asOf);
  const at = Date.parse(dateOnly ? `${asOf}T20:00:00Z` : asOf);

  return Number.isFinite(at) ? new Date(Math.min(at, now.getTime())) : now;
}

/** The New York calendar date of a moment, as YYYY-MM-DD. */
function easternDate(at: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

/**
 * Weekdays that have begun in New York since the price's own trading day.
 *
 * Counted in weekdays rather than hours, because a Friday close read on
 * Monday is the newest price there is — twenty-four-hour arithmetic called
 * that three days stale every weekend.
 */
export function weekdaysSince(from: Date, now: Date = new Date()): number {
  const start = Date.parse(`${easternDate(from)}T00:00:00Z`);
  const end = Date.parse(`${easternDate(now)}T00:00:00Z`);

  let count = 0;
  for (let t = start + DAY_MS; t <= end; t += DAY_MS) {
    const weekday = new Date(t).getUTCDay();
    if (weekday !== 0 && weekday !== 6) count++;
  }
  return count;
}

/**
 * How many trading days a price may fall behind before it is no longer current.
 *
 * Two: the day after a close is normal, and one missed nightly refresh is a
 * blip. A third is a refresh that has stopped working.
 */
export const STALE_AFTER_WEEKDAYS = 2;

/** Whether a stored price is too old to present as the current one. */
export function isPriceStale(
  asOf: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (asOf == null) return false;
  const at = asOf instanceof Date ? asOf : new Date(asOf);
  if (!Number.isFinite(at.getTime())) return false;
  return weekdaysSince(at, now) > STALE_AFTER_WEEKDAYS;
}
