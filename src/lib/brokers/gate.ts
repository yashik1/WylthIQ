import { count, eq } from "drizzle-orm";
import { auth } from "../auth";
import { ACCESS_MODE, canAccess, getEntitlement } from "../billing/entitlement";
import { getDb, isDatabaseConfigured } from "../db";
import { brokerTradeLinks, trades } from "../db/schema";

/**
 * Who is asking, for the broker actions and routes.
 *
 * A plain module rather than a server action, so the routes (the SnapTrade
 * return and the statement upload) and the actions share one answer. Every
 * caller acts only on the rows of the reader this returns.
 */

export interface BrokerResult {
  ok: boolean;
  message: string;
  notes?: string[];
}

export interface BrokerReader {
  userId: string;
  email: string | null;
}

/**
 * The signed-in reader, or why not.
 *
 * `feature` is false only for disconnecting: somebody whose plan has lapsed
 * must still be able to take their connection off this server.
 */
export async function brokerReader(feature: boolean): Promise<BrokerReader | BrokerResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, message: "Connecting a broker is not available on this deployment." };
  }
  const entitlement = await getEntitlement();
  if (!entitlement.userId) return { ok: false, message: "Sign in to connect a broker." };
  if (feature && !canAccess(entitlement, "BROKER_SYNC")) {
    return {
      ok: false,
      message:
        ACCESS_MODE === "sign-in"
          ? "Connecting a broker needs an account."
          : "Connecting a broker is part of the Pro+ plan.",
    };
  }
  const session = await auth().catch(() => null);
  return { userId: entitlement.userId, email: session?.user?.email ?? null };
}

export function denied(v: BrokerReader | BrokerResult): v is BrokerResult {
  return "ok" in v;
}

export function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

/** The start date for journal imports, from the reader's choice on the form. */
export function journalSinceFrom(form: FormData): string {
  return form.get("history") === "new" ? isoDaysAgo(0) : isoDaysAgo(365);
}

export function summarise(positions: number, added: number, updated: number): string {
  const parts = [`${positions} holding${positions === 1 ? "" : "s"}`];
  if (added > 0) parts.push(`${added} trade${added === 1 ? "" : "s"} added to the journal`);
  if (updated > 0) parts.push(`${updated} updated`);
  return parts.join(", ");
}

/**
 * A warning when a reader's journal already has trades but none came from a
 * broker: an earlier file import may hold the same trades, which will now
 * appear twice.
 */
export async function duplicateWarning(userId: string): Promise<string | null> {
  const db = getDb();
  const [{ value: existing }] = await db.select({ value: count() }).from(trades).where(eq(trades.userId, userId));
  const [{ value: linked }] = await db
    .select({ value: count() })
    .from(brokerTradeLinks)
    .where(eq(brokerTradeLinks.userId, userId));
  if (existing === 0 || linked > 0) return null;
  return `Your journal already had ${existing} trade${existing === 1 ? "" : "s"}. If you imported any of these from a broker file, they may now appear twice — delete one copy of each.`;
}
