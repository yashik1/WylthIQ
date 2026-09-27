"use server";

import { and, count, eq, inArray, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { ACCESS_MODE, canAccess, getEntitlement } from "../billing/entitlement";
import { getDb, isDatabaseConfigured } from "../db";
import { brokerConnections, brokerTradeLinks, trades } from "../db/schema";
import { actionRateLimited, userRateLimited } from "../security/guard";
import { brokerTokensEnabled, encryptToken, tokenHint } from "./crypto";
import { downloadFlexReport, FLEX_ERROR_WORDS, FlexError, parseFlexReport, type FlexReport } from "./ibkr-flex";
import { applyReport, IBKR_FLEX, syncConnection } from "./sync";

/**
 * Connecting, refreshing and disconnecting a reader's broker.
 *
 * Every one of these is a public endpoint — that is what a server action is —
 * so each works out who is asking from the session and touches only that
 * reader's rows. None takes an id from the form that could name someone
 * else's connection.
 */

export interface BrokerActionResult {
  ok: boolean;
  message: string;
  notes?: string[];
}

/** "Sync now" is refused this soon after the last attempt; IBKR's reports change once a day. */
const RESYNC_MINUTES = 15;

function refresh() {
  revalidatePath("/account");
  revalidatePath("/portfolio");
  revalidatePath("/journal");
}

/**
 * The signed-in reader, or why not.
 *
 * `feature` is false only for disconnecting: somebody whose plan has lapsed
 * must still be able to take their token off this server.
 */
async function reader(feature: boolean): Promise<{ userId: string } | BrokerActionResult> {
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
  return { userId: entitlement.userId };
}

function denied(v: { userId: string } | BrokerActionResult): v is BrokerActionResult {
  return "ok" in v;
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function summarise(positions: number, added: number, updated: number): string {
  const parts = [`${positions} holding${positions === 1 ? "" : "s"}`];
  if (added > 0) parts.push(`${added} trade${added === 1 ? "" : "s"} added to the journal`);
  if (updated > 0) parts.push(`${updated} updated`);
  return parts.join(", ");
}

export async function connectIbkr(
  _prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  const gate = await reader(true);
  if (denied(gate)) return gate;
  if (!brokerTokensEnabled()) {
    return { ok: false, message: "Connecting a broker is not set up on this server yet." };
  }

  const wait = (await actionRateLimited("brokerConnect")) ?? userRateLimited("brokerConnect", gate.userId);
  if (wait) {
    return { ok: false, message: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` };
  }

  const token = String(form.get("token") ?? "").trim();
  const queryId = String(form.get("queryId") ?? "").trim();
  const history = form.get("history") === "new" ? "new" : "year";

  if (!/^[A-Za-z0-9]{10,64}$/.test(token)) {
    return { ok: false, message: "That does not look like a Flex Web Service token. Copy the whole “Current Token”." };
  }
  if (!/^\d{1,12}$/.test(queryId)) {
    return { ok: false, message: "The query ID is the number shown next to your Flex query." };
  }

  // Checked against IBKR before anything is stored, so a mistyped token is
  // caught here rather than failing quietly every night.
  let report: FlexReport;
  try {
    report = parseFlexReport(await downloadFlexReport(token, queryId));
  } catch (err) {
    const category = err instanceof FlexError ? err.category : "UNAVAILABLE";
    return { ok: false, message: FLEX_ERROR_WORDS[category] };
  }
  if (!report.sections.positions && !report.sections.trades) {
    return {
      ok: false,
      message: "That Flex query has neither an Open Positions nor a Trades section. Add both and try again.",
    };
  }

  const db = getDb();
  const notes: string[] = [];

  if (history === "year") {
    const [{ value: existing }] = await db.select({ value: count() }).from(trades).where(eq(trades.userId, gate.userId));
    const [{ value: linked }] = await db
      .select({ value: count() })
      .from(brokerTradeLinks)
      .where(eq(brokerTradeLinks.userId, gate.userId));
    if (existing > 0 && linked === 0) {
      notes.push(
        `Your journal already had ${existing} trade${existing === 1 ? "" : "s"}. If you imported any of these from an IBKR file, they will now appear twice — delete one copy of each.`,
      );
    }
  }

  const now = new Date();
  const values = {
    userId: gate.userId,
    broker: IBKR_FLEX,
    tokenCiphertext: encryptToken(token, gate.userId, IBKR_FLEX),
    tokenHint: tokenHint(token),
    queryId,
    status: "ok",
    lastErrorCode: null,
    journalSince: history === "year" ? isoDaysAgo(365) : now.toISOString().slice(0, 10),
    lastAttemptAt: now,
    syncStartedAt: null,
    updatedAt: now,
  };
  const [connection] = await db
    .insert(brokerConnections)
    .values(values)
    .onConflictDoUpdate({ target: [brokerConnections.userId, brokerConnections.broker], set: values })
    .returning();

  try {
    const outcome = await applyReport(connection, report);
    refresh();
    if (!outcome.ok) return outcome;
    return {
      ok: true,
      message: `Connected. ${summarise(outcome.positions, outcome.tradesAdded, outcome.tradesUpdated)}.`,
      notes: [...notes, ...outcome.notes],
    };
  } catch (err) {
    console.error("[brokers] first sync failed:", err instanceof Error ? err.name : "unknown");
    refresh();
    return {
      ok: false,
      message: "Connected, but the first sync could not be saved. Use “Sync now” in a few minutes.",
    };
  }
}

export async function syncIbkrNow(): Promise<BrokerActionResult> {
  const gate = await reader(true);
  if (denied(gate)) return gate;

  const [connection] = await getDb()
    .select({ id: brokerConnections.id, lastAttemptAt: brokerConnections.lastAttemptAt })
    .from(brokerConnections)
    .where(and(eq(brokerConnections.userId, gate.userId), eq(brokerConnections.broker, IBKR_FLEX)))
    .limit(1);
  if (!connection) return { ok: false, message: "No broker is connected." };

  const since = connection.lastAttemptAt ? (Date.now() - connection.lastAttemptAt.getTime()) / 60_000 : Infinity;
  if (since < RESYNC_MINUTES) {
    const minutes = Math.max(1, Math.floor(since));
    return {
      ok: false,
      message: `Synced ${minutes} minute${minutes === 1 ? "" : "s"} ago. IBKR updates these reports once a day, so there is nothing newer yet.`,
    };
  }

  const outcome = await syncConnection(connection.id);
  refresh();
  if (!outcome.ok) return outcome;
  return {
    ok: true,
    message: `Synced. ${summarise(outcome.positions, outcome.tradesAdded, outcome.tradesUpdated)}.`,
    notes: outcome.notes,
  };
}

export async function disconnectIbkr(
  _prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  const gate = await reader(false);
  if (denied(gate)) return gate;
  const removeTrades = form.get("removeTrades") === "on";

  let removed = 0;
  await getDb().transaction(async (tx) => {
    if (removeTrades) {
      const linked = await tx
        .select({ tradeId: brokerTradeLinks.tradeId })
        .from(brokerTradeLinks)
        .where(
          and(
            eq(brokerTradeLinks.userId, gate.userId),
            eq(brokerTradeLinks.broker, IBKR_FLEX),
            isNotNull(brokerTradeLinks.tradeId),
          ),
        );
      const ids = linked.map((l) => l.tradeId!);
      if (ids.length > 0) {
        const deleted = await tx
          .delete(trades)
          .where(and(eq(trades.userId, gate.userId), inArray(trades.id, ids)))
          .returning({ id: trades.id });
        removed = deleted.length;
      }
      // Forgotten too, so connecting again adds them back rather than
      // treating them as trades the reader chose to delete.
      await tx
        .delete(brokerTradeLinks)
        .where(and(eq(brokerTradeLinks.userId, gate.userId), eq(brokerTradeLinks.broker, IBKR_FLEX)));
    }

    // Holdings and fills go with the connection (ON DELETE CASCADE); links are
    // kept unless asked, so a reconnect does not add every trade a second time.
    await tx
      .delete(brokerConnections)
      .where(and(eq(brokerConnections.userId, gate.userId), eq(brokerConnections.broker, IBKR_FLEX)));
  });

  refresh();
  return {
    ok: true,
    message:
      removed > 0
        ? `Disconnected, and ${removed} trade${removed === 1 ? "" : "s"} from IBKR removed from the journal. Your token has been deleted from this server.`
        : "Disconnected. Your token has been deleted from this server.",
  };
}
