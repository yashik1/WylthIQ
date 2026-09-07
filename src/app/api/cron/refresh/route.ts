import { NextResponse } from "next/server";
import { refuseIfRateLimited } from "@/lib/security/guard";
import { refuseUnauthorizedCron } from "@/lib/security/cron-auth";
import { isDatabaseConfigured } from "@/lib/db";
import { getStaleSymbols, ingestSymbols } from "@/lib/ingest";

export const dynamic = "force-dynamic";


/**
 * How many of the stalest symbols one invocation refreshes.
 *
 * Overridable with ?limit= so a Railway cron can pass a larger batch — Railway
 * imposes no function timeout, unlike the serverless platform this was
 * originally sized for. `npm run ingest` remains the way to refresh everything
 * in one go.
 */
const DEFAULT_BATCH = 100;

export async function GET(request: Request) {
  // Rejected without the shared secret so the endpoint cannot be used to burn
  // the SEC rate limit from outside — and refused outright when no secret is
  // configured. See src/lib/security/cron-auth.ts for why that is fail-closed.
  const refusal = refuseUnauthorizedCron(request) ?? refuseIfRateLimited(request, "cron");
  if (refusal) return refusal;

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "DATABASE_URL is not configured" },
      { status: 503 },
    );
  }

  try {
    const requested = Number(new URL(request.url).searchParams.get("limit"));
    const batch = Number.isFinite(requested) && requested > 0 ? Math.min(requested, 1000) : DEFAULT_BATCH;

    const symbols = await getStaleSymbols(batch);
    if (symbols.length === 0) {
      return NextResponse.json({
        ok: true,
        message: "No companies seeded yet. Run scripts/ingest.ts to populate the universe.",
      });
    }

    const result = await ingestSymbols(symbols);
    return NextResponse.json({
      ok: true,
      refreshed: result.processed,
      failed: result.failed,
      durationMs: result.durationMs,
      symbols,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Ingest failed" },
      { status: 500 },
    );
  }
}
