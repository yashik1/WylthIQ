import { and, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { priceCache } from "../db/schema";
import type { Bar, Timeframe } from "./types";

/**
 * Chart history kept in Postgres, so a chart already fetched costs no request.
 *
 * Every free price plan counts requests — Twelve Data 8 a minute, Tiingo 50 an
 * hour — and the in-process cache in failover.ts forgets everything on each
 * deploy and is not shared between instances. A reader clicking through ten
 * charts spent ten requests, and the next reader asking for the same ten spent
 * ten more. The `price_cache` table was created for this in the first
 * migration and never used.
 *
 * Only hourly, daily and weekly bars are stored. Minute bars go stale in
 * minutes, which the in-process cache already handles. Freshness follows the
 * US market rather than a flat timer: while it is open, stored bars are reused
 * for a short while; once it has closed and the day's bars have settled, they
 * stay good until the next session opens — so evenings and weekends serve every
 * chart that has been drawn once from the database.
 */

export interface CachedBars {
  bars: Bar[];
  /** Which provider supplied them, carried so a cached chart names its source too. */
  source: string | null;
  includesDividends: boolean;
}

/** How long stored bars are reused while the US market is open. */
const OPEN_MARKET_TTL_MS: Partial<Record<Timeframe, number>> = {
  "1Hour": 15 * 60_000,
  "1Day": 60 * 60_000,
  "1Week": 60 * 60_000,
};

/** How much later than asked a stored window may start and still count as covering it. */
const START_SLACK_MS: Partial<Record<Timeframe, number>> = {
  "1Hour": 3 * 60 * 60_000,
  "1Day": 3 * 86_400_000,
  "1Week": 7 * 86_400_000,
};

/** How long a read may take before the chart goes to the providers instead. */
const READ_DEADLINE_MS = 1500;

/** Minutes after midnight, New York: the session opens at 9:30. */
const OPEN_MINUTES = 9 * 60 + 30;

/**
 * Minutes after midnight, New York, by which the day's bars have settled.
 *
 * The bell is at 16:00; providers finish writing the closing bar a little
 * after. A fetch before this is treated as mid-session.
 */
const SETTLED_MINUTES = 16 * 60 + 30;

/** A timeframe this cache stores at all. */
export function isStoredTimeframe(timeframe: Timeframe): boolean {
  return timeframe in OPEN_MARKET_TTL_MS;
}

/** The New York weekday (0 Sunday … 6 Saturday), minutes after midnight, and date. */
export function newYorkParts(at: Date): { weekday: number; minutes: number; ymd: string } {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "short",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return {
    weekday,
    minutes: Number(parts.hour) * 60 + Number(parts.minute),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** The UTC instant of a New York wall-clock time on a given date. */
function newYorkTimeToUtc(ymd: string, minutes: number): Date {
  const [year, month, day] = ymd.split("-").map(Number);
  // New York is four hours behind UTC in summer and five in winter.
  for (const offsetHours of [4, 5]) {
    const guess = new Date(Date.UTC(year, month - 1, day, 0, minutes + offsetHours * 60));
    const back = newYorkParts(guess);
    if (back.ymd === ymd && back.minutes === minutes) return guess;
  }
  return new Date(Date.UTC(year, month - 1, day, 0, minutes + 5 * 60));
}

function isWeekday(weekday: number): boolean {
  return weekday >= 1 && weekday <= 5;
}

/** Whether the US market is between its open and the moment the day's bars settle. */
export function isUsMarketOpen(now: Date): boolean {
  const { weekday, minutes } = newYorkParts(now);
  return isWeekday(weekday) && minutes >= OPEN_MINUTES && minutes < SETTLED_MINUTES;
}

/**
 * The most recent moment a weekday's bars settled, at or before `now`.
 *
 * Holidays are not known here, so a holiday counts as a session. The cost is
 * one extra refetch the evening after it, never a stale chart.
 */
export function lastSettledClose(now: Date): Date {
  for (let daysBack = 0; daysBack <= 7; daysBack++) {
    const day = newYorkParts(new Date(now.getTime() - daysBack * 86_400_000));
    if (!isWeekday(day.weekday)) continue;
    const settled = newYorkTimeToUtc(day.ymd, SETTLED_MINUTES);
    if (settled.getTime() <= now.getTime()) return settled;
  }
  return new Date(now.getTime() - 7 * 86_400_000);
}

/** Whether bars fetched at `fetchedAt` are still current at `now`. */
export function isCacheFresh(timeframe: Timeframe, fetchedAt: Date, now: Date): boolean {
  const ttl = OPEN_MARKET_TTL_MS[timeframe];
  if (ttl == null) return false;
  if (fetchedAt.getTime() > now.getTime()) return false;
  if (isUsMarketOpen(now)) return now.getTime() - fetchedAt.getTime() < ttl;
  return fetchedAt.getTime() >= lastSettledClose(now).getTime();
}

/** Whether a stored row can answer a request for bars from `from` onward. */
export function servesWindow(
  row: { fromDate: Date; fetchedAt: Date },
  timeframe: Timeframe,
  from: Date,
  now: Date,
): boolean {
  const slack = START_SLACK_MS[timeframe];
  if (slack == null) return false;
  return (
    isCacheFresh(timeframe, row.fetchedAt, now) &&
    row.fromDate.getTime() <= from.getTime() + slack
  );
}

/** The bars that fall inside a window, both ends included. */
export function sliceBars(bars: Bar[], from: Date, to: Date): Bar[] {
  const start = from.getTime() / 1000;
  const end = to.getTime() / 1000;
  return bars.filter((b) => b.time >= start && b.time <= end);
}

/** A stored value, checked before it is trusted — the column is plain JSON. */
export function parseCachedBars(value: unknown): CachedBars | null {
  if (!value || typeof value !== "object") return null;
  const v = value as { bars?: unknown; source?: unknown; includesDividends?: unknown };
  if (!Array.isArray(v.bars)) return null;

  const bars = v.bars.filter(
    (b): b is Bar =>
      Boolean(b) &&
      typeof b === "object" &&
      Number.isFinite((b as Bar).time) &&
      Number.isFinite((b as Bar).close),
  );
  if (bars.length !== v.bars.length) return null;

  return {
    bars,
    source: typeof v.source === "string" ? v.source : null,
    includesDividends: v.includesDividends === true,
  };
}

function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("bar cache read timed out")), ms);
  });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/**
 * Stored bars for a request, or null to go to the providers.
 *
 * Every failure — no database, a slow one, a malformed row — is a miss. A cache
 * that cannot be read is only a slower chart, never a broken one.
 */
