/**
 * A sliding-window rate limiter, held in this process's memory.
 *
 * Deliberately not Redis. This deployment runs a single replica, so one
 * process sees every request and an in-memory window is exact; adding a
 * network hop and an external account to reach the same answer would be cost
 * without benefit. The trade is written down rather than assumed: **if this
 * service is ever scaled past one replica, each instance keeps its own
 * counters and the effective limit multiplies by the replica count.** At that
 * point this needs a shared backend, and `limit()` is the only thing that has
 * to change.
 *
 * A restart clears the counters too. For abuse that matters far less than it
 * sounds — the window is measured in minutes, and anybody able to restart the
 * server has bigger levers.
 */

interface Window {
  /** Timestamps of the hits inside the current window, oldest first. */
  hits: number[];
  /** When this entry may be dropped, so idle keys do not accumulate forever. */
  expiresAt: number;
}

const windows = new Map<string, Window>();

/**
 * A ceiling on distinct keys held at once.
 *
 * The key is caller-derived, so without a bound this map is a memory leak
 * anybody can drive: a script rotating source addresses would add an entry per
 * request until the process died. At the cap the oldest insertion is dropped,
 * which at worst forgives one caller their history.
 */
const MAX_KEYS = 20_000;

export interface RateLimitResult {
  ok: boolean;
  /** Requests still allowed in this window. */
  remaining: number;
  /** Seconds until the window has room again. Zero when `ok`. */
  retryAfterSeconds: number;
}

export interface RateLimitRule {
  /** Requests permitted per window. */
  limit: number;
  windowSeconds: number;
}

/**
 * Records one hit against `key` and says whether it is allowed.
 *
 * Sliding rather than fixed-bucket: a fixed window lets somebody spend the
 * whole allowance at 59 seconds and the whole of the next one at 61, which is
 * double the intended rate at exactly the moment a limit matters most.
 */
export function limit(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();
  const windowMs = rule.windowSeconds * 1000;
  const cutoff = now - windowMs;

  sweep(now);

  const existing = windows.get(key);
  const hits = existing ? existing.hits.filter((t) => t > cutoff) : [];

  if (hits.length >= rule.limit) {
    // The oldest hit in the window is the one whose expiry frees a slot.
    const retryAfterMs = hits[0] + windowMs - now;
    windows.set(key, { hits, expiresAt: now + windowMs });
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil(retryAfterMs / 1000)),
    };
  }

  hits.push(now);
  windows.set(key, { hits, expiresAt: now + windowMs });

  if (windows.size > MAX_KEYS) {
    const oldest = windows.keys().next().value;
    if (oldest !== undefined) windows.delete(oldest);
  }

  return { ok: true, remaining: rule.limit - hits.length, retryAfterSeconds: 0 };
}

/**
 * Drops expired entries.
 *
 * Swept on write rather than on a timer: a `setInterval` would keep a handle
 * alive for the life of the process and run whether or not anything is using
 * this, which is the wrong shape for something imported by a route handler.
 * Amortised across calls and bounded per call, so one unlucky request cannot
 * pay for the whole map.
 */
let lastSweep = 0;
function sweep(now: number): void {
  if (now - lastSweep < 30_000) return;
  lastSweep = now;

  let examined = 0;
  for (const [key, window] of windows) {
    if (window.expiresAt <= now) windows.delete(key);
    if (++examined >= 1_000) break;
  }
}

/** Exposed so tests can start from a known state. */
export function resetRateLimits(): void {
  windows.clear();
  lastSweep = 0;
}

/**
 * Who a request is counted against.
 *
 * `cf-connecting-ip` first, because production sits behind Cloudflare and
 * Cloudflare overwrites that header on the way through — a client cannot
 * forge it. `x-forwarded-for` is the fallback and is only as trustworthy as
 * the proxy in front: taking the *first* entry is right behind a proxy that
 * appends, and would be spoofable if this ever ran with nothing in front of
 * it. That is the reason the Cloudflare header is preferred rather than
 * merely listed first.
 */
export function callerKey(request: Request, scope: string): string {
  const cloudflare = request.headers.get("cf-connecting-ip");
  const forwarded = request.headers.get("x-forwarded-for");
  const ip =
    cloudflare?.trim() ||
    forwarded?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip")?.trim() ||
    "unknown";

  return `${scope}:${ip}`;
}
