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
 * IBKR's codes can say what that general helper cannot.
 */

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

/** IBKR's codes for Canadian venues, and the suffix each has here. The currency must be CAD. */
const CANADIAN_VENUES: Record<string, string> = {
  TSE: "TO",
  VENTURE: "V",
};

export interface IbkrListing {
  symbol: string;
  listingExchange: string | undefined;
  currency: string | undefined;
}

export type MappedSymbol = { ok: true; symbol: string } | { ok: false; reason: string };

export function appSymbol(listing: IbkrListing): MappedSymbol {
  const ticker = listing.symbol.trim().toUpperCase();
  const venue = listing.listingExchange?.trim().toUpperCase() ?? "";
  const currency = listing.currency?.trim().toUpperCase() ?? "";

  if (!venue) {
    return { ok: false, reason: "the report has no listing exchange — include every field in the Flex query" };
  }

  if (US_VENUES.has(venue) && currency === "USD") {
    // IBKR writes a share class with a space; this app, like its US price
    // sources, writes it with a dot: "BRK B" is BRK.B.
    const symbol = ticker.replace(/ /g, ".");
    return /^[A-Z0-9]{1,6}(\.[A-Z]{1,2})?$/.test(symbol)
      ? { ok: true, symbol }
      : { ok: false, reason: "a US listing whose ticker this app cannot address" };
  }

  const suffix = CANADIAN_VENUES[venue];
  if (suffix && currency === "CAD") {
    // Toronto prices here come from Yahoo, which writes a share class with a
    // dash: IBKR's "BBD.B" is BBD-B.TO.
    const base = ticker.replace(/[ .]/g, "-");
    return /^[A-Z0-9]{1,6}(-[A-Z]{1,3})?$/.test(base)
      ? { ok: true, symbol: `${base}.${suffix}` }
      : { ok: false, reason: "a Canadian listing whose ticker this app cannot address" };
  }

  return { ok: false, reason: "listed outside the US and Canada, or in another currency" };
}
