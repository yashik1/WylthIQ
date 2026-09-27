/**
 * Fills, paired into the round trips the trade journal records.
 *
 * A broker reports single fills — bought 10, bought 5, sold 15 — while a
 * journal row is a whole position from entry to exit. The grouping used here
 * is the one trading journals generally use: a trade opens when the position
 * in an instrument leaves zero and closes when it returns there. Adding to it
 * and trimming it along the way belong to the same trade, and the entry and
 * exit are each the volume-weighted price of the fills on that side.
 *
 * Grouped by the broker's instrument id rather than the ticker, so a company
 * that renames its ticker mid-trade stays one trade.
 *
 * THE WINDOW PROBLEM. A report covers a period — a year, typically — and a
 * holding bought before that period shows up only as its later sales. Walked
 * from zero, selling shares bought two years ago looks exactly like opening a
 * short. So each instrument is seeded with the position it must have held
 * before the first fill on record: what the broker reports holding now, less
 * every fill since. Fills that only unwind that earlier position belong to a
 * trade whose opening is not on record, and are left out rather than turned
 * into a trade that never happened. A stock split, which moves the holding
 * without a fill, trips the same check and fails the same safe way.
 */

export interface Fill {
  accountId: string;
  conid: string;
  externalId: string;
  symbol: string;
  /** Signed: positive bought, negative sold. */
  quantity: number;
  price: number;
  /** Always positive. */
  commission: number;
  commissionCurrency: string | null;
  currency: string;
  /** ISO date. */
  tradeDate: string;
  /** Sortable ISO date-time. */
  executedAt: string;
}

export interface RoundTrip {
  accountId: string;
  conid: string;
  /** The external id of the fill that opened it: its identity across syncs. */
  openingExternalId: string;
  symbol: string;
  currency: string;
  side: "long" | "short";
  /** Everything opened, in shares. */
  quantity: number;
  entryPrice: number;
  /** Null while any of the position is still held. */
  exitPrice: number | null;
  /** Commissions in the trade's own currency, for the whole round trip. */
  fees: number;
  /** ISO dates. */
  openedAt: string;
  closedAt: string | null;
}

/** Fractional shares make exact zero comparisons unreliable. */
const EPSILON = 1e-6;

const isZero = (n: number) => Math.abs(n) < EPSILON;

interface OpenTrade {
  /** False for a trade opened before the fills on record, which is never reported. */
  known: boolean;
  openingExternalId: string;
  side: "long" | "short";
  symbol: string;
  currency: string;
  entryShares: number;
  entryCost: number;
  exitShares: number;
  exitProceeds: number;
  fees: number;
  openedAt: string;
}

function finish(trade: OpenTrade, accountId: string, conid: string, closedAt: string | null): RoundTrip {
  return {
    accountId,
    conid,
    openingExternalId: trade.openingExternalId,
    symbol: trade.symbol,
    currency: trade.currency,
    side: trade.side,
    quantity: trade.entryShares,
    entryPrice: trade.entryCost / trade.entryShares,
    exitPrice: closedAt ? trade.exitProceeds / trade.exitShares : null,
    fees: trade.fees,
    openedAt: trade.openedAt,
    closedAt,
  };
}

/** Round trips for one instrument in one account, fills in any order. */
function pairInstrument(fills: Fill[], reportedQuantity: number): RoundTrip[] {
  const ordered = [...fills].sort(
    (a, b) => a.executedAt.localeCompare(b.executedAt) || a.externalId.localeCompare(b.externalId),
  );
  if (ordered.length === 0) return [];
  const { accountId, conid } = ordered[0];

  const filled = ordered.reduce((sum, f) => sum + f.quantity, 0);
  let position = reportedQuantity - filled;
  if (isZero(position)) position = 0;

  // A holding from before the record opens as a trade that is never reported.
  let open: OpenTrade | null =
    position === 0
      ? null
      : {
          known: false,
          openingExternalId: "",
          side: position > 0 ? "long" : "short",
          symbol: ordered[0].symbol,
          currency: ordered[0].currency,
          entryShares: Math.abs(position),
          entryCost: 0,
          exitShares: 0,
          exitProceeds: 0,
          fees: 0,
          openedAt: "",
        };

  const trips: RoundTrip[] = [];

  for (const fill of ordered) {
    let remaining = fill.quantity;
    const size = Math.abs(fill.quantity);
    const feeCounts = !fill.commissionCurrency || fill.commissionCurrency === fill.currency;

    while (!isZero(remaining)) {
      if (!open) {
        open = {
          known: true,
          openingExternalId: fill.externalId,
          side: remaining > 0 ? "long" : "short",
          symbol: fill.symbol,
          currency: fill.currency,
          entryShares: 0,
          entryCost: 0,
          exitShares: 0,
          exitProceeds: 0,
          fees: 0,
          openedAt: fill.tradeDate,
        };
      }

      // The latest ticker wins, so a renamed company is journalled by its current name.
      open.symbol = fill.symbol;
      const adding = open.side === "long" ? remaining > 0 : remaining < 0;
      // The part of this fill that applies to the open trade: all of it when
      // adding, and no more than is held when reducing — the rest of a fill
      // that crosses zero opens the next trade on the following pass.
      const shares = adding ? Math.abs(remaining) : Math.min(Math.abs(remaining), Math.abs(position));
      const signed = Math.sign(remaining) * shares;

      if (adding) {
        open.entryShares += shares;
        open.entryCost += shares * fill.price;
      } else {
        open.exitShares += shares;
        open.exitProceeds += shares * fill.price;
      }
      if (feeCounts) open.fees += fill.commission * (shares / size);

      position += signed;
      remaining -= signed;
      if (isZero(position)) position = 0;

      if (position === 0) {
        if (open.known) trips.push(finish(open, accountId, conid, fill.tradeDate));
        open = null;
      }
    }
  }

  if (open?.known) trips.push(finish(open, accountId, conid, null));
  return trips;
}

/**
 * Every round trip in a set of fills.
 *
 * `reportedQuantities` is what the broker says is held now, keyed by
 * `${accountId}|${conid}`; an instrument missing from it is held at zero.
 */
export function pairRoundTrips(fills: Fill[], reportedQuantities: Record<string, number>): RoundTrip[] {
  const groups = new Map<string, Fill[]>();
  for (const fill of fills) {
    const key = `${fill.accountId}|${fill.conid}`;
    const group = groups.get(key);
    if (group) group.push(fill);
    else groups.set(key, [fill]);
  }

  const trips: RoundTrip[] = [];
  for (const [key, group] of groups) trips.push(...pairInstrument(group, reportedQuantities[key] ?? 0));
  return trips.sort((a, b) => a.openedAt.localeCompare(b.openedAt) || a.openingExternalId.localeCompare(b.openingExternalId));
}
