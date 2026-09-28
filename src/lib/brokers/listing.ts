/**
 * A broker's ticker, written the way this app writes it.
 *
 * Every source names a listing differently — IBKR by its own venue codes,
 * SnapTrade by ISO market identifier codes — but once the market is known the
 * rest is the same everywhere: a US share class takes a dot (BRK.B, as the US
 * price sources write it), a Toronto one a dash (BBD-B.TO, as Yahoo writes
 * it), and Canadian listings take the suffix of their exchange.
 *
 * Only markets that can be placed with certainty are mapped. A wrong suffix
 * opens a different security under the same letters, which is worse than
 * showing nothing, so everything else is reported as not shown.
 */

export type Market = "US" | "TO" | "V";

export type MappedSymbol = { ok: true; symbol: string } | { ok: false; reason: string };

export const OUTSIDE_COVERAGE = "listed outside the US and Canada, or in another currency";

/** The currency a listing on each market trades in. A different one is a different line. */
const MARKET_CURRENCY: Record<Market, string> = { US: "USD", TO: "CAD", V: "CAD" };

/** Whether a listing's currency agrees with its market. */
export function currencyFits(market: Market, currency: string | null | undefined): boolean {
  return currency?.trim().toUpperCase() === MARKET_CURRENCY[market];
}

/**
 * The ticker in this app's notation for a market already decided.
 *
 * Accepts a class written with a space, dot, dash or slash — "BRK B",
 * "BRK.B", "BRK-B", "BRK/B" — since each source picks a different one.
 */
export function formatTicker(ticker: string, market: Market): MappedSymbol {
  const parts = ticker.trim().toUpperCase().split(/[ ./-]+/).filter(Boolean);
  const [base, ...classes] = parts;
  if (!base || !/^[A-Z0-9]{1,6}$/.test(base) || classes.length > 1) {
    return { ok: false, reason: "a ticker this app cannot address" };
  }
  const shareClass = classes[0];

  if (market === "US") {
    if (shareClass && !/^[A-Z]{1,2}$/.test(shareClass)) return { ok: false, reason: "a ticker this app cannot address" };
    return { ok: true, symbol: shareClass ? `${base}.${shareClass}` : base };
  }

  if (shareClass && !/^[A-Z]{1,3}$/.test(shareClass)) return { ok: false, reason: "a ticker this app cannot address" };
  return { ok: true, symbol: `${shareClass ? `${base}-${shareClass}` : base}.${market}` };
}
