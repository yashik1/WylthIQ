import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";

/**
 * The gate on every scheduled job.
 *
 * These routes exist to be called by a scheduler, but they are ordinary public
 * URLs and nothing stops anybody else calling them. Each one spends real
 * money on somebody else's rate limit — SEC EDGAR, Twelve Data, Finnhub — and
 * writes to the database, so an unauthenticated caller can burn a daily quota
 * and leave the app with no data until it resets.
 *
 * The rule is fail *closed*. An earlier version checked the secret only when
 * one was configured (`if (secret) { ... }`), which reads as caution and is
 * the opposite: a deployment that forgot to set CRON_SECRET — this one, until
 * now — served full ingestion to anybody who found the URL. Missing
 * configuration is refused rather than waved through, because the cost of
 * being wrong falls entirely on the operator either way.
 */

/** Refusal to send, or null when the caller may proceed. */
export function refuseUnauthorizedCron(request: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    return NextResponse.json(
      {
        error: "CRON_SECRET is not set",
        message:
          "This job spends an external rate limit and writes to the database, so it " +
          "refuses to run unauthenticated. Set CRON_SECRET and send it as " +
          "'Authorization: Bearer <secret>'.",
      },
      { status: 503 },
    );
  }

  const header = request.headers.get("authorization") ?? "";

  if (!constantTimeEquals(header, `Bearer ${secret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}

/**
 * Compared without leaking how much of a guess was right.
 *
 * `===` on a string returns at the first differing byte, which turns guessing
 * a secret into a solvable problem given enough attempts. Length is checked
 * first because timingSafeEqual throws on a mismatch and a length difference
 * is not the secret.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
