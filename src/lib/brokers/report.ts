/**
 * One shape for what any broker source reports, and the table of sources.
 *
 * A reader's holdings and fills can arrive three ways — a Flex token the site
 * owner connected, a statement file a reader uploaded, or SnapTrade — and
 * everything downstream (storing, pairing into journal trades, the portfolio)
 * works on this shape alone, so it cannot tell which one it was given.
 */

export interface ReportPosition {
  accountId: string;
  /** The source's own instrument id, which survives a ticker change. */
  conid: string;
  /** In this app's notation: AAPL, RY.TO, BRK.B. */
  symbol: string;
  quantity: number;
  /** Per share, in `currency`. */
  averageCost: number;
  currency: string;
  reportDate: string | null;
  /** The institution holding it, for display: "Interactive Brokers", "Wealthsimple". */
  label: string | null;
}

export interface ReportExecution {
  accountId: string;
  conid: string;
  /** The source's own id for the fill, so an overlapping download is harmless. */
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
  label: string | null;
}

export interface SkippedItem {
  symbol: string;
  reason: string;
}

export interface BrokerReport {
  accounts: string[];
  /** The last day the report covers, ISO. */
  toDate: string | null;
  positions: ReportPosition[];
  executions: ReportExecution[];
  /** What was in the report and is not shown, one entry per symbol. */
  skipped: SkippedItem[];
  /**
   * Every stock position the report lists, long or short, shown here or not,
   * keyed by `positionKey`. The journal needs the true holding to tell a
   * trade opened inside the report's window from one opened before it.
   */
  reportedQuantities: Record<string, number>;
  /** Whether the report carries each kind of data this app reads. */
  sections: { positions: boolean; trades: boolean };
}

/** How a holding is keyed across accounts: the source's instrument id within one account. */
export function positionKey(accountId: string, conid: string): string {
  return `${accountId}|${conid}`;
}

/** Enough to explain what is missing without storing a reader's whole history of oddities. */
const MAX_SKIPPED = 50;

/**
 * The "not shown" list, one entry per symbol.
 *
 * An option held and traded is one thing not shown, not two, so the first
 * reason given for a symbol is the one kept.
 */
export function skipList() {
  const items = new Map<string, SkippedItem>();
  return {
    add(symbol: string | undefined | null, reason: string) {
      const name = symbol?.trim() || "(unnamed)";
      if (!items.has(name) && items.size < MAX_SKIPPED) items.set(name, { symbol: name, reason });
    },
    list: () => [...items.values()],
  };
}

/* ----------------------------------------------------------------- sources */

export type BrokerKind = "ibkr-flex" | "ibkr-upload" | "snaptrade";

export interface BrokerSource {
  /** What the reader sees it called. */
  label: string;
  /**
   * Which journal links it shares. A Flex token and an uploaded statement
   * carry the same IBKR fill ids, so they share one family and a trade seen
   * through both is added once.
   */
  linkFamily: string;
  /** Whether the nightly job refreshes it. An upload is the reader's to refresh. */
  syncs: boolean;
}

export const BROKERS: Readonly<Record<BrokerKind, BrokerSource>> = {
  "ibkr-flex": { label: "Interactive Brokers", linkFamily: "ibkr-flex", syncs: true },
  "ibkr-upload": { label: "Interactive Brokers", linkFamily: "ibkr-flex", syncs: false },
  snaptrade: { label: "SnapTrade", linkFamily: "snaptrade", syncs: true },
};

export function isBrokerKind(value: string): value is BrokerKind {
  return value in BROKERS;
}

/** A short badge for a synced row: the institution when known, else the source. */
export function badgeFor(label: string | null | undefined): string {
  if (!label) return "Broker";
  return /interactive brokers/i.test(label) ? "IBKR" : label;
}
