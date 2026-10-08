import { and, eq, isNull, like, lt, lte, ne, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  brokerConnections,
  brokerExecutions,
  brokerPositions,
  brokerTradeLinks,
  trades,
  type BrokerConnection,
} from "../db/schema";
import { isAccountType, type AccountType } from "../portfolio/account-types";
import { decryptToken } from "./crypto";
import { holdingsAfterLaterFills, matchProvisional, withConfirmations } from "./confirmations";
import {
  CONFIRMATION_PREFIX,
  downloadFlexReport,
  isProvisional,
  FlexError,
  flexErrorWords,
  parseFlexReport,
  parseTradeConfirms,
  symbolsByConid,
  type FlexDeps,
} from "./ibkr-flex";
import { planJournalWrites, type ExistingLink } from "./journal-plan";
import { BROKERS, isBrokerKind, positionKey, type BrokerReport, type SkippedItem } from "./report";
import { pairRoundTrips } from "./round-trips";
import {
  accountActivities,
  accountPositions,
  deleteConnection,
  describeAccount,
  listAccounts,
  listAuthorizations,
  SNAPTRADE_ERROR_WORDS,
  SnapTradeError,
  toBrokerReport,
  type SnapAccountData,
  type SnapTradeDeps,
  type SnapTradeUser,
} from "./snaptrade";

/**
 * Bringing a connected broker's figures into the app.
 *
 * Not a server action, on purpose: every exported function in a "use server"
 * file is an endpoint any browser can call with any arguments, and this one
 * takes a connection id. The actions in actions.ts decide whose connection it
 * is first; the nightly job is authenticated by the cron secret.
 */

export const IBKR_FLEX = "ibkr-flex";
export const IBKR_UPLOAD = "ibkr-upload";
export const SNAPTRADE = "snaptrade";

/** How long a sync may hold its lease before another run may assume it died. */
const LEASE_EXPIRED = sql`now() - interval '10 minutes'`;
/** A connection that just failed is not retried by the nightly job for this long. */
const RETRY_AFTER = sql`now() - interval '1 hour'`;
/**
 * SnapTrade asks that an account's trades be read no more than once every 24
 * hours (its launch checklist). Holdings may be read whenever the reader
 * syncs; trades wait until a day has passed since they were last read.
 */
const SNAPTRADE_TRADES_EVERY_MS = 24 * 60 * 60 * 1000;
/** More than any reader's holdings; a bound on what one report can write. */
const MAX_POSITIONS = 300;
/** Trades added per sync. More arrive on the next one, so a busy year is spread out, not refused. */
const MAX_JOURNAL_INSERTS = 2_000;
const INSERT_CHUNK = 500;

/** What the account page shows about a connection. Nothing in it is secret. */
export interface ConnectionDetails {
  /** SnapTrade: each brokerage connected, and whether it needs reconnecting at the broker. */
  brokerages?: { id: string; institution: string; disabled: boolean }[];
  /**
   * Every account, described without its full number, with the kind of
   * account the broker says it is (TFSA, RRSP…) when it says.
   */
  accounts?: { id: string; institution: string; description: string; type?: AccountType }[];
  /** Institutions whose connection could trade, and was therefore removed rather than used. */
  refused?: string[];
  /** SnapTrade: when its trades were last read, as an ISO time. See SNAPTRADE_TRADES_EVERY_MS. */
  tradesReadAt?: string;
  /**
   * IBKR Flex token: the Trade Confirmation query read for today's fills,
   * which the Activity statement only has after the day is processed.
   */
  confirmQueryId?: string;
  /**
   * The kind of each account as the reader set it, by account id. It wins
   * over what the broker says, and a sync never changes it.
   */
  accountTypes?: Record<string, AccountType>;
  /**
   * SnapTrade: connections the reader removed. SnapTrade deletes a connection
   * in the background and can go on listing it for a while; until it stops,
   * it is neither shown nor read, so what was removed stays removed.
   */
  removed?: string[];
}

/**
 * The settings in `details` that the reader chose rather than the broker
 * reported. A sync writes everything else afresh and carries these over from
 * the row as it stands when the sync is saved — not as it was when the sync
 * began — so a setting changed while a sync runs is kept.
 */
const READER_SETTINGS = ["confirmQueryId", "accountTypes", "removed"] as const satisfies readonly (keyof ConnectionDetails)[];

