import { NextResponse } from "next/server";
import { refuseIfRateLimited } from "@/lib/security/guard";
import { ACCESS_MODE, getEntitlement, hasAccess } from "@/lib/billing/entitlement";
import { runFullScreenerBacktest } from "@/lib/backtest/run-screener";

export const dynamic = "force-dynamic";
// This fetches price history for the whole screening universe and can
// legitimately take upward of a minute — closer to the nightly ingest job
// than to a normal page request. Railway imposes no function timeout, unlike
// the serverless platform this app no longer runs on.
export const maxDuration = 300;

/**
 * "If I had bought the healthiest companies on this app and rebalanced every
 * year, how would that have done?" — run against today's screening universe,
 * scored at each rebalance date using only what was actually filed by then.
 */
export async function GET(request: Request) {
  const limited = refuseIfRateLimited(request, "compute");
  if (limited) return limited;


  /*
    The API is gated as well as the page.

    A paywall that only covers the rendered page is not a paywall — the route
    behind it answers the same question in JSON to anybody who knows the URL,
    and that URL is visible in the network tab of the page that does the
    gating.
  */
  const entitlement = await getEntitlement();
  if (!hasAccess(entitlement)) {
    /*
      402 regardless of which mode is in force.

      "Payment Required" is the honest status while a subscription is the
      gate, and stays the closest available one while the gate is merely an
      account — the resource exists and is being withheld pending something
      the caller has not done. Flipping the status alongside the mode would
      change the API's contract every time the pricing did.
    */
    return NextResponse.json(
      {
        error: entitlement.signedIn
          ? "Backtesting needs a subscription."
          : ACCESS_MODE === "sign-in"
            ? "Sign in to use backtesting."
            : "Sign in and subscribe to use backtesting.",
      },
      { status: 402 },
    );
  }

  const params = new URL(request.url).searchParams;
  const startParam = params.get("start");
  const amount = Number(params.get("amount") ?? 10_000);
  const topN = Math.max(1, Math.min(25, Number(params.get("topN") ?? 10)));
  if (!startParam || Number.isNaN(Date.parse(startParam))) {
    return NextResponse.json({ error: "start must be a valid date" }, { status: 400 });
  }
  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }

  try {
    const run = await runFullScreenerBacktest(new Date(startParam), amount, topN);
    return NextResponse.json(run, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (err) {
    // Matches the shape runFullScreenerBacktest itself returns on a handled
    // failure — a bare {error} here would leave the page trying to read
    // run.result off an object that has no result key at all.
    return NextResponse.json(
      {
        result: {
          error: err instanceof Error ? err.message : "Could not run the backtest.",
        },
        universeSize: 0,
        candidatesScored: 0,
        topN,
      },
      { status: 200 },
    );
  }
}
