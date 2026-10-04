import { brokerOf, HAND_ENTERED } from "./charts";
import type { ValuedHolding } from "./math";

/**
 * What is held where: the portfolio split by broker, each with what it holds.
 *
 * Amounts are in one currency so a broker's holdings can be added up and its
 * share of the whole worked out — the same currency, and the same rates, as
 * the charts. A holding with no price is still listed, so nothing held goes
 * missing from its broker, but adds nothing to the broker's value.
 */

export interface BrokerHoldingRow {
  key: string;
  symbol: string;
  name: string | null;
  quantity: number;
  /** In the summary's currency; null with no price or no exchange rate. */
  value: number | null;
  /** Share of this broker's value, 0 to 1. */
  share: number | null;
  gainPercent: number | null;
}

export interface BrokerSummary {
  /** The institution, or "Entered by hand". */
  name: string;
  synced: boolean;
  /**
   * The ways this broker is connected, when there is more than one: the same
   * shares are then probably counted once for each.
   */
  connectedTwice: string[];
  /** Priced holdings only, in the summary's currency. */
  value: number;
  cost: number;
  gain: number;
  gainPercent: number | null;
  /** Share of everything priced, 0 to 1. */
  share: number | null;
  /** For a synced broker, the latest date its figures are as of. */
  reportedAt: string | null;
  /** Largest first; the unpriced last. */
  holdings: BrokerHoldingRow[];
  /** Listed but not counted: no price, or no exchange rate. */
  uncounted: number;
}

/** How a connection is named when a broker turns out to be connected twice. */
const CONNECTION_WORDS: Record<string, string> = {
  snaptrade: "SnapTrade",
  "ibkr-flex": "a Flex token",
  "ibkr-upload": "an uploaded statement",
};

export function brokerSummaries(
  holdings: ValuedHolding[],
  /** A holding's rate into the summary's currency, or null where there is none. */
  rateFor: (currency: string) => number | null,
): BrokerSummary[] {
  const groups = new Map<string, ValuedHolding[]>();
  for (const holding of holdings) {
    const name = brokerOf(holding);
    groups.set(name, [...(groups.get(name) ?? []), holding]);
  }

  const summaries = [...groups].map(([name, rows]) => {
    let value = 0;
    let cost = 0;
    let uncounted = 0;
    const listed = rows.map((holding) => {
      const rate = rateFor(holding.currency);
      const converted = holding.value != null && rate != null ? holding.value * rate : null;
      if (converted == null) uncounted += 1;
      else {
        value += converted;
        cost += holding.cost * rate!;
      }
      return { holding, value: converted };
    });

    const connections = [...new Set(rows.map((r) => r.connection).filter((c): c is string => Boolean(c)))];
    const reported = rows.map((r) => r.reportedAt).filter((d): d is string => Boolean(d));

    return {
      name,
      synced: name !== HAND_ENTERED,
      connectedTwice: connections.length > 1 ? connections.map((c) => CONNECTION_WORDS[c] ?? c) : [],
      value,
      cost,
      gain: value - cost,
      gainPercent: cost > 0 ? (value - cost) / cost : null,
      share: null as number | null,
      reportedAt: reported.length > 0 ? reported.sort().at(-1)! : null,
      holdings: listed
        .sort((a, b) => (b.value ?? -1) - (a.value ?? -1) || a.holding.symbol.localeCompare(b.holding.symbol))
        .map(({ holding, value: v }) => ({
          key: holding.key,
          symbol: holding.symbol,
          name: holding.name,
          quantity: holding.quantity,
          value: v,
          share: v != null && value > 0 ? v / value : null,
          gainPercent: holding.gainPercent,
        })),
      uncounted,
    };
  });

  const total = summaries.reduce((sum, s) => sum + s.value, 0);
  for (const summary of summaries) summary.share = total > 0 ? summary.value / total : null;

  // Largest first, with what was typed in by hand after the brokers.
  return summaries.sort(
    (a, b) => Number(!a.synced) - Number(!b.synced) || b.value - a.value || a.name.localeCompare(b.name),
  );
}
