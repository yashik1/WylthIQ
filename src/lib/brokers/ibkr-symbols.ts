/**
 * IBKR's way of naming a listing, turned into this app's.
 *
 * IBKR names a security by its ticker plus the exchange it lists on and the
 * currency it trades in; this app names it by a ticker with a suffix, the way
 * its price sources do — AAPL, RY.TO, BRK.B. Getting that wrong does not
 * fail loudly: it opens a different security under the same letters, which is
 * worse than showing nothing. So only venues that can be placed with
 * certainty are mapped, and everything else is reported as not shown.
 *
 * `suffixForListing` in exchange-suffix.ts is deliberately not used here: it
 * refuses "TSE", because that is Toronto to one provider and Tokyo to another.
 * IBKR's own codes are unambiguous — Tokyo is "TSEJ" there — so a table of
 * IBKR's codes can say what that general helper cannot. Writing the ticker
 * once the market is known is shared with the other sources, in listing.ts.
 */

import { currencyFits, formatTicker, OUTSIDE_COVERAGE, type Market, type MappedSymbol } from "./listing";

/** IBKR's codes for US venues. The currency must also be USD. */
const US_VENUES = new Set([
  "NASDAQ",
  "NYSE",
  "ARCA",
  "AMEX",
  "BATS",
  "IEX",
  "PINK",
  "NYSENAT",
  "CBOE",
]);

/** IBKR's codes for Canadian venues, and the market each is. The currency must be CAD. */
const CANADIAN_VENUES: Record<string, Market> = {
  TSE: "TO",
  VENTURE: "V",
};

export interface IbkrListing {
  symbol: string;
  listingExchange: string | undefined;
  currency: string | undefined;
}

export function appSymbol(listing: IbkrListing): MappedSymbol {
  const venue = listing.listingExchange?.trim().toUpperCase() ?? "";

  if (!venue) {
    return { ok: false, reason: "the report has no listing exchange — include every field in the Flex query" };
  }

  // IBKR writes a share class with a space, "BRK B", or on Toronto with a dot, "BBD.B".
  const market: Market | null = US_VENUES.has(venue) ? "US" : (CANADIAN_VENUES[venue] ?? null);
  if (!market || !currencyFits(market, listing.currency)) return { ok: false, reason: OUTSIDE_COVERAGE };
  return formatTicker(listing.symbol, market);
}
