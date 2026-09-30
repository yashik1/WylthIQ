import { isProvisional } from "./ibkr-flex";
import { positionKey, type BrokerReport, type ReportExecution, type SkippedItem } from "./report";

/**
 * Today's fills from IBKR's Trade Confirmation report, alongside the Activity
 * statement that stops at the last full day.
 *
 * The statement stays the record. A confirmed fill is stored provisionally,
 * under an id marked as such, and adds to the journal straight away; once a
 * statement covers its day, the statement's own copy of the fill takes its
 * place, and any journal trade it opened is re-pointed at that copy, so the
 * trade is neither lost nor added twice.
 */

/** A statement with the fills confirmed since it was drawn up added in. */
export function withConfirmations(
  report: BrokerReport,
  confirms: { executions: ReportExecution[]; skipped: SkippedItem[] },
): BrokerReport {
  const named = new Set(report.skipped.map((s) => s.symbol));
  return {
    ...report,
    executions: [...report.executions, ...confirms.executions],
    skipped: [...report.skipped, ...confirms.skipped.filter((s) => !named.has(s.symbol))],
  };
}

interface StoredFill {
  accountId: string;
  conid: string;
  externalId: string;
  quantity: number;
  price: number;
  tradeDate: string;
  executedAt: string;
}

/**
 * The holding each instrument had after every fill on record, for pairing.
 *
 * The statement's holdings are as of its last day. Pairing starts each
 * instrument from what was held before the first fill on record, worked out
 * as the holding less every fill; a provisional fill from after the statement
 * is not in that holding yet, so it is added to it first, or today's purchase
 * would be mistaken for shares held before the record began.
 */
export function holdingsAfterLaterFills(
  reported: Record<string, number>,
  fills: StoredFill[],
  statementTo: string | null,
): Record<string, number> {
  const holdings = { ...reported };
  for (const fill of fills) {
    if (!isProvisional(fill.externalId)) continue;
    if (statementTo && fill.tradeDate <= statementTo) continue;
    const key = positionKey(fill.accountId, fill.conid);
    holdings[key] = (holdings[key] ?? 0) + fill.quantity;
  }
  return holdings;
}

/**
 * For each provisional fill a statement now covers, the statement's copy of
 * it: the same IBKR execution id where the two reports agree on it, or else
 * the same account, contract, time, size and price — each statement fill
 * claimed once. Null where the statement has no such fill (a trade IBKR
 * cancelled), and the provisional copy is simply dropped.
 */
export function matchProvisional(
  provisional: StoredFill[],
  statement: ReportExecution[],
): { provisionalId: string; statementId: string | null }[] {
  const recorded = statement.filter((e) => !isProvisional(e.externalId));
  const claimed = new Set<string>();
  const matched = new Map<string, string>();

  // Ids first, for every fill, so a lookalike cannot take a fill another claims by id.
  for (const fill of provisional) {
    const base = fill.externalId.slice(fill.externalId.indexOf(":") + 1);
    const byId = recorded.find((e) => e.externalId === base && !claimed.has(e.externalId));
    if (byId) {
      claimed.add(byId.externalId);
      matched.set(fill.externalId, byId.externalId);
    }
  }
  for (const fill of provisional) {
    if (matched.has(fill.externalId)) continue;
    const alike = recorded.find(
      (e) =>
        !claimed.has(e.externalId) &&
        e.accountId === fill.accountId &&
        e.conid === fill.conid &&
        e.executedAt === fill.executedAt &&
        Math.abs(e.quantity - fill.quantity) < 1e-9 &&
        Math.abs(e.price - fill.price) < 1e-9,
    );
    if (alike) {
      claimed.add(alike.externalId);
      matched.set(fill.externalId, alike.externalId);
    }
  }

  return provisional.map((fill) => ({ provisionalId: fill.externalId, statementId: matched.get(fill.externalId) ?? null }));
}
