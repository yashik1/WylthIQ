/**
 * Holdings from every source a reader has, as one list for the portfolio.
 *
 * Holdings typed in by hand, and holdings synced from the reader's brokers —
 * through SnapTrade, an uploaded statement, or a Flex token. When two of them
 * name the same company the app cannot tell "the same shares seen twice" from
 * "shares held in two places", so it does not guess. Each is shown, counted as
 * what it says, and the overlap is named so the reader can remove whichever is
 * a duplicate.
 */

import { accountTypeLabel, type AccountType } from "./account-types";

export interface PortfolioInput {
  key: string;
  source: "manual" | "synced";
  /** For a synced holding, the institution: "Interactive Brokers", "Wealthsimple". */
  sourceLabel: string | null;
  /** For a synced holding, the connection it came through: "snaptrade", "ibkr-flex", "ibkr-upload". */
  connection: string | null;
  /** For a hand-entered holding, its row. */
  holdingId: number | null;
  /** For a synced holding, the broker's account, and that account described: "TFSA ···1234". */
  accountId: string | null;
  account: string | null;
  /** The kind of account it sits in: TFSA, RRSP… Null when neither the broker nor the reader said. */
  accountType: AccountType | null;
  symbol: string;
  quantity: number;
  /** Per share. */
  averageCost: number;
  purchaseDate: string | null;
  /** The currency the source reported, or null when it did not say (hand-entered). */
  currency: string | null;
  /** For a synced holding, the date the broker's figures are as of. */
  reportedAt: string | null;
}

interface ManualHolding {
  id: number;
  symbol: string;
  quantity: number;
  averageCost: number;
  purchaseDate: string | null;
  accountType: AccountType | null;
}

interface BrokerHolding {
  /** Which connection it came from: two connections to one broker are kept apart. */
  source: string;
  label: string | null;
  accountId: string;
  account: string | null;
  accountType: AccountType | null;
  symbol: string;
  quantity: number;
  averageCost: number;
  currency: string;
  reportDate: string | null;
}

export interface Overlap {
  symbol: string;
  /** Where each copy came from, in words: "entered by hand (TFSA)", "Interactive Brokers (RRSP)". */
  from: string[];
}

const BY_HAND = "entered by hand";

function whereFrom(input: PortfolioInput): string {
  const place = input.source === "manual" ? BY_HAND : (input.sourceLabel ?? "a connected broker");
  return input.accountType ? `${place} (${accountTypeLabel(input.accountType)})` : place;
}

/** Whether two holdings could be in the same account, as far as their types say. */
function sameKindPossible(a: PortfolioInput, b: PortfolioInput): boolean {
  return !a.accountType || !b.accountType || a.accountType === b.accountType;
}

/**
 * One row per source, account and company.
 *
 * A broker's holdings arrive per account, and stay per account: the same ETF
 * in a TFSA and in an RRSP is two holdings, in two kinds of account. Two
 * different connections are never combined, even to the same broker: that is
 * exactly the case where the same shares could be counted twice.
 */
export function toPortfolioInputs(
  manual: ManualHolding[],
  broker: BrokerHolding[],
): { inputs: PortfolioInput[]; overlaps: Overlap[] } {
  const synced = new Map<string, PortfolioInput>();
  for (const row of broker) {
    if (!(row.quantity > 0)) continue;
    const key = `synced:${row.source}:${row.accountId}:${row.symbol}:${row.currency}`;
    const existing = synced.get(key);
    if (existing) {
      // The same company listed twice in one account, under two of the broker's ids for it.
      const quantity = existing.quantity + row.quantity;
      existing.averageCost = (existing.averageCost * existing.quantity + row.averageCost * row.quantity) / quantity;
      existing.quantity = quantity;
      if (row.reportDate && (!existing.reportedAt || row.reportDate > existing.reportedAt)) {
        existing.reportedAt = row.reportDate;
      }
      continue;
    }
    synced.set(key, {
      key,
      source: "synced",
      sourceLabel: row.label,
      connection: row.source,
      holdingId: null,
      accountId: row.accountId,
      account: row.account,
      accountType: row.accountType,
      symbol: row.symbol,
      quantity: row.quantity,
      averageCost: row.averageCost,
      purchaseDate: null,
      currency: row.currency,
      reportedAt: row.reportDate,
    });
  }

  const typed: PortfolioInput[] = manual.map((row) => ({
    key: `manual:${row.id}`,
    source: "manual",
    sourceLabel: null,
    connection: null,
    holdingId: row.id,
    accountId: null,
    account: null,
    accountType: row.accountType,
    symbol: row.symbol,
    quantity: row.quantity,
    averageCost: row.averageCost,
    purchaseDate: row.purchaseDate,
    currency: null,
    reportedAt: null,
  }));

  // By company, and within a company what the reader typed before what was synced.
  const order = { manual: 0, synced: 1 } as const;
  const inputs = [...typed, ...synced.values()].sort(
    (a, b) =>
      a.symbol.localeCompare(b.symbol) ||
      order[a.source] - order[b.source] ||
      accountTypeLabel(a.accountType).localeCompare(accountTypeLabel(b.accountType)),
  );

  /*
    An overlap is a company held both by hand and synced, in accounts that
    could be the same one — no type set on either, or the same type — or
    synced from the same institution through two connections. The same company
    in two accounts, or at two different brokers, is two real holdings, and
    not flagged.
  */
  const overlaps: Overlap[] = [];
  const bySymbol = new Map<string, PortfolioInput[]>();
  for (const input of inputs) bySymbol.set(input.symbol, [...(bySymbol.get(input.symbol) ?? []), input]);
  for (const [symbol, rows] of bySymbol) {
    if (rows.length < 2) continue;
    const typedRows = rows.filter((r) => r.source === "manual");
    const syncedRows = rows.filter((r) => r.source === "synced");
    const handAndSynced = typedRows.some((t) => syncedRows.some((s) => sameKindPossible(t, s)));

    const connectionsByLabel = new Map<string, Set<string | null>>();
    for (const row of syncedRows) {
      const label = row.sourceLabel ?? "a connected broker";
      connectionsByLabel.set(label, (connectionsByLabel.get(label) ?? new Set()).add(row.connection));
    }
    const syncedTwice = [...connectionsByLabel.values()].some((connections) => connections.size > 1);
    if (!handAndSynced && !syncedTwice) continue;
    overlaps.push({ symbol, from: rows.map(whereFrom) });
  }

  return { inputs, overlaps };
}