/** `details` as a sync leaves it: what the broker reported, plus the reader's own settings from the row. */
export function detailsWithReaderSettings(reported: ConnectionDetails) {
  const fresh: ConnectionDetails = { ...reported };
  for (const key of READER_SETTINGS) delete fresh[key];
  const kept = sql.join(
    READER_SETTINGS.map((key) => sql`${key}::text, ${brokerConnections.details} -> ${key}::text`),
    sql`, `,
  );
  return sql`${JSON.stringify(fresh)}::jsonb || jsonb_strip_nulls(jsonb_build_object(${kept}))`;
}

/** An account's type: the reader's choice, else what the broker said, else not known. */
export function accountTypeOf(details: ConnectionDetails, accountId: string): AccountType | null {
  const chosen = details.accountTypes?.[accountId];
  if (isAccountType(chosen)) return chosen;
  const reported = details.accounts?.find((a) => a.id === accountId)?.type;
  return isAccountType(reported) ? reported : null;
}

/** The detected type of each account, as `details.accounts` stores it. */
function typed(id: string, report: BrokerReport): { type?: AccountType } {
  const type = report.accountTypes?.[id];
  return type ? { type } : {};
}

export type SyncOutcome =
  | {
      ok: true;
      positions: number;
      tradesAdded: number;
      tradesUpdated: number;
      /** Whether this sync read trades and brought the journal up to date. */
      tradesRead: boolean;
      /** Things the reader should know about this sync, in plain words. */
      notes: string[];
    }
  | { ok: false; message: string };

const BUSY = "A sync for this account is already running. Try again in a few minutes.";
const UNREADABLE =
  "The saved credential can no longer be read on this server. Disconnect and connect again.";
const FAILED = "The sync could not be saved. Try again later.";
const UPLOAD_ONLY = "Statements you upload are refreshed by uploading a newer one.";

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** The journal links a connection reads and writes. See `BROKERS`. */
function linkFamily(connection: BrokerConnection): string {
  return isBrokerKind(connection.broker) ? BROKERS[connection.broker].linkFamily : connection.broker;
}

/** "U1234567" as "U•••4567": enough to tell accounts apart, not enough to be the number. */
export function maskAccount(accountId: string): string {
  const id = accountId.trim();
  if (id.length <= 5) return id;
  return `${id.slice(0, 1)}•••${id.slice(-4)}`;
}

/** Holdings keyed by account and instrument, summed if a report listed one twice. */
function positionRows(connection: BrokerConnection, report: BrokerReport) {
  const byKey = new Map<string, typeof brokerPositions.$inferInsert>();
  for (const p of report.positions) {
    const key = positionKey(p.accountId, p.conid);
    const existing = byKey.get(key);
    if (existing) {
      const quantity = existing.quantity + p.quantity;
      existing.averageCost = (existing.averageCost * existing.quantity + p.averageCost * p.quantity) / quantity;
      existing.quantity = quantity;
      continue;
    }
    byKey.set(key, {
      connectionId: connection.id,
      userId: connection.userId,
      accountId: p.accountId,
      conid: p.conid,
      symbol: p.symbol,
      quantity: p.quantity,
      averageCost: p.averageCost,
      currency: p.currency,
      reportDate: p.reportDate,
      label: p.label,
    });
  }
  return [...byKey.values()].slice(0, MAX_POSITIONS);
}

/**
 * Writes one report, from any source: fills, holdings and the journal, in
 * one transaction, so a failure part-way leaves yesterday's figures standing
 * rather than half of today's.
 */
