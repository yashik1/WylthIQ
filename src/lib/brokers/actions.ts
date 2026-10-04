"use server";

import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb } from "../db";
import { brokerConnections, brokerTradeLinks, trades } from "../db/schema";
import { accountTypeLabel, isAccountType } from "../portfolio/account-types";
import { actionRateLimited, userRateLimited } from "../security/guard";
import { siteUrl } from "../site-url";
import { flexTokenAllowed } from "./access";
import { brokerTokensEnabled, encryptToken, tokenHint } from "./crypto";
import { failsafe } from "./failsafe";
import {
  brokerReader,
  denied,
  duplicateWarning,
  journalSinceFrom,
  summarise,
  type BrokerResult,
} from "./gate";
import { downloadFlexReport, FlexError, flexErrorWords, parseFlexReport } from "./ibkr-flex";
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
import {
  applyReport,
  IBKR_FLEX,
  readConfirmations,
  SNAPTRADE,
  snapTradeUserFor,
  syncConnection,
  type ConnectionDetails,
} from "./sync";

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
 * Given a `reconnect` id, the page repairs that connection instead.
 */
async function startSnapTradeConnectUnguarded(
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

  // A connection the broker has disabled is repaired in place, not added
  // again beside itself.
  const reconnect = String(form.get("reconnect") ?? "") || null;

  try {
    let user: SnapTradeUser | null = existing ? snapTradeUserFor(existing) : null;
    if (reconnect) {
      if (!user) return { ok: false, message: "No broker is connected through SnapTrade." };
      // Only a read-only connection SnapTrade lists for this reader, so a
      // forged form cannot name anybody else's, or one that could trade.
      const theirs = await listAuthorizations(user);
      if (!theirs.some((a) => a.id === reconnect && a.type === "read")) {
        return { ok: false, message: "That connection is not one of yours." };
      }
    }
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

    const url = await connectionPortalUrl(user, `${siteUrl()}/api/brokers/snaptrade/return`, reconnect);
    return { ok: true, message: "Opening SnapTrade…", url };
  } catch (err) {
    const category = err instanceof SnapTradeError ? err.category : "UNAVAILABLE";
    return { ok: false, message: SNAPTRADE_ERROR_WORDS[category] };
  }
}

