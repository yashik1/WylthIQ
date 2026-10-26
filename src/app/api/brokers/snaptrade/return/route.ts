import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { brokerConnections } from "@/lib/db/schema";
import { logBrokerFailure } from "@/lib/brokers/failsafe";
import { brokerReader, denied } from "@/lib/brokers/gate";
import { SNAPTRADE, syncConnection } from "@/lib/brokers/sync";
import { captureDueChartsAfterResponse } from "@/lib/journal/chart-capture";
import { refuseIfRateLimited } from "@/lib/security/guard";
import { siteUrl } from "@/lib/site-url";

export const dynamic = "force-dynamic";

/**
 * Where SnapTrade sends the reader back after they connect a broker.
 *
 * Nothing SnapTrade adds to this address is trusted. The reader is the one
 * signed in, their connection is looked up from that, and the sync that runs
 * here asks SnapTrade directly what was connected — deleting, rather than
 * reading, any connection that is not read-only.
 */
export async function GET(request: Request) {
  const refusal = refuseIfRateLimited(request, "compute");
  if (refusal) return refusal;

  const back = (outcome: string) =>
    NextResponse.redirect(new URL(`/account?broker=${outcome}#connected-broker`, siteUrl()), 303);

  const gate = await brokerReader(true);
  if (denied(gate)) return NextResponse.redirect(new URL("/signin?next=/account", siteUrl()), 303);

  // Back to the account page whatever happens, with a sentence to show,
  // rather than an error screen in place of it.
  try {
    const [connection] = await getDb()
      .select({ id: brokerConnections.id })
      .from(brokerConnections)
      .where(and(eq(brokerConnections.userId, gate.userId), eq(brokerConnections.broker, SNAPTRADE)))
      .limit(1);
    if (!connection) return back("none");

    const outcome = await syncConnection(connection.id);
    if (!outcome.ok) return back("failed");
    captureDueChartsAfterResponse(gate.userId);
    // Trades are read once a day, so a broker added since the last read
    // shows its holdings now and its trades with the next daily sync.
    return back(outcome.tradesRead ? "connected" : "connected-holdings");
  } catch (err) {
    logBrokerFailure("returning from SnapTrade", err);
    return back("unavailable");
  }
}
