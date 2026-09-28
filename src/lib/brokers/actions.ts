"use server";

import { and, eq, inArray, isNotNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "../db";
import { brokerConnections, brokerTradeLinks, trades } from "../db/schema";
import { actionRateLimited, userRateLimited } from "../security/guard";
import { siteUrl } from "../site-url";
import { flexTokenAllowed } from "./access";
import { brokerTokensEnabled, encryptToken, tokenHint } from "./crypto";
import {
  brokerReader,
  denied,
  duplicateWarning,
  journalSinceFrom,
  summarise,
  type BrokerResult,
} from "./gate";
import { downloadFlexReport, FLEX_ERROR_WORDS, FlexError, parseFlexReport } from "./ibkr-flex";
import { BROKERS, isBrokerKind, type BrokerReport } from "./report";
import {
  connectionPortalUrl,
  deleteAuthorization,
  deleteUser,
  listAuthorizations,
  registerUser,
  SNAPTRADE_ERROR_WORDS,
  SnapTradeError,
  snaptradeConfigured,
  type SnapTradeUser,
} from "./snaptrade";
import { applyReport, IBKR_FLEX, SNAPTRADE, snapTradeUserFor, syncConnection } from "./sync";

/**
 * Connecting, refreshing and disconnecting a reader's broker.
 *
 * Every one of these is a public endpoint — that is what a server action is —
 * so each works out who is asking from the session and touches only that
 * reader's rows. None takes an id from the form that could name someone
 * else's connection; the one that takes a SnapTrade connection id checks it
 * against the reader's own list at SnapTrade first.
 */

export type BrokerActionResult = BrokerResult & {
  /** SnapTrade's connection page, for the browser to open. */
  url?: string;
};

/** "Sync now" is refused this soon after the last attempt; brokers' reports change once a day. */
const RESYNC_MINUTES = 15;

function refresh() {
  revalidatePath("/account");
  revalidatePath("/portfolio");
  revalidatePath("/journal");
}

async function rateLimited(userId: string): Promise<BrokerActionResult | null> {
  const wait = (await actionRateLimited("brokerConnect")) ?? userRateLimited("brokerConnect", userId);
  return wait ? { ok: false, message: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` } : null;
}

/* --------------------------------------------------------------- SnapTrade */

/**
 * Registers the reader with SnapTrade if needed, and returns the address of
 * SnapTrade's connection page. The reader logs in to their broker there; this
 * app never sees that login, only the read-only access SnapTrade relays.
 */
export async function startSnapTradeConnect(
  _prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  const gate = await brokerReader(true);
  if (denied(gate)) return gate;
  if (!snaptradeConfigured() || !brokerTokensEnabled()) {
    return { ok: false, message: SNAPTRADE_ERROR_WORDS.NOT_CONFIGURED };
  }
  const limited = await rateLimited(gate.userId);
  if (limited) return limited;

  const db = getDb();
  const [existing] = await db
    .select()
    .from(brokerConnections)
    .where(and(eq(brokerConnections.userId, gate.userId), eq(brokerConnections.broker, SNAPTRADE)))
    .limit(1);

  try {
    let user: SnapTradeUser | null = existing ? snapTradeUserFor(existing) : null;
    if (!user) {
      // A reader already known to SnapTrade whose secret this server cannot
      // read (a lost row, a rotated key) is removed there and registered
      // again, rather than left orphaned.
      user = await registerUser(gate.userId).catch(async (err) => {
        if (!(err instanceof SnapTradeError) || err.status !== 400) throw err;
        await deleteUser(gate.userId);
        return registerUser(gate.userId);
      });
      const now = new Date();
      const values = {
        userId: gate.userId,
        broker: SNAPTRADE,
        tokenCiphertext: encryptToken(user.userSecret, gate.userId, SNAPTRADE),
        tokenHint: null,
        queryId: null,
        status: "ok",
        lastErrorCode: null,
        journalSince: journalSinceFrom(form),
        updatedAt: now,
      };
      await db
        .insert(brokerConnections)
        .values(values)
        .onConflictDoUpdate({ target: [brokerConnections.userId, brokerConnections.broker], set: values });
    }

    const url = await connectionPortalUrl(user, `${siteUrl()}/api/brokers/snaptrade/return`);
    return { ok: true, message: "Opening SnapTrade…", url };
  } catch (err) {
    const category = err instanceof SnapTradeError ? err.category : "UNAVAILABLE";
    return { ok: false, message: SNAPTRADE_ERROR_WORDS[category] };
  }
}

/** Removes one brokerage from the reader's SnapTrade connection. */
export async function removeSnapTradeBrokerage(
  _prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  const gate = await brokerReader(false);
  if (denied(gate)) return gate;
  const authorizationId = String(form.get("authorizationId") ?? "");

  const [connection] = await getDb()
    .select()
    .from(brokerConnections)
    .where(and(eq(brokerConnections.userId, gate.userId), eq(brokerConnections.broker, SNAPTRADE)))
    .limit(1);
  const user = connection ? snapTradeUserFor(connection) : null;
  if (!connection || !user) return { ok: false, message: "No broker is connected through SnapTrade." };

  try {
    // Only an id SnapTrade lists for this reader, so a forged form cannot
    // name anybody else's connection.
    const theirs = await listAuthorizations(user);
    if (!theirs.some((a) => a.id === authorizationId)) {
      return { ok: false, message: "That connection is not one of yours." };
    }
    await deleteAuthorization(user, authorizationId);
  } catch (err) {
    const category = err instanceof SnapTradeError ? err.category : "UNAVAILABLE";
    return { ok: false, message: SNAPTRADE_ERROR_WORDS[category] };
  }

  const outcome = await syncConnection(connection.id);
  refresh();
  return outcome.ok
    ? { ok: true, message: `Removed. ${summarise(outcome.positions, outcome.tradesAdded, outcome.tradesUpdated)} remain.` }
    : { ok: true, message: "Removed. The rest will refresh on the next sync." };
}

/* ------------------------------------------------------ Flex token (owner) */

/**
 * Connects with a pasted IBKR Flex token — only for the addresses listed in
 * BROKER_FLEX_TOKEN_EMAILS. Everyone else connects through SnapTrade or
 * uploads a statement, so this app never holds a key of theirs.
 */
export async function connectIbkr(
  _prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  const gate = await brokerReader(true);
  if (denied(gate)) return gate;
  if (!flexTokenAllowed(gate.email)) {
    return { ok: false, message: "Connect through SnapTrade or upload a statement instead." };
  }
  if (!brokerTokensEnabled()) {
    return { ok: false, message: "Connecting a broker is not set up on this server yet." };
  }
  const limited = await rateLimited(gate.userId);
  if (limited) return limited;

  const token = String(form.get("token") ?? "").trim();
  const queryId = String(form.get("queryId") ?? "").trim();

  if (!/^[A-Za-z0-9]{10,64}$/.test(token)) {
    return { ok: false, message: "That does not look like a Flex Web Service token. Copy the whole “Current Token”." };
  }
  if (!/^\d{1,12}$/.test(queryId)) {
    return { ok: false, message: "The query ID is the number shown next to your Flex query." };
  }

  // Checked against IBKR before anything is stored, so a mistyped token is
  // caught here rather than failing quietly every night.
  let report: BrokerReport;
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

  const notes: string[] = [];
  const warning = await duplicateWarning(gate.userId);
  if (warning) notes.push(warning);

  const now = new Date();
  const values = {
    userId: gate.userId,
    broker: IBKR_FLEX,
    tokenCiphertext: encryptToken(token, gate.userId, IBKR_FLEX),
    tokenHint: tokenHint(token),
    queryId,
    status: "ok",
    lastErrorCode: null,
    journalSince: journalSinceFrom(form),
    lastAttemptAt: now,
    syncStartedAt: null,
    updatedAt: now,
  };
  const [connection] = await getDb()
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

/* ------------------------------------------------------------- any source */

/** The reader's own connection of the kind named in the form, or null. */
async function ownConnection(userId: string, form: FormData) {
  const broker = String(form.get("broker") ?? "");
  if (!isBrokerKind(broker)) return null;
  const [connection] = await getDb()
    .select()
    .from(brokerConnections)
    .where(and(eq(brokerConnections.userId, userId), eq(brokerConnections.broker, broker)))
    .limit(1);
  return connection ?? null;
}

export async function syncBrokerNow(
  _prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  const gate = await brokerReader(true);
  if (denied(gate)) return gate;

  const connection = await ownConnection(gate.userId, form);
  if (!connection) return { ok: false, message: "No broker is connected." };

  const since = connection.lastAttemptAt ? (Date.now() - connection.lastAttemptAt.getTime()) / 60_000 : Infinity;
  if (since < RESYNC_MINUTES) {
    const minutes = Math.max(1, Math.floor(since));
    return {
      ok: false,
      message: `Synced ${minutes} minute${minutes === 1 ? "" : "s"} ago. Brokers update these figures once a day, so there is nothing newer yet.`,
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

/**
 * Disconnects one source: deletes its credential from this server, and for
 * SnapTrade deletes the reader at SnapTrade too, which removes every
 * connection and all the data SnapTrade holds for them.
 */
export async function disconnectBroker(
  _prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  const gate = await brokerReader(false);
  if (denied(gate)) return gate;
  const connection = await ownConnection(gate.userId, form);
  if (!connection) return { ok: false, message: "Nothing to disconnect." };
  const removeTrades = form.get("removeTrades") === "on";
  const notes: string[] = [];

  if (connection.broker === SNAPTRADE) {
    try {
      await deleteUser(gate.userId);
    } catch (err) {
      const category = err instanceof SnapTradeError ? err.category : "UNAVAILABLE";
      // Unreachable for now: keep the connection, so the reader can try again
      // and nothing is left behind at SnapTrade without a way to remove it.
      if (category === "UNAVAILABLE" || category === "RATE_LIMITED") {
        return { ok: false, message: SNAPTRADE_ERROR_WORDS[category] };
      }
      if (category !== "NOT_FOUND") {
        notes.push("SnapTrade could not be reached to delete your data there. You can also remove the connection from your broker's settings.");
      }
    }
  }

  const family = isBrokerKind(connection.broker) ? BROKERS[connection.broker].linkFamily : connection.broker;
  let removed = 0;
  await getDb().transaction(async (tx) => {
    if (removeTrades) {
      const linked = await tx
        .select({ tradeId: brokerTradeLinks.tradeId })
        .from(brokerTradeLinks)
        .where(
          and(
            eq(brokerTradeLinks.userId, gate.userId),
            eq(brokerTradeLinks.broker, family),
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
        .where(and(eq(brokerTradeLinks.userId, gate.userId), eq(brokerTradeLinks.broker, family)));
    }

    // Holdings and fills go with the connection (ON DELETE CASCADE); links are
    // kept unless asked, so a reconnect does not add every trade a second time.
    await tx.delete(brokerConnections).where(eq(brokerConnections.id, connection.id));
  });

  refresh();
  const what = connection.broker === "ibkr-upload" ? "Statement removed." : "Disconnected. Nothing of it is kept on this server.";
  return {
    ok: true,
    message: removed > 0 ? `${what} ${removed} trade${removed === 1 ? "" : "s"} removed from the journal.` : what,
    notes,
  };
}
