import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "../db";
import {
  brokerConnections,
  brokerExecutions,
  brokerPositions,
  brokerTradeLinks,
  trades,
  type BrokerConnection,
} from "../db/schema";
import { decryptToken } from "./crypto";
import {
  downloadFlexReport,
  FLEX_ERROR_WORDS,
  FlexError,
  parseFlexReport,
  positionKey,
  type FlexDeps,
  type FlexReport,
  type SkippedItem,
} from "./ibkr-flex";
import { planJournalWrites, type ExistingLink } from "./journal-plan";
import { pairRoundTrips } from "./round-trips";

/**
 * Bringing a connected broker's figures into the app.
 *
 * Not a server action, on purpose: every exported function in a "use server"
 * file is an endpoint any browser can call with any arguments, and this one
 * takes a connection id. The actions in actions.ts decide whose connection it
 * is first; the nightly job is authenticated by the cron secret.
 */

export const IBKR_FLEX = "ibkr-flex";

/** How long a sync may hold its lease before another run may assume it died. */
const LEASE_EXPIRED = sql`now() - interval '10 minutes'`;
/** A connection that just failed is not retried by the nightly job for this long. */
const RETRY_AFTER = sql`now() - interval '1 hour'`;
/** More than any reader's holdings; a bound on what one report can write. */
const MAX_POSITIONS = 300;
/** Trades added per sync. More arrive on the next one, so a busy year is spread out, not refused. */
const MAX_JOURNAL_INSERTS = 2_000;
const INSERT_CHUNK = 500;

export type SyncOutcome =
  | {
      ok: true;
      positions: number;
      tradesAdded: number;
      tradesUpdated: number;
      /** Things the reader should know about this sync, in plain words. */
      notes: string[];
    }
  | { ok: false; message: string };

const BUSY = "A sync for this account is already running. Try again in a few minutes.";
const UNREADABLE =
  "The saved token can no longer be read on this server. Disconnect and connect again with your token.";
const FAILED = "The sync could not be saved. Try again later.";

function chunks<T>(rows: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

/** Holdings keyed by account and instrument, summed if a report listed one twice. */
function positionRows(connection: BrokerConnection, report: FlexReport) {
  const byKey = new Map<string, (typeof brokerPositions.$inferInsert)>();
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
    });
  }
  return [...byKey.values()].slice(0, MAX_POSITIONS);
}

/**
 * Writes one downloaded report: fills, holdings and the journal, in one
 * transaction, so a failure part-way leaves yesterday's figures standing
 * rather than half of today's.
 */
export async function applyReport(connection: BrokerConnection, report: FlexReport): Promise<SyncOutcome> {
  const notes: string[] = [];
  const skipped: SkippedItem[] = [...report.skipped];

  if (!report.sections.positions) {
    notes.push("The Flex query has no Open Positions section, so holdings were not updated.");
  }
  if (!report.sections.trades) {
    notes.push("The Flex query has no Trades section, so no trades were added to the journal.");
  }

  const result = await getDb().transaction(async (tx) => {
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
    // positions section gives; without it, trades opened before the record
    // could not be told from new ones, so the journal is left alone.
    if (report.sections.positions && report.sections.trades) {
      const fills = await tx
        .select()
        .from(brokerExecutions)
        .where(eq(brokerExecutions.connectionId, connection.id));
      const roundTrips = pairRoundTrips(fills, report.reportedQuantities);

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
        .where(and(eq(brokerTradeLinks.userId, connection.userId), eq(brokerTradeLinks.broker, connection.broker)));

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
            broker: connection.broker,
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
        lastSyncedAt: new Date(),
        syncStartedAt: null,
        updatedAt: new Date(),
      })
      .where(eq(brokerConnections.id, connection.id));

    return { positions, tradesAdded, tradesUpdated };
  });

  return { ok: true, ...result, notes };
}

/** Records a failure without keeping any of the broker's own wording. */
async function recordFailure(connectionId: number, status: "needs-attention" | "error", code: string) {
  await getDb()
    .update(brokerConnections)
    .set({ status, lastErrorCode: code, syncStartedAt: null, updatedAt: new Date() })
    .where(eq(brokerConnections.id, connectionId));
}

/**
 * Downloads and applies the latest report for one connection.
 *
 * Takes a lease first, in the database rather than in memory, so the nightly
 * job and a reader's "Sync now" cannot both run it — and neither can two
 * instances of the app.
 */
export async function syncConnection(connectionId: number, deps: FlexDeps = {}): Promise<SyncOutcome> {
  const db = getDb();
  const [connection] = await db
    .update(brokerConnections)
    .set({ syncStartedAt: new Date(), lastAttemptAt: new Date() })
    .where(
      and(
        eq(brokerConnections.id, connectionId),
        or(
          isNull(brokerConnections.syncStartedAt),
          lt(brokerConnections.syncStartedAt, LEASE_EXPIRED),
        ),
      ),
    )
    .returning();
  if (!connection) return { ok: false, message: BUSY };

  const token = decryptToken(connection.tokenCiphertext, connection.userId, connection.broker);
  if (!token) {
    await recordFailure(connection.id, "needs-attention", "TOKEN_UNREADABLE");
    return { ok: false, message: UNREADABLE };
  }

  let report: FlexReport;
  try {
    report = parseFlexReport(await downloadFlexReport(token, connection.queryId, deps));
  } catch (err) {
    const failure = err instanceof FlexError ? err : new FlexError("UNAVAILABLE");
    await recordFailure(
      connection.id,
      failure.needsAttention ? "needs-attention" : "error",
      failure.code ?? failure.category,
    );
    return { ok: false, message: FLEX_ERROR_WORDS[failure.category] };
  }

  try {
    return await applyReport(connection, report);
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
 * however often it is tried — and the ones another run holds.
 */
export async function connectionsDue(limit: number): Promise<{ id: number; userId: string }[]> {
  return getDb()
    .select({ id: brokerConnections.id, userId: brokerConnections.userId })
    .from(brokerConnections)
    .where(
      and(
        sql`${brokerConnections.status} <> 'needs-attention'`,
        or(
          isNull(brokerConnections.lastSyncedAt),
          lt(brokerConnections.lastSyncedAt, sql`now() - interval '20 hours'`),
        ),
        or(isNull(brokerConnections.lastAttemptAt), lt(brokerConnections.lastAttemptAt, RETRY_AFTER)),
        or(
          isNull(brokerConnections.syncStartedAt),
          lt(brokerConnections.syncStartedAt, LEASE_EXPIRED),
        ),
      ),
    )
    .orderBy(sql`${brokerConnections.lastSyncedAt} asc nulls first`)
    .limit(limit);
}
