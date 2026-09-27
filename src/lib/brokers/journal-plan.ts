import type { RoundTrip } from "./round-trips";

/**
 * What a sync should write to the trade journal.
 *
 * Pure, so every rule below is tested without a database. The rules:
 *
 * - A round trip already linked to a journal trade updates that trade, but
 *   only the fields the broker is the authority on — side, size, prices, fees
 *   and dates. The reader's own additions (strategy, notes, stop, target,
 *   whether they kept to their rules) are theirs and a sync never touches
 *   them.
 * - A link whose trade is gone means the reader deleted it. It stays deleted:
 *   bringing it back every night would make deleting pointless.
 * - A round trip with no link becomes a new trade, unless it opened before the
 *   date the reader chose to start from.
 */

/** The journal fields a sync owns. */
export interface SyncedTradeFields {
  symbol: string;
  side: "long" | "short";
  quantity: number;
  entryPrice: number;
  exitPrice: number | null;
  fees: number;
  openedAt: string;
  closedAt: string | null;
}

export interface ExistingLink {
  accountId: string;
  openingExternalId: string;
  /** Null when the reader deleted the trade. */
  tradeId: number | null;
  /** The linked trade as it stands, for deciding whether anything changed. */
  current: SyncedTradeFields | null;
}

export interface JournalPlan {
  inserts: { roundTrip: RoundTrip; fields: SyncedTradeFields }[];
  updates: { tradeId: number; fields: SyncedTradeFields }[];
  /** Round trips left alone because the reader deleted their trade. */
  keptDeleted: number;
  /** Round trips that opened before the reader's chosen start date. */
  beforeStart: number;
}

/** Prices are rounded before comparing, so float noise does not rewrite a row every night. */
function round(n: number | null): number | null {
  return n === null ? null : Math.round(n * 1e6) / 1e6;
}

export function fieldsFor(trip: RoundTrip): SyncedTradeFields {
  return {
    symbol: trip.symbol,
    side: trip.side,
    quantity: round(trip.quantity)!,
    entryPrice: round(trip.entryPrice)!,
    exitPrice: round(trip.exitPrice),
    fees: round(trip.fees)!,
    openedAt: trip.openedAt,
    closedAt: trip.closedAt,
  };
}

function same(a: SyncedTradeFields, b: SyncedTradeFields): boolean {
  return (
    a.symbol === b.symbol &&
    a.side === b.side &&
    round(a.quantity) === round(b.quantity) &&
    round(a.entryPrice) === round(b.entryPrice) &&
    round(a.exitPrice) === round(b.exitPrice) &&
    round(a.fees) === round(b.fees) &&
    a.openedAt === b.openedAt &&
    a.closedAt === b.closedAt
  );
}

export function planJournalWrites(
  roundTrips: RoundTrip[],
  links: ExistingLink[],
  journalSince: string,
): JournalPlan {
  const byKey = new Map(links.map((link) => [`${link.accountId}|${link.openingExternalId}`, link]));
  const plan: JournalPlan = { inserts: [], updates: [], keptDeleted: 0, beforeStart: 0 };

  for (const trip of roundTrips) {
    const fields = fieldsFor(trip);
    const link = byKey.get(`${trip.accountId}|${trip.openingExternalId}`);

    if (link) {
      if (link.tradeId === null) {
        plan.keptDeleted++;
      } else if (!link.current || !same(link.current, fields)) {
        plan.updates.push({ tradeId: link.tradeId, fields });
      }
      continue;
    }

    if (trip.openedAt < journalSince) {
      plan.beforeStart++;
      continue;
    }
    plan.inserts.push({ roundTrip: trip, fields });
  }

  return plan;
}
