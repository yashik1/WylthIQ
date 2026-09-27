import { NextResponse } from "next/server";
import { canAccess, entitlementForUser } from "@/lib/billing/entitlement";
import { connectionsDue, syncConnection } from "@/lib/brokers/sync";
import { isDatabaseConfigured } from "@/lib/db";
import { refuseUnauthorizedCron } from "@/lib/security/cron-auth";
import { refuseIfRateLimited } from "@/lib/security/guard";

export const dynamic = "force-dynamic";

/**
 * Refreshes connected brokers, a few at a time.
 *
 * Meant to be called every hour. Each call syncs the handful of connections
 * whose last sync is oldest and more than 20 hours old, one after another, so
 * the day's work spreads across the day instead of arriving at IBKR as one
 * burst — and so a single call stays well inside a request timeout, since one
 * report can take the better part of a minute to generate.
 *
 * Connections waiting on their reader (an expired token, a broken query) are
 * skipped until the reader fixes them, and so are readers whose plan no longer
 * covers the feature.
 */
const DEFAULT_BATCH = 5;
const MAX_BATCH = 20;

export async function GET(request: Request) {
  const refusal = refuseUnauthorizedCron(request) ?? refuseIfRateLimited(request, "cron");
  if (refusal) return refusal;

  if (!isDatabaseConfigured()) {
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const requested = Number(new URL(request.url).searchParams.get("limit"));
  const batch = Number.isFinite(requested) && requested > 0 ? Math.min(requested, MAX_BATCH) : DEFAULT_BATCH;

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  try {
    for (const { id, userId } of await connectionsDue(batch)) {
      if (!canAccess(await entitlementForUser(userId), "BROKER_SYNC")) {
        skipped++;
        continue;
      }
      const outcome = await syncConnection(id);
      if (outcome.ok) synced++;
      else failed++;
    }
  } catch (err) {
    // Only the error's class: a database message can quote values.
    console.error("[cron] broker sync stopped:", err instanceof Error ? err.name : "unknown");
    return NextResponse.json({ ok: false, synced, failed, skipped }, { status: 500 });
  }

  // Counts only. Which readers failed, and why, is on each reader's own account page.
  return NextResponse.json({ ok: true, synced, failed, skipped });
}
