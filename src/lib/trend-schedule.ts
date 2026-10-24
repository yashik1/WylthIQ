/**
 * When the screener's price trends are next worked out.
 *
 * They are calculated by `npm run quotes`, which the Railway quote-refresh
 * service runs on the cron `30 21 * * 1-5`: 21:30 UTC each weekday, an hour
 * or so after the US close (5:30pm New York in summer, 4:30pm in winter).
 * This mirrors that schedule so the screener can say when trends that have
 * never been calculated will arrive. Change the two together.
 */

const RUN_HOUR_UTC = 21;
const RUN_MINUTE_UTC = 30;

/** The next scheduled trend calculation strictly after `now`. */
export function nextTrendRefresh(now: Date): Date {
  const next = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), RUN_HOUR_UTC, RUN_MINUTE_UTC),
  );
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
  // Saturday is 6 and Sunday 0; the run is weekdays only.
  while (next.getUTCDay() === 0 || next.getUTCDay() === 6) next.setUTCDate(next.getUTCDate() + 1);
  return next;
}
