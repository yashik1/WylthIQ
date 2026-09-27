/**
 * Holdings from every source a reader has, as one list for the portfolio.
 *
 * Two sources so far: holdings typed in by hand, and holdings synced from the
 * reader's broker. When both name the same company the app cannot tell "the
 * same shares entered twice" from "shares held at two brokers", so it does
 * not guess. Both rows are shown, counted as what they say, and the overlap is
 * named so the reader can remove whichever is a duplicate.
 */

export interface PortfolioInput {
  key: string;
  source: "manual" | "ibkr";
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
  symbol: string;
  quantity: number;
  averageCost: number;
  purchaseDate: string | null;
}

interface BrokerHolding {
  symbol: string;
  quantity: number;
  averageCost: number;
  currency: string;
  reportDate: string | null;
}

/**
 * One row per source and company.
 *
 * A broker's holdings arrive per account; the same company in two accounts at
 * the same broker is one row here, at the combined size and the cost-weighted
 * average — which is how the broker itself totals them.
 */
export function toPortfolioInputs(
  manual: ManualHolding[],
  broker: BrokerHolding[],
): { inputs: PortfolioInput[]; overlaps: string[] } {
  const synced = new Map<string, PortfolioInput>();
  for (const row of broker) {
    if (!(row.quantity > 0)) continue;
    const key = `ibkr:${row.symbol}:${row.currency}`;
    const existing = synced.get(key);
    if (existing) {
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
      source: "ibkr",
      symbol: row.symbol,
      quantity: row.quantity,
      averageCost: row.averageCost,
      purchaseDate: null,
      currency: row.currency,
      reportedAt: row.reportDate,
    });
  }

  const typed: PortfolioInput[] = manual.map((row) => ({
    key: `manual:${row.symbol}`,
    source: "manual",
    symbol: row.symbol,
    quantity: row.quantity,
    averageCost: row.averageCost,
    purchaseDate: row.purchaseDate,
    currency: null,
    reportedAt: null,
  }));

  const syncedSymbols = new Set([...synced.values()].map((row) => row.symbol));
  const overlaps = [...new Set(typed.filter((row) => syncedSymbols.has(row.symbol)).map((row) => row.symbol))].sort();

  // By company, and within a company what the reader typed before what was synced.
  const order = { manual: 0, ibkr: 1 } as const;
  const inputs = [...typed, ...synced.values()].sort(
    (a, b) => a.symbol.localeCompare(b.symbol) || order[a.source] - order[b.source],
  );
  return { inputs, overlaps };
}