export async function readBarCache(
  symbol: string,
  timeframe: Timeframe,
  from: Date,
  to: Date,
  now: Date = new Date(),
): Promise<CachedBars | null> {
  if (!isDatabaseConfigured() || !isStoredTimeframe(timeframe)) return null;

  try {
    const rows = await withDeadline(
      getDb()
        .select()
        .from(priceCache)
        .where(and(eq(priceCache.symbol, symbol.toUpperCase()), eq(priceCache.timeframe, timeframe)))
        .limit(1),
      READ_DEADLINE_MS,
    );
    const row = rows[0];
    if (!row) return null;

    const stored = { fromDate: new Date(row.fromDate), fetchedAt: new Date(row.fetchedAt) };
    if (!servesWindow(stored, timeframe, from, now)) return null;

    const parsed = parseCachedBars(row.bars);
    if (!parsed) return null;

    const bars = sliceBars(parsed.bars, from, to);
    return bars.length > 0 ? { ...parsed, bars } : null;
  } catch {
    return null;
  }
}

/**
 * Stores what the providers returned, replacing any older row for the symbol.
 *
 * Called only after a miss — the stored row was absent, stale, or started too
 * late — so the new answer is always the better one to keep.
 */
export async function writeBarCache(
  symbol: string,
  timeframe: Timeframe,
  from: Date,
  to: Date,
  answer: CachedBars,
): Promise<void> {
  if (!isDatabaseConfigured() || !isStoredTimeframe(timeframe) || answer.bars.length === 0) return;

  const value = {
    bars: answer.bars,
    source: answer.source,
    includesDividends: answer.includesDividends,
  };
  const fetchedAt = new Date();

  try {
    await getDb()
      .insert(priceCache)
      .values({ symbol: symbol.toUpperCase(), timeframe, bars: value, fromDate: from, toDate: to, fetchedAt })
      .onConflictDoUpdate({
        target: [priceCache.symbol, priceCache.timeframe],
        set: { bars: value, fromDate: from, toDate: to, fetchedAt },
      });
  } catch {
    // Not stored this time; the next view simply fetches again.
  }
}
