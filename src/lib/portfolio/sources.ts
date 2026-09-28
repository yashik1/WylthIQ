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

export interface PortfolioInput {
  key: string;
  source: "manual" | "synced";
  /** For a synced holding, the institution: "Interactive Brokers", "Wealthsimple". */
  sourceLabel: string | null;
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
  /** Which connection it came from: two connections to one broker are kept apart. */
  source: string;
  label: string | null;
  symbol: string;
  quantity: number;
  averageCost: number;
  currency: string;
  reportDate: string | null;
}

export interface Overlap {
  symbol: string;
  /** Where each copy came from, in words: "entered by hand", "Interactive Brokers". */
  from: string[];
}

const BY_HAND = "entered by hand";

/**
 * One row per source and company.
 *
 * A broker's holdings arrive per account; the same company in two accounts at
 * the same broker is one row here, at the combined size and the cost-weighted
 * average — which is how the broker itself totals them. Two different
 * connections are never combined, even to the same broker: that is exactly
 * the case where the same shares could be counted twice.
 */
export function toPortfolioInputs(
  manual: ManualHolding[],
  broker: BrokerHolding[],
): { inputs: PortfolioInput[]; overlaps: Overlap[] } {
  const synced = new Map<string, PortfolioInput>();
  for (const row of broker) {
    if (!(row.quantity > 0)) continue;
    const key = `synced:${row.source}:${row.label ?? ""}:${row.symbol}:${row.currency}`;
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
      source: "synced",
      sourceLabel: row.label,
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
    sourceLabel: null,
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
    (a, b) => a.symbol.localeCompare(b.symbol) || order[a.source] - order[b.source],
  );

  /*
    An overlap is a company held both by hand and synced, or synced twice from
    the same institution through two connections. The same company at two
    different brokers is two real holdings, and not flagged.
  */
  const overlaps: Overlap[] = [];
  const bySymbol = new Map<string, PortfolioInput[]>();
  for (const input of inputs) bySymbol.set(input.symbol, [...(bySymbol.get(input.symbol) ?? []), input]);
  for (const [symbol, rows] of bySymbol) {
    if (rows.length < 2) continue;
    const labels = rows.filter((r) => r.source === "synced").map((r) => r.sourceLabel ?? "a connected broker");
    const handAndSynced = rows.some((r) => r.source === "manual") && labels.length > 0;
    const syncedTwice = new Set(labels).size < labels.length;
    if (!handAndSynced && !syncedTwice) continue;
    const from = rows.map((r) => (r.source === "manual" ? BY_HAND : (r.sourceLabel ?? "a connected broker")));
    overlaps.push({ symbol, from });
  }

  return { inputs, overlaps };
}
