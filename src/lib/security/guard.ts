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
  /** Grounded explanations, per address. Each one is a paid model call. */
  ai: { limit: 6, windowSeconds: 60 },
  /** Grounded explanations, per account per day, so one account cannot run up the bill. */
  aiDaily: { limit: 40, windowSeconds: 86_400 },
  /**
   * Connecting a broker, per address and per account. Each attempt makes this
   * server call IBKR with whatever token was pasted, so an open form would let
   * anyone use it to test tokens against IBKR at our expense and in our name.
   */
  brokerConnect: { limit: 5, windowSeconds: 3600 },
  /** Uploading a broker statement: a large body to parse, so bounded per address and account. */
  brokerUpload: { limit: 10, windowSeconds: 3600 },
  /** Settings on a connected broker, such as an account's type: a small write, but still a write. */
  brokerSettings: { limit: 60, windowSeconds: 3600 },
  /** Screenshots for the journal: each is decoded and re-encoded, so bounded per address and account. */
  journalUpload: { limit: 30, windowSeconds: 3600 },
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

/**
 * The same limit, counted per signed-in account rather than per address.
 *
 * For the actions where one account on many addresses is the abuse to price
 * out. Used alongside `actionRateLimited`, not instead of it.
 */
export function userRateLimited(rule: RuleName, userId: string): number | null {
  const result = limit(`${rule}:user:${userId}`, RULES[rule]);
  return result.ok ? null : result.retryAfterSeconds;
}
