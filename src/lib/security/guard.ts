import { NextResponse } from "next/server";
import { headers } from "next/headers";
import { callerKey, limit, type RateLimitRule } from "./rate-limit";

/**
 * Applying the limiter, in the two shapes this app needs.
 *
 * Route handlers hold a Request. Server actions do not — they read the
 * incoming headers from `next/headers` instead — and both need the same
 * decision, so the rule lives in one table below rather than being written out
 * per call site with slightly different numbers each time.
 */

/**
 * The limits, named by what they protect.
 *
 * Chosen against what a real person does rather than what a server can bear.
 * Nobody signs in six times a minute, so `auth` at five is generous for a
 * human and useless for a password sprayer. The expensive jobs are far
 * tighter because each one costs an external quota this app does not own.
 */
export const RULES = {
  /** Sign-in and sign-up. Credential stuffing is the thing being priced out. */
  auth: { limit: 5, windowSeconds: 60 },
  /** Password reset: sends mail, so abuse costs sending reputation. */
  passwordReset: { limit: 3, windowSeconds: 900 },
  /** Newsletter signup: public, unauthenticated, sends mail to strangers. */
  newsletter: { limit: 3, windowSeconds: 900 },
  /** Symbol search: cheap each, but fronts a provider with a per-minute cap. */
  search: { limit: 30, windowSeconds: 60 },
  /** Backtests and screens: seconds of CPU and a provider call per run. */
  compute: { limit: 10, windowSeconds: 60 },
  /** Price bars and events: proxies a metered upstream. */
  marketData: { limit: 60, windowSeconds: 60 },
  /** Scheduled jobs. Authenticated already; this bounds a leaked secret. */
  cron: { limit: 4, windowSeconds: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RuleName = keyof typeof RULES;

/**
 * For route handlers. Returns a 429 to send, or null to continue.
 *
 * `Retry-After` is set because a client that cannot tell when to come back
 * will simply come back immediately, which is the behaviour the limit exists
 * to stop.
 */
export function refuseIfRateLimited(request: Request, rule: RuleName): NextResponse | null {
  const result = limit(callerKey(request, rule), RULES[rule]);
  if (result.ok) return null;

  return NextResponse.json(
    {
      error: "Too many requests",
      message: `Wait ${result.retryAfterSeconds}s and try again.`,
    },
    {
      status: 429,
      headers: {
        "Retry-After": String(result.retryAfterSeconds),
        "Cache-Control": "no-store",
      },
    },
  );
}

/**
 * For server actions, which have no Request to hand.
 *
 * Returns the seconds to wait, or null when the caller may proceed — a plain
 * value rather than a Response, because an action's answer is whatever shape
 * its own form expects rather than HTTP.
 */
export async function actionRateLimited(rule: RuleName): Promise<number | null> {
  const headerList = await headers();

  // Same precedence as callerKey; see the note there about which of these can
  // be forged and why Cloudflare's comes first.
  const ip =
    headerList.get("cf-connecting-ip")?.trim() ||
    headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headerList.get("x-real-ip")?.trim() ||
    "unknown";

  const result = limit(`${rule}:${ip}`, RULES[rule]);
  return result.ok ? null : result.retryAfterSeconds;
}