/** Removes one brokerage from the reader's SnapTrade connection. */
async function removeSnapTradeBrokerageUnguarded(
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
async function connectIbkrUnguarded(
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
  const confirmQueryId = String(form.get("confirmQueryId") ?? "").trim();

  if (!/^[A-Za-z0-9]{10,64}$/.test(token)) {
    return { ok: false, message: "That does not look like a Flex Web Service token. Copy the whole “Current Token”." };
  }
  if (!/^\d{1,12}$/.test(queryId)) {
    return { ok: false, message: "The query ID is the number shown next to your Flex query." };
  }
  if (confirmQueryId && (!/^\d{1,12}$/.test(confirmQueryId) || confirmQueryId === queryId)) {
    return {
      ok: false,
      message: "The confirmation query ID is the number shown next to a separate Trade Confirmation Flex Query.",
    };
  }

  // Checked against IBKR before anything is stored, so a mistyped token is
  // caught here rather than failing quietly every night.
  let report: BrokerReport;
  try {
    report = parseFlexReport(await downloadFlexReport(token, queryId));
  } catch (err) {
    // IBKR's code or the category only: never the token or IBKR's own wording.
    console.warn(
      `[brokers] connecting a Flex token failed: ${err instanceof FlexError ? (err.code ?? err.category) : "UNAVAILABLE"}`,
    );
    return { ok: false, message: flexErrorWords(err) };
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
  if (confirmQueryId) {
    const confirmed = await readConfirmations(token, confirmQueryId, report);
    report = confirmed.report;
    if (confirmed.note) notes.push(confirmed.note);
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
    journalSince: journalSinceFrom(form),
    details: confirmQueryId ? { confirmQueryId } : {},
    lastAttemptAt: now,
    syncStartedAt: null,
    updatedAt: now,
  };
  const [connection] = await getDb()
    .insert(brokerConnections)
    .values(values)
    .onConflictDoUpdate({
      target: [brokerConnections.userId, brokerConnections.broker],
      // A replaced token keeps the account types the reader set; the accounts are the same ones.
      set: {
        ...values,
        details: sql`${JSON.stringify(values.details)}::jsonb || jsonb_strip_nulls(jsonb_build_object('accountTypes', ${brokerConnections.details} -> 'accountTypes'))`,
      },
    })
    .returning();

  try {
    const outcome = await applyReport(connection, report);
    refresh();
    if (!outcome.ok) return outcome;
    console.info(
      `[brokers] connected ibkr-flex #${connection.id}: statement to ${report.toDate ?? "?"}, ` +
        `${report.executions.length} fills read, ${outcome.positions} holdings, ${outcome.tradesAdded} trades added` +
        (confirmQueryId ? `, confirmations ${notes.some((n) => n.startsWith("Today's trades could not")) ? "not read" : "read"}` : ""),
    );
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

/**
 * Sets, changes or clears the Trade Confirmation query a Flex token also
 * reads, without asking for the token again, and reads today's trades with it
 * straight away. A query that is not a Trade Confirmation query says so in
 * the result, and the statement's update goes ahead regardless.
 */
async function setIbkrConfirmQueryUnguarded(
  _prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  const gate = await brokerReader(true);
  if (denied(gate)) return gate;
  if (!flexTokenAllowed(gate.email)) {
    return { ok: false, message: "Connect through SnapTrade or upload a statement instead." };
  }
  const limited = await rateLimited(gate.userId);
  if (limited) return limited;

  const [connection] = await getDb()
    .select()
    .from(brokerConnections)
    .where(and(eq(brokerConnections.userId, gate.userId), eq(brokerConnections.broker, IBKR_FLEX)))
    .limit(1);
  if (!connection) return { ok: false, message: "Connect with a Flex token first." };

  const confirmQueryId = String(form.get("confirmQueryId") ?? "").trim();
  if (confirmQueryId && (!/^\d{1,12}$/.test(confirmQueryId) || confirmQueryId === connection.queryId)) {
    return {
      ok: false,
      message: "The confirmation query ID is the number shown next to a separate Trade Confirmation Flex Query.",
    };
  }

  const { confirmQueryId: _previous, ...rest } = (connection.details ?? {}) as ConnectionDetails;
  void _previous;
  await getDb()
    .update(brokerConnections)
    .set({ details: confirmQueryId ? { ...rest, confirmQueryId } : rest, updatedAt: new Date() })
    .where(eq(brokerConnections.id, connection.id));
  if (!confirmQueryId) {
    refresh();
    return { ok: true, message: "Today's trades will no longer be read; trades arrive with the daily statement." };
  }

  const outcome = await syncConnection(connection.id);
  refresh();
  if (!outcome.ok) return { ok: false, message: `Saved. ${outcome.message}` };
  return {
    ok: true,
    message: `Saved and synced. ${summarise(outcome.positions, outcome.tradesAdded, outcome.tradesUpdated)}.`,
    notes: outcome.notes,
  };
}

/**
 * Sets the kind of one account (TFSA, RRSP…), or clears the reader's choice so
 * the broker's own word is used again. The account must be one this reader's
 * connection reports; the choice is written into the row in one statement, so
 * a sync saved at the same moment keeps it. See READER_SETTINGS in sync.ts.
 */
async function setAccountTypeUnguarded(
  _prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  const gate = await brokerReader(true);
  if (denied(gate)) return gate;
  const wait = (await actionRateLimited("brokerSettings")) ?? userRateLimited("brokerSettings", gate.userId);
  if (wait) return { ok: false, message: `Too many changes. Try again in ${Math.ceil(wait / 60)} minutes.` };

  const connection = await ownConnection(gate.userId, form);
  if (!connection) return { ok: false, message: "That broker is not connected." };

  const accountId = String(form.get("account") ?? "");
  const account = ((connection.details ?? {}) as ConnectionDetails).accounts?.find((a) => a.id === accountId);
  if (!account) return { ok: false, message: "That account is not part of this connection. Reload the page." };

  const type = String(form.get("type") ?? "");
  if (type !== "" && !isAccountType(type)) return { ok: false, message: "Choose one of the listed account types." };

  const chosen = sql`coalesce(${brokerConnections.details} -> 'accountTypes', '{}'::jsonb)`;
  await getDb()
    .update(brokerConnections)
    .set({
      details: sql`jsonb_set(${brokerConnections.details}, '{accountTypes}', ${
        type ? sql`${chosen} || jsonb_build_object(${accountId}::text, ${type}::text)` : sql`${chosen} - ${accountId}::text`
      })`,
      updatedAt: new Date(),
    })
    .where(and(eq(brokerConnections.id, connection.id), eq(brokerConnections.userId, gate.userId)));

  refresh();
  const effective = isAccountType(type) ? type : (account.type ?? null);
  return {
    ok: true,
    message: type
      ? `${account.description} is now shown as ${accountTypeLabel(effective)}.`
      : effective
        ? `${account.description} is shown as ${accountTypeLabel(effective)}, as your broker reports.`
        : `${account.description} is shown with no type.`,
  };
}

async function syncBrokerNowUnguarded(
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
    const wait = Math.max(1, Math.ceil(RESYNC_MINUTES - since));
    return {
      ok: false,
      message: `Synced ${minutes} minute${minutes === 1 ? "" : "s"} ago. You can sync again in ${wait} minute${wait === 1 ? "" : "s"}.`,
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
async function disconnectBrokerUnguarded(
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

/* ---------------------------------------------------------------- exported */

/*
  What the browser can call. Each runs its action inside `failsafe`, so a
  failure anywhere in it — the broker tables not created yet, the database
  unreachable — answers the form with a plain sentence instead of throwing,
  which would replace the whole account page with the error screen.
*/

export async function startSnapTradeConnect(
  prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  return failsafe("connecting through SnapTrade", () => startSnapTradeConnectUnguarded(prev, form));
}

export async function removeSnapTradeBrokerage(
  prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  return failsafe("removing a SnapTrade brokerage", () => removeSnapTradeBrokerageUnguarded(prev, form));
}

export async function connectIbkr(prev: BrokerActionResult | null, form: FormData): Promise<BrokerActionResult> {
  return failsafe("connecting a Flex token", () => connectIbkrUnguarded(prev, form));
}

export async function setIbkrConfirmQuery(
  prev: BrokerActionResult | null,
  form: FormData,
): Promise<BrokerActionResult> {
  return failsafe("setting the confirmation query", () => setIbkrConfirmQueryUnguarded(prev, form));
}

export async function setAccountType(prev: BrokerActionResult | null, form: FormData): Promise<BrokerActionResult> {
  return failsafe("setting an account's type", () => setAccountTypeUnguarded(prev, form));
}

export async function syncBrokerNow(prev: BrokerActionResult | null, form: FormData): Promise<BrokerActionResult> {
  return failsafe("syncing on request", () => syncBrokerNowUnguarded(prev, form));
}

export async function disconnectBroker(prev: BrokerActionResult | null, form: FormData): Promise<BrokerActionResult> {
  return failsafe("disconnecting", () => disconnectBrokerUnguarded(prev, form));
}
