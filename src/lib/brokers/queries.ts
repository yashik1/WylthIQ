import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { brokerConnections, brokerPositions, brokerTradeLinks } from "../db/schema";
import { IBKR_FLEX } from "./sync";
import type { SkippedItem } from "./ibkr-flex";

/**
 * Reads for the pages, each scoped to one reader in the query itself.
 *
 * Plain functions rather than server actions: they take a user id, and a
 * server action taking a user id would let any browser read anyone's. The
 * pages call these with the id from the reader's own session.
 */

export interface BrokerConnectionSummary {
  broker: string;
  tokenHint: string;
  queryId: string;
  status: "ok" | "needs-attention" | "error";
  lastErrorCode: string | null;
  statementToDate: string | null;
  skipped: SkippedItem[];
  lastSyncedAt: Date | null;
  lastAttemptAt: Date | null;
  journalSince: string;
  /** Accounts the last report covered, masked for display. */
  accounts: string[];
  positions: number;
  linkedTrades: number;
}

/** "U1234567" as "U•••4567": enough to tell accounts apart, not enough to be the number. */
export function maskAccount(accountId: string): string {
  const id = accountId.trim();
  if (id.length <= 5) return id;
  return `${id.slice(0, 1)}•••${id.slice(-4)}`;
}

export async function getBrokerConnection(userId: string): Promise<BrokerConnectionSummary | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const db = getDb();
    const [row] = await db
      .select()
      .from(brokerConnections)
      .where(and(eq(brokerConnections.userId, userId), eq(brokerConnections.broker, IBKR_FLEX)))
      .limit(1);
    if (!row) return null;

    const [accounts, [linked]] = await Promise.all([
      db
        .selectDistinct({ accountId: brokerPositions.accountId })
        .from(brokerPositions)
        .where(eq(brokerPositions.connectionId, row.id)),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(brokerTradeLinks)
        .where(
          and(
            eq(brokerTradeLinks.userId, userId),
            eq(brokerTradeLinks.broker, row.broker),
            isNotNull(brokerTradeLinks.tradeId),
          ),
        ),
    ]);
    const [{ count: positions }] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(brokerPositions)
      .where(eq(brokerPositions.connectionId, row.id));

    return {
      broker: row.broker,
      tokenHint: row.tokenHint,
      queryId: row.queryId,
      status: row.status === "needs-attention" || row.status === "error" ? row.status : "ok",
      lastErrorCode: row.lastErrorCode,
      statementToDate: row.statementToDate,
      skipped: Array.isArray(row.skipped) ? (row.skipped as SkippedItem[]) : [],
      lastSyncedAt: row.lastSyncedAt,
      lastAttemptAt: row.lastAttemptAt,
      journalSince: row.journalSince,
      accounts: accounts.map((a) => maskAccount(a.accountId)),
      positions,
      linkedTrades: linked?.count ?? 0,
    };
  } catch {
    // A missing table (migration not run yet) reads as "not connected", not as a broken page.
    return null;
  }
}

export interface BrokerHolding {
  symbol: string;
  quantity: number;
  averageCost: number;
  currency: string;
  reportDate: string | null;
}

/** The reader's synced holdings, one row per account and instrument. */
export async function listBrokerHoldings(userId: string): Promise<BrokerHolding[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    return await getDb()
      .select({
        symbol: brokerPositions.symbol,
        quantity: brokerPositions.quantity,
        averageCost: brokerPositions.averageCost,
        currency: brokerPositions.currency,
        reportDate: brokerPositions.reportDate,
      })
      .from(brokerPositions)
      .where(eq(brokerPositions.userId, userId));
  } catch {
    return [];
  }
}

/** Ids of the reader's journal trades that came from their broker. */
export async function syncedTradeIds(userId: string): Promise<Set<number>> {
  if (!isDatabaseConfigured()) return new Set();
  try {
    const rows = await getDb()
      .select({ tradeId: brokerTradeLinks.tradeId })
      .from(brokerTradeLinks)
      .where(and(eq(brokerTradeLinks.userId, userId), isNotNull(brokerTradeLinks.tradeId)));
    return new Set(rows.map((r) => r.tradeId!));
  } catch {
    return new Set();
  }
}
