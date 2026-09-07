import { NextResponse } from "next/server";
import { refuseIfRateLimited } from "@/lib/security/guard";
import { refuseUnauthorizedCron } from "@/lib/security/cron-auth";
import { isDatabaseConfigured } from "@/lib/db";
import { getStaleQuoteSymbols, refreshQuotes } from "@/lib/ingest";

export const dynamic = "force-dynamic";

/**
 * Refreshes stored quotes, which the movers list and sector heatmap read.
 *
 * Kept apart from the fundamentals refresh because prices change constantly
 * while filings change quarterly. Batch size is capped per call so one request
 * cannot run unbounded; `npm run quotes` covers the whole universe in one pass.
 */
const DEFAULT_BATCH = 120;

export async function GET(request: Request) {
  const refusal = refuseUnauthorizedCron(request) ?? refuseIfRateLimited(request, "cron");
  if (refusal) return refusal;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const requested = Number(new URL(request.url).searchParams.get("limit"));
  const batch =
    Number.isFinite(requested) && requested > 0 ? Math.min(requested, 1000) : DEFAULT_BATCH;

  try {
    /*
      The stalest quotes, not the first N of the universe.

      Slicing the universe took the same 120 symbols on every call, so a
      scheduled run refreshed those and left the rest frozen — and since the
      movers list ranks across every company, whichever stale rows happened to
      hold the largest old moves stayed pinned to the top of "biggest risers"
      indefinitely.
    */
    const symbols = await getStaleQuoteSymbols(batch);
    const result = await refreshQuotes(symbols);
    return NextResponse.json({
      ok: true,
      requested: symbols.length,
      updated: result.updated,
      failed: result.failed,
      errors: result.errors.slice(0, 5),
    });
  } catch (err) {
    // A rate limit stops the run deliberately rather than grinding through
    // hundreds of guaranteed failures, so report it as such.
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Quote refresh failed" },
      { status: 502 },
    );
  }
}