export async function applyReport(
  connection: BrokerConnection,
  report: BrokerReport,
  details?: ConnectionDetails,
): Promise<SyncOutcome> {
  const notes: string[] = [];
  const skipped: SkippedItem[] = [...report.skipped];
  const family = linkFamily(connection);

  if (!report.sections.positions) {
    notes.push("The report has no Open Positions section, so holdings were not updated.");
  }
  if (!report.sections.trades) {
    notes.push(
      connection.broker === SNAPTRADE
        ? "Trades are read from SnapTrade once a day, so new ones reach your journal with the next daily sync."
        : "The report has no Trades section, so no trades were added to the journal.",
    );
  }

  const result = await getDb().transaction(async (tx) => {
    // Fills confirmed before the statement had them give way to the
    // statement's copies once it covers their day; a journal trade one of
    // them opened is re-pointed at the statement's copy. See confirmations.ts.
    if (report.sections.trades && report.toDate) {
      const covered = await tx
        .select()
        .from(brokerExecutions)
        .where(
          and(
            eq(brokerExecutions.connectionId, connection.id),
            like(brokerExecutions.externalId, `${CONFIRMATION_PREFIX}%`),
            lte(brokerExecutions.tradeDate, report.toDate),
          ),
        );
      for (const { provisionalId, statementId } of matchProvisional(covered, report.executions)) {
        const fill = covered.find((c) => c.externalId === provisionalId)!;
        if (statementId) {
          const [taken] = await tx
            .select({ id: brokerTradeLinks.id })
            .from(brokerTradeLinks)
            .where(
              and(
                eq(brokerTradeLinks.userId, connection.userId),
                eq(brokerTradeLinks.broker, family),
                eq(brokerTradeLinks.accountId, fill.accountId),
                eq(brokerTradeLinks.openingExternalId, statementId),
              ),
            );
          if (!taken) {
            await tx
              .update(brokerTradeLinks)
              .set({ openingExternalId: statementId })
              .where(
                and(
                  eq(brokerTradeLinks.userId, connection.userId),
                  eq(brokerTradeLinks.broker, family),
                  eq(brokerTradeLinks.accountId, fill.accountId),
                  eq(brokerTradeLinks.openingExternalId, provisionalId),
                ),
              );
          }
        }
        await tx.delete(brokerExecutions).where(eq(brokerExecutions.id, fill.id));
      }
    }

    for (const batch of chunks(report.executions, INSERT_CHUNK)) {
      await tx
        .insert(brokerExecutions)
        .values(
          batch.map((e) => ({
            connectionId: connection.id,
            userId: connection.userId,
            accountId: e.accountId,
            conid: e.conid,
            externalId: e.externalId,
            symbol: e.symbol,
            quantity: e.quantity,
            price: e.price,
            commission: e.commission,
            commissionCurrency: e.commissionCurrency,
            currency: e.currency,
            tradeDate: e.tradeDate,
            executedAt: e.executedAt,
            label: e.label,
          })),
        )
        .onConflictDoNothing({ target: [brokerExecutions.connectionId, brokerExecutions.externalId] });
    }

    let positions = 0;
    if (report.sections.positions) {
      const rows = positionRows(connection, report);
      await tx.delete(brokerPositions).where(eq(brokerPositions.connectionId, connection.id));
      for (const batch of chunks(rows, INSERT_CHUNK)) await tx.insert(brokerPositions).values(batch);
      positions = rows.length;
    }

    let tradesAdded = 0;
    let tradesUpdated = 0;
    // Pairing needs the true holding to seed each instrument, which only the
    // positions give; without them, trades opened before the record could not
    // be told from new ones, so the journal is left alone.
    if (report.sections.positions && report.sections.trades) {
      const fills = await tx
        .select()
        .from(brokerExecutions)
        .where(eq(brokerExecutions.connectionId, connection.id));
      const roundTrips = pairRoundTrips(fills, holdingsAfterLaterFills(report.reportedQuantities, fills, report.toDate));

      const linkRows = await tx
        .select({
          accountId: brokerTradeLinks.accountId,
          openingExternalId: brokerTradeLinks.openingExternalId,
          tradeId: brokerTradeLinks.tradeId,
          symbol: trades.symbol,
          side: trades.side,
          quantity: trades.quantity,
          entryPrice: trades.entryPrice,
          exitPrice: trades.exitPrice,
          fees: trades.fees,
          openedAt: trades.openedAt,
          closedAt: trades.closedAt,
        })
        .from(brokerTradeLinks)
        .leftJoin(trades, eq(trades.id, brokerTradeLinks.tradeId))
        .where(and(eq(brokerTradeLinks.userId, connection.userId), eq(brokerTradeLinks.broker, family)));

      const links: ExistingLink[] = linkRows.map((row) => ({
        accountId: row.accountId,
        openingExternalId: row.openingExternalId,
        tradeId: row.tradeId,
        current:
          row.tradeId !== null && row.symbol !== null
            ? {
                symbol: row.symbol,
                side: row.side === "short" ? "short" : "long",
                quantity: row.quantity!,
                entryPrice: row.entryPrice!,
                exitPrice: row.exitPrice,
                fees: row.fees!,
                openedAt: row.openedAt!,
                closedAt: row.closedAt,
              }
            : null,
      }));

      const plan = planJournalWrites(roundTrips, links, connection.journalSince);

      const inserts = plan.inserts.slice(0, MAX_JOURNAL_INSERTS);
      if (plan.inserts.length > inserts.length) {
        notes.push(
          `${plan.inserts.length - inserts.length} more trades will be added to the journal on the next sync.`,
        );
      }
      for (const batch of chunks(inserts, INSERT_CHUNK)) {
        // One row at a time: each link must name the trade made from its own
        // round trip, and Postgres does not promise that a multi-row insert
        // returns its ids in the order the rows were given.
        const linked: (typeof brokerTradeLinks.$inferInsert)[] = [];
        for (const { roundTrip, fields } of batch) {
          const [created] = await tx
            .insert(trades)
            .values({ userId: connection.userId, ...fields })
            .returning({ id: trades.id });
          linked.push({
            userId: connection.userId,
            broker: family,
            accountId: roundTrip.accountId,
            openingExternalId: roundTrip.openingExternalId,
            tradeId: created.id,
          });
        }
        await tx.insert(brokerTradeLinks).values(linked).onConflictDoNothing();
      }
      tradesAdded = inserts.length;

      for (const { tradeId, fields } of plan.updates) {
        await tx
          .update(trades)
          .set({ ...fields, updatedAt: new Date() })
          // The owner as well as the id, as everywhere else trades are written.
          .where(and(eq(trades.id, tradeId), eq(trades.userId, connection.userId)));
      }
      tradesUpdated = plan.updates.length;
    }

    await tx
      .update(brokerConnections)
      .set({
        status: "ok",
        lastErrorCode: null,
        statementToDate: report.toDate,
        skipped,
        details: detailsWithReaderSettings(
          details ?? {
            accounts: report.accounts.map((id) => ({
              id,
              institution: report.positions.find((p) => p.accountId === id)?.label ?? BROKERS["ibkr-flex"].label,
              description: maskAccount(id),
              ...typed(id, report),
            })),
          },
        ),
        lastSyncedAt: new Date(),
        syncStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(brokerConnections.id, connection.id));

    return { positions, tradesAdded, tradesUpdated };
  });

  return { ok: true, ...result, tradesRead: report.sections.positions && report.sections.trades, notes };
}

/** Records a failure without keeping any of the broker's own wording. */
async function recordFailure(connectionId: number, status: "needs-attention" | "error", code: string) {
  console.warn(`[brokers] sync of #${connectionId} failed: ${code}`);
  await getDb()
    .update(brokerConnections)
    .set({ status, lastErrorCode: code, syncStartedAt: null, updatedAt: new Date() })
    .where(eq(brokerConnections.id, connectionId));
}

/** SnapTrade's per-reader secret for this connection, or null if it cannot be read. */
export function snapTradeUserFor(connection: BrokerConnection): SnapTradeUser | null {
  if (!connection.tokenCiphertext) return null;
  const userSecret = decryptToken(connection.tokenCiphertext, connection.userId, connection.broker);
  return userSecret ? { userId: connection.userId, userSecret } : null;
}

/**
 * Everything SnapTrade holds for a reader, as a report plus what the account
 * page shows.
 *
 * READ-ONLY, CHECKED EVERY TIME. Connections are only ever requested as
 * read-only, but a reader could still end up with one that can trade — so
 * every connection SnapTrade reports is checked here, and one that is not
 * read-only is deleted at SnapTrade and its accounts are never read.
 */
export async function fetchSnapTrade(
  user: SnapTradeUser,
  deps: SnapTradeDeps = {},
  previous: ConnectionDetails = {},
  now = new Date(),
): Promise<{ report: BrokerReport; details: ConnectionDetails }> {
  // One the reader removed is on its way out at SnapTrade: not read, not shown, not deleted again.
  const removed = new Set(previous.removed ?? []);
  const authorizations = (await listAuthorizations(user, deps)).filter((a) => !removed.has(a.id));

  const refused: string[] = [];
  const kept = [];
  for (const authorization of authorizations) {
    if (authorization.type === "read") {
      kept.push(authorization);
      continue;
    }
    await deleteConnection(user, authorization.id, deps);
    refused.push(authorization.institution);
  }

  const readable = new Set(kept.map((a) => a.id));
  const accounts = (await listAccounts(user, deps)).filter((account) => readable.has(account.authorizationId));

  // Every account's trades or none: pairing checks the fills against the
  // holdings, so fills a day behind the holdings they sit beside would pair
  // wrongly. An account connected since the last read waits for the next one.
  const lastRead = Date.parse(previous.tradesReadAt ?? "");
  const readTrades = !Number.isFinite(lastRead) || now.getTime() - lastRead >= SNAPTRADE_TRADES_EVERY_MS;

  const data: SnapAccountData[] = [];
  for (const account of accounts) {
    const { positions, asOf } = await accountPositions(user, account.id, deps);
    const activities = readTrades ? await accountActivities(user, account.id, deps) : [];
    data.push({ account, positions, asOf, activities });
  }

  const report = toBrokerReport(data);
  return {
    report: { ...report, sections: { ...report.sections, trades: readTrades } },
    details: {
      brokerages: kept.map((a) => ({ id: a.id, institution: a.institution, disabled: a.disabled })),
      accounts: accounts.map((a) => ({
        id: a.id,
        institution: a.institution,
        description: describeAccount(a),
        ...typed(a.id, report),
      })),
      refused,
      // Only a read that covered an account counts; with none connected yet,
      // the first one connected is read straight away.
      tradesReadAt: readTrades && accounts.length > 0 ? now.toISOString() : previous.tradesReadAt,
    },
  };
}

/**
 * A Flex statement with today's fills from the Trade Confirmation query added.
 *
 * The statement stands on its own: a confirmation report that cannot be read
 * leaves it as it was, with a note, rather than failing the sync.
 */
export async function readConfirmations(
  token: string,
  confirmQueryId: string,
  report: BrokerReport,
  deps?: FlexDeps,
): Promise<{ report: BrokerReport; note: string | null; failure?: string }> {
  try {
    const xml = await downloadFlexReport(token, confirmQueryId, deps);
    const confirms = parseTradeConfirms(xml, { after: report.toDate, symbols: symbolsByConid(report) });
    return { report: withConfirmations(report, confirms), note: null };
  } catch (err) {
    const category = err instanceof FlexError ? err.category : "UNAVAILABLE";
    const failure = err instanceof FlexError ? (err.code ?? err.category) : "UNAVAILABLE";
    const why =
      category === "QUERY"
        ? `Check that the confirmation query is a Trade Confirmation Flex Query in XML format.${failure !== "QUERY" ? ` (IBKR code ${failure})` : ""}`
        : flexErrorWords(err);
    return {
      report,
      note: `Today's trades could not be read. ${why} Holdings and earlier trades were updated.`,
      failure,
    };
  }
}

export interface SyncDeps {
  flex?: FlexDeps;
  snaptrade?: SnapTradeDeps;
}

/**
 * Downloads and applies the latest figures for one connection.
 *
 * Takes a lease first, in the database rather than in memory, so the nightly
 * job and a reader's "Sync now" cannot both run it — and neither can two
 * instances of the app.
 */
export async function syncConnection(connectionId: number, deps: SyncDeps = {}): Promise<SyncOutcome> {
  const db = getDb();
  const [connection] = await db
    .update(brokerConnections)
    .set({ syncStartedAt: new Date(), lastAttemptAt: new Date() })
    .where(
      and(
        eq(brokerConnections.id, connectionId),
        or(isNull(brokerConnections.syncStartedAt), lt(brokerConnections.syncStartedAt, LEASE_EXPIRED)),
      ),
    )
    .returning();
  if (!connection) return { ok: false, message: BUSY };

  if (connection.broker === IBKR_UPLOAD) {
    await db.update(brokerConnections).set({ syncStartedAt: null }).where(eq(brokerConnections.id, connection.id));
    return { ok: false, message: UPLOAD_ONLY };
  }

  let report: BrokerReport;
  let details: ConnectionDetails | undefined;
  const extraNotes: string[] = [];

  if (connection.broker === SNAPTRADE) {
    const user = snapTradeUserFor(connection);
    if (!user) {
      await recordFailure(connection.id, "needs-attention", "SECRET_UNREADABLE");
      return { ok: false, message: UNREADABLE };
    }
    try {
      ({ report, details } = await fetchSnapTrade(user, deps.snaptrade, (connection.details ?? {}) as ConnectionDetails));
    } catch (err) {
      const failure = err instanceof SnapTradeError ? err : new SnapTradeError("UNAVAILABLE");
      // SnapTrade no longer knowing this reader is theirs to fix by connecting again.
      await recordFailure(
        connection.id,
        failure.category === "NOT_FOUND" ? "needs-attention" : "error",
        failure.status ? `${failure.category}_${failure.status}` : failure.category,
      );
      return { ok: false, message: SNAPTRADE_ERROR_WORDS[failure.category] };
    }
  } else {
    const token =
      connection.tokenCiphertext && decryptToken(connection.tokenCiphertext, connection.userId, connection.broker);
    if (!token || !connection.queryId) {
      await recordFailure(connection.id, "needs-attention", "TOKEN_UNREADABLE");
      return { ok: false, message: UNREADABLE };
    }
    try {
      report = parseFlexReport(await downloadFlexReport(token, connection.queryId, deps.flex));
    } catch (err) {
      const failure = err instanceof FlexError ? err : new FlexError("UNAVAILABLE");
      await recordFailure(
        connection.id,
        failure.needsAttention ? "needs-attention" : "error",
        failure.code ?? failure.category,
      );
      return { ok: false, message: flexErrorWords(failure) };
    }
    const confirmQueryId = ((connection.details ?? {}) as ConnectionDetails).confirmQueryId;
    if (confirmQueryId) {
      const confirmed = await readConfirmations(token, confirmQueryId, report, deps.flex);
      report = confirmed.report;
      if (confirmed.note) extraNotes.push(confirmed.note);
      if (confirmed.failure) console.warn(`[brokers] confirmations for #${connection.id} not read: ${confirmed.failure}`);
    }
  }

  try {
    const outcome = await applyReport(connection, report, details);
    if (outcome.ok) {
      // Counts only: what came in and what changed, never an amount or a name.
      const confirmed = report.executions.filter((e) => isProvisional(e.externalId)).length;
      console.info(
        `[brokers] synced ${connection.broker} #${connection.id}: statement to ${report.toDate ?? "?"}, ` +
          `${report.executions.length} fills read (${confirmed} from today's confirmations), ` +
          `${outcome.positions} holdings, ${outcome.tradesAdded} trades added, ${outcome.tradesUpdated} updated, ` +
          `${report.skipped.length} not shown, ${extraNotes.length + outcome.notes.length} notes`,
      );
    }
    return outcome.ok ? { ...outcome, notes: [...extraNotes, ...outcome.notes] } : outcome;
  } catch (err) {
    // The database's own message can name tables and values; only its class is logged.
    console.error("[brokers] applying a report failed:", err instanceof Error ? err.name : "unknown");
    await recordFailure(connection.id, "error", "SYNC_FAILED");
    return { ok: false, message: FAILED };
  }
}

/**
 * Connections due a nightly sync, stalest first.
 *
 * Skips the ones waiting on their reader — an expired token stays expired
 * however often it is tried — the ones another run holds, and uploaded
 * statements, which only the reader can refresh.
 *
 * A SnapTrade connection is due once its trades were last read a day ago,
 * so every background sync reads them, and a reader's own "Sync now" in
 * between (holdings only) does not push the next read back.
 */
export async function connectionsDue(limit: number): Promise<{ id: number; userId: string }[]> {
  return getDb()
    .select({ id: brokerConnections.id, userId: brokerConnections.userId })
    .from(brokerConnections)
    .where(
      and(
        ne(brokerConnections.broker, IBKR_UPLOAD),
        sql`${brokerConnections.status} <> 'needs-attention'`,
        or(
          isNull(brokerConnections.lastSyncedAt),
          and(
            ne(brokerConnections.broker, SNAPTRADE),
            lt(brokerConnections.lastSyncedAt, sql`now() - interval '20 hours'`),
          ),
          // Reading today's fills: every few hours, the most IBKR suggests for these reports.
          and(
            eq(brokerConnections.broker, IBKR_FLEX),
            sql`${brokerConnections.details} ->> 'confirmQueryId' is not null`,
            lt(brokerConnections.lastSyncedAt, sql`now() - interval '3 hours'`),
          ),
          and(
            eq(brokerConnections.broker, SNAPTRADE),
            sql`coalesce((${brokerConnections.details} ->> 'tradesReadAt')::timestamptz, ${brokerConnections.lastSyncedAt}) < now() - interval '24 hours'`,
          ),
        ),
        or(isNull(brokerConnections.lastAttemptAt), lt(brokerConnections.lastAttemptAt, RETRY_AFTER)),
        or(isNull(brokerConnections.syncStartedAt), lt(brokerConnections.syncStartedAt, LEASE_EXPIRED)),
      ),
    )
    .orderBy(sql`${brokerConnections.lastSyncedAt} asc nulls first`)
    .limit(limit);
}
