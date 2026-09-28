import { and, eq, isNotNull, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { brokerConnections, brokerExecutions, brokerPositions, brokerTradeLinks } from "../db/schema";
import { badgeFor, BROKERS, isBrokerKind, type BrokerKind, type SkippedItem } from "./report";
import type { ConnectionDetails } from "./sync";

/**
 * Reads for the pages, each scoped to one reader in the query itself.
 *
 * Plain functions rather than server actions: they take a user id, and a
 * server action taking a user id would let any browser read anyone's. The
 * pages call these with the id from the reader's own session.
 */

export interface BrokerConnectionSummary {
  broker: BrokerKind;
  tokenHint: string | null;
  queryId: string | null;
  status: "ok" | "needs-attention" | "error";
  lastErrorCode: string | null;
  statementToDate: string | null;
  skipped: SkippedItem[];
  details: ConnectionDetails;
  lastSyncedAt: Date | null;
  lastAttemptAt: Date | null;
  journalSince: string;
  positions: number;
  /** Journal trades added from this source (or another sharing its fill ids). */
  linkedTrades: number;
}

/** Every broker connection the reader has, one per source. */
export async function listBrokerConnections(userId: string): Promise<BrokerConnectionSummary[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    const db = getDb();
    const [rows, positions, links] = await Promise.all([
      db.select().from(brokerConnections).where(eq(brokerConnections.userId, userId)),
      db
        .select({ connectionId: brokerPositions.connectionId, count: sql<number>`count(*)::int` })
        .from(brokerPositions)
        .where(eq(brokerPositions.userId, userId))
        .groupBy(brokerPositions.connectionId),
      db
        .select({ family: brokerTradeLinks.broker, count: sql<number>`count(*)::int` })
        .from(brokerTradeLinks)
        .where(and(eq(brokerTradeLinks.userId, userId), isNotNull(brokerTradeLinks.tradeId)))
        .groupBy(brokerTradeLinks.broker),
    ]);
    const positionsBy = new Map(positions.map((p) => [p.connectionId, p.count]));
    const linksBy = new Map(links.map((l) => [l.family, l.count]));

    return rows.flatMap((row) => {
      if (!isBrokerKind(row.broker)) return [];
      return [
        {
          broker: row.broker,
          tokenHint: row.tokenHint,
          queryId: row.queryId,
          status: row.status === "needs-attention" || row.status === "error" ? row.status : "ok",
          lastErrorCode: row.lastErrorCode,
          statementToDate: row.statementToDate,
          skipped: Array.isArray(row.skipped) ? (row.skipped as SkippedItem[]) : [],
          details: (row.details ?? {}) as ConnectionDetails,
          lastSyncedAt: row.lastSyncedAt,
          lastAttemptAt: row.lastAttemptAt,
          journalSince: row.journalSince,
          positions: positionsBy.get(row.id) ?? 0,
          linkedTrades: linksBy.get(BROKERS[row.broker].linkFamily) ?? 0,
        },
      ];
    });
  } catch {
    // A missing table (migration not run yet) reads as "not connected", not as a broken page.
    return [];
  }
}

export interface BrokerHolding {
  /** The connection's source, so two connections to one broker stay apart. */
  source: string;
  symbol: string;
  quantity: number;
  averageCost: number;
  currency: string;
  reportDate: string | null;
  /** The institution holding it. */
  label: string | null;
}

/** The reader's synced holdings, one row per source, account and instrument. */
export async function listBrokerHoldings(userId: string): Promise<BrokerHolding[]> {
  if (!isDatabaseConfigured()) return [];
  try {
    return await getDb()
      .select({
        source: brokerConnections.broker,
        symbol: brokerPositions.symbol,
        quantity: brokerPositions.quantity,
        averageCost: brokerPositions.averageCost,
        currency: brokerPositions.currency,
        reportDate: brokerPositions.reportDate,
        label: brokerPositions.label,
      })
      .from(brokerPositions)
      .innerJoin(brokerConnections, eq(brokerConnections.id, brokerPositions.connectionId))
      .where(eq(brokerPositions.userId, userId));
  } catch {
    return [];
  }
}

/**
 * The reader's journal trades that came from a broker, each with the short
 * name to badge it with: the institution when the fill that opened it is
 * still on record, and the source's own name when it is not.
 */
export async function syncedTradeBadges(userId: string): Promise<Map<number, string>> {
  if (!isDatabaseConfigured()) return new Map();
  try {
    const rows = await getDb()
      .select({ tradeId: brokerTradeLinks.tradeId, family: brokerTradeLinks.broker, label: brokerExecutions.label })
      .from(brokerTradeLinks)
      .leftJoin(
        brokerExecutions,
        and(
          eq(brokerExecutions.userId, brokerTradeLinks.userId),
          eq(brokerExecutions.accountId, brokerTradeLinks.accountId),
          eq(brokerExecutions.externalId, brokerTradeLinks.openingExternalId),
        ),
      )
      .where(and(eq(brokerTradeLinks.userId, userId), isNotNull(brokerTradeLinks.tradeId)));

    const badges = new Map<number, string>();
    for (const row of rows) {
      const fallback = row.family === BROKERS["ibkr-flex"].linkFamily ? BROKERS["ibkr-flex"].label : null;
      badges.set(row.tradeId!, badgeFor(row.label ?? fallback));
    }
    return badges;
  } catch {
    return new Map();
  }
}
