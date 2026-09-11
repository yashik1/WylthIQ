/**
 * What a set of holdings is worth, and how it has done against its cost.
 *
 * Totals are kept per currency. Adding a Toronto holding's Canadian dollars
 * to a New York holding's US dollars would produce a number in no currency at
 * all, so each currency gets its own total and allocation, and the page says
 * so when there is more than one.
 *
 * A holding with no price is listed at cost with no value, rather than valued
 * at zero or at cost — either would be a figure the data does not support.
 */

export interface PricedHolding {
  symbol: string;
  name: string | null;
  quantity: number;
  averageCost: number;
  purchaseDate: string | null;
  price: number | null;
  currency: string;
  /** When the price was set, as an ISO date-time or date. */
  priceAsOf: string | null;
  /** Where the price came from: the stored nightly quote, or a live lookup. */
  priceSource: "stored" | "live" | null;
}

export interface ValuedHolding extends PricedHolding {
  cost: number;
  value: number | null;
  gain: number | null;
  gainPercent: number | null;
  /** Share of this currency's priced value. */
  allocation: number | null;
}

export interface CurrencyTotal {
  currency: string;
  cost: number;
  /** Value of the priced holdings only. */
  value: number;
  /** Gain on the priced holdings only, against their own cost. */
  gain: number;
  gainPercent: number | null;
  priced: number;
  unpriced: number;
}

export function valueHoldings(holdings: PricedHolding[]): {
  holdings: ValuedHolding[];
  totals: CurrencyTotal[];
} {
  const totals = new Map<string, CurrencyTotal & { pricedCost: number }>();

  const valued = holdings.map((holding) => {
    const cost = holding.quantity * holding.averageCost;
    const value = holding.price != null ? holding.quantity * holding.price : null;
    const gain = value != null ? value - cost : null;

    const total =
      totals.get(holding.currency) ??
      { currency: holding.currency, cost: 0, value: 0, gain: 0, gainPercent: null, priced: 0, unpriced: 0, pricedCost: 0 };
    total.cost += cost;
    if (value != null) {
      total.value += value;
      total.pricedCost += cost;
      total.priced += 1;
    } else {
      total.unpriced += 1;
    }
    totals.set(holding.currency, total);

    return {
      ...holding,
      cost,
      value,
      gain,
      gainPercent: gain != null && cost > 0 ? gain / cost : null,
      allocation: null as number | null,
    };
  });

  for (const holding of valued) {
    const total = totals.get(holding.currency);
    if (holding.value != null && total && total.value > 0) holding.allocation = holding.value / total.value;
  }

  return {
    holdings: valued,
    totals: [...totals.values()]
      .map(({ pricedCost, ...total }) => ({
        ...total,
        gain: total.value - pricedCost,
        gainPercent: pricedCost > 0 ? (total.value - pricedCost) / pricedCost : null,
      }))
      .sort((a, b) => b.value - a.value),
  };
}
