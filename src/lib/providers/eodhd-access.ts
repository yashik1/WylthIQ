/**
 * What EODHD has refused, and when it is worth asking again.
 *
 * Every EODHD call used to treat a refusal as "no data" for that one request
 * and ask again on the next page view. For a refusal about the symbol — 404,
 * 422 — that is right. For the others it is a round trip to be told the same
 * thing:
 *
 *   401  the key is wrong. Nothing will work until it is changed.
 *   402  the plan's daily request limit is used up, until midnight UTC.
 *   403  the plan does not include this endpoint. The live site's key is
 *        refused /fundamentals, which every company page asked for.
 *   429  too many requests this minute.
 *
 * So those close the door for as long as the answer cannot change: a 402 for
 * the rest of the day, a 403 for that endpoint only, for twelve hours, so an
 * upgraded plan is picked up the same day without a redeploy. A page then
 * goes straight to the next source instead of waiting on a refusal.
 */

export type EodhdEndpoint = "/eod" | "/intraday" | "/real-time" | "/fundamentals" | "/news" | "/search";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** How long a plan's refusal of one endpoint is believed. */
export const PLAN_REFUSAL_MS = 12 * HOUR;

export interface Closure {
  /** Every endpoint, or only the one refused. */
  scope: "all" | "endpoint";
  until: number;
  /** One line for the log: what happened and what the app does about it. */
  reason: string;
}

/** The next midnight UTC after `now`, when EODHD resets its daily limit. */
export function nextUtcMidnight(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1);
}

/** What a refusal means for later requests. Null when it is about the symbol, not the key. */
export function closureFor(endpoint: EodhdEndpoint, status: number, now: number): Closure | null {
  switch (status) {
    case 401:
      return {
        scope: "all",
        until: now + HOUR,
        reason: "EODHD_API_KEY was rejected; EODHD is skipped for an hour. Check the key in the service's variables",
      };
    case 402:
      return {
        scope: "all",
        until: nextUtcMidnight(now),
        reason: "the plan's daily request limit is used up; EODHD is skipped until it resets at midnight UTC",
      };
    case 403:
      return {
        scope: "endpoint",
        until: now + PLAN_REFUSAL_MS,
        reason:
          endpoint === "/fundamentals"
            ? "this EODHD plan does not include fundamentals; skipped for 12 hours. Statements still come from SEC filings; EODHD's profile fields, analyst targets and fund facts need its Fundamentals or All-In-One plan"
            : `this EODHD plan does not include ${endpoint}; skipped for 12 hours`,
      };
    case 429:
      return {
        scope: "all",
        until: now + MINUTE,
        reason: "too many requests this minute; EODHD is skipped for a minute",
      };
    default:
      return null;
  }
}

export class EodhdAccess {
  private readonly closed = new Map<EodhdEndpoint | "all", { until: number; status: number }>();

  /** Whether a request to `endpoint` is worth sending now. */
  isOpen(endpoint: EodhdEndpoint, now = Date.now()): boolean {
    for (const key of ["all", endpoint] as const) {
      const closure = this.closed.get(key);
      if (!closure) continue;
      if (now < closure.until) return false;
      this.closed.delete(key);
    }
    return true;
  }

  /**
   * Records a refusal. Returns the closure it opened, or null when the
   * refusal is about the symbol, or repeats one already in force — requests
   * sent together come back refused together, and the first says it for all.
   * A different refusal still lands: a minute's rate limit followed by the
   * daily limit closes for the day.
   */
  refuse(endpoint: EodhdEndpoint, status: number, now = Date.now()): Closure | null {
    const closure = closureFor(endpoint, status, now);
    if (!closure) return null;
    const key = closure.scope === "all" ? "all" : endpoint;
    const current = this.closed.get(key);
    if (current && now < current.until && current.status === status) return null;
    this.closed.set(key, { until: closure.until, status });
    return closure;
  }
}
