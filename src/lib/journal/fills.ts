/**
 * The fills inside one journal trade, and when each happened.
 *
 * A trade row is a whole position, entry to exit, but a chart of it needs the
 * fills themselves: bought 10, bought 5, sold 15 are three arrows, not one.
 * They are stored on the trade as a list, written by the broker sync (which
 * owns them, as it owns the prices) or by the manual form.
 *
 * TIMES. Brokers report a fill's time with no zone attached, and they do not
 * agree on which zone they mean:
 *
 * - Interactive Brokers reports execution times in US Eastern time, as its
 *   statements say.
 * - SnapTrade reports an instant in UTC (`2025-02-10T14:35:12Z`), and the
 *   execution row keeps the clock part of it.
 *
 * Each is turned into a true UTC instant here, so a chart in any reader's zone
 * puts the arrow on the right candle. A time of exactly midnight is what both
 * sources write when they only know the day, so it is read as "time unknown"
 * rather than as a fill at 00:00.
 */

/** One fill, or the part of one, that belongs to a trade. */
export interface TradeFill {
  /** The trading day, ISO. Always known. */
  date: string;
  /** The UTC instant, ISO; null when only the day is known. */
  at: string | null;
  side: "buy" | "sell";
  /** Always positive. */
  shares: number;
  price: number;
}

/** Where a broker's fill times are measured from, by link family. */
const ZONE_BY_FAMILY: Record<string, string> = {
  "ibkr-flex": "America/New_York",
  snaptrade: "UTC",
};

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})$/;

/**
 * Milliseconds to add to a UTC instant to get the wall-clock time in `zone`.
 * Positive east of Greenwich.
 */
function zoneOffset(utcMs: number, zone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const wall = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return wall - utcMs;
}

/**
 * A wall-clock date and time in a named zone, as a UTC instant.
 *
 * Guess the instant as if the zone were UTC, then correct by the zone's offset
 * at that instant. A second pass settles the hour either side of a clock
 * change, where the first guess can land on the other offset.
 */
export function zonedToUtc(date: string, time: string, zone: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const clock = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(time);
  if (!match || !clock) return null;
  const wall = Date.UTC(+match[1], +match[2] - 1, +match[3], +clock[1], +clock[2], +(clock[3] ?? 0));
  if (Number.isNaN(wall)) return null;
  try {
    let utc = wall - zoneOffset(wall, zone);
    utc = wall - zoneOffset(utc, zone);
    return new Date(utc).toISOString();
  } catch {
    // An unknown zone name: Intl throws a RangeError.
    return null;
  }
}

/** Whether `zone` is a time zone this runtime knows. */
export function isTimeZone(zone: unknown): zone is string {
  if (typeof zone !== "string" || zone.length === 0 || zone.length > 64) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A broker execution's stored `YYYY-MM-DDTHH:MM:SS` as a UTC instant, or
 * null when the broker gave only the day.
 */
export function fillInstant(executedAt: string, family: string): string | null {
  const match = DATE_TIME.exec(executedAt);
  if (!match) return null;
  const [, date, hh, mm, ss] = match;
  if (hh === "00" && mm === "00" && ss === "00") return null;
  return zonedToUtc(date, `${hh}:${mm}:${ss}`, ZONE_BY_FAMILY[family] ?? "America/New_York");
}

function rounded(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}

/** The stored form of a fill list, for deciding whether a trade's fills changed. */
export function fillsKey(fills: readonly TradeFill[] | null | undefined): string {
  if (!fills || fills.length === 0) return "";
  return fills.map((f) => `${f.date}|${f.at ?? ""}|${f.side}|${rounded(f.shares)}|${rounded(f.price)}`).join(";");
}

/** A stored value read back as fills, dropping anything malformed. */
export function readFills(value: unknown): TradeFill[] {
  if (!Array.isArray(value)) return [];
  const out: TradeFill[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const f = item as Record<string, unknown>;
    if (typeof f.date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(f.date)) continue;
    if (f.side !== "buy" && f.side !== "sell") continue;
    if (typeof f.shares !== "number" || !(f.shares > 0) || typeof f.price !== "number" || !(f.price > 0)) continue;
    const at = typeof f.at === "string" && !Number.isNaN(Date.parse(f.at)) ? f.at : null;
    out.push({ date: f.date, at, side: f.side, shares: f.shares, price: f.price });
  }
  return out;
}

/**
 * The two fills of a trade entered by hand: in at the entry, out at the exit.
 *
 * `zone` is the reader's own, sent by the form, because a time typed into a
 * form means the reader's clock.
 */
export function manualFills(input: {
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  exitPrice: number | null;
  openedAt: string;
  closedAt: string | null;
  openedTime: string | null;
  closedTime: string | null;
  zone: string | null;
}): TradeFill[] {
  const zone = input.zone && isTimeZone(input.zone) ? input.zone : null;
  const at = (date: string, time: string | null) => (time && zone ? zonedToUtc(date, time, zone) : null);
  const opening: TradeFill = {
    date: input.openedAt,
    at: at(input.openedAt, input.openedTime),
    side: input.side === "long" ? "buy" : "sell",
    shares: input.quantity,
    price: input.entryPrice,
  };
  if (input.exitPrice == null || !input.closedAt) return [opening];
  return [
    opening,
    {
      date: input.closedAt,
      at: at(input.closedAt, input.closedTime),
      side: input.side === "long" ? "sell" : "buy",
      shares: input.quantity,
      price: input.exitPrice,
    },
  ];
}
