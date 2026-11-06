import { matchesListing, parseExchangeSuffix } from "./exchange-suffix";
import { searchGlobalSymbols } from "./providers/twelvedata";
import type { SymbolSearchResult } from "./providers/types";

/**
 * Peers this site can actually open.
 *
 * Finnhub's peer list links straight to stock pages, and a site audit found
 * three kinds of entry that answer 404 here: a preferred share (NA.PR.I.TO on
 * every big-bank page), a partnership's units (BEP.UN.TO), and a company
 * taken over since the list was made (Veren, VRN.TO, on Baytex's page).
 */

/** A US share class: BRK.B, BF.B. */
const SHARE_CLASS = /^[A-Z]{1,6}\.[A-Z]$/;

/**
 * Whether a peer's symbol has a shape this site gives a page: a bare ticker,
 * a US share class, or a ticker with an exchange suffix it knows. A preferred
 * share or trust unit written with its own dots — NA.PR.I.TO, BEP.UN.TO — is
 * none of these, and no provider here answers for it.
 */
export function opensHere(symbol: string): boolean {
  const upper = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9][A-Z0-9.=^-]*$/.test(upper)) return false;
  const dots = upper.split(".").length - 1;
  if (dots === 0) return true;
  if (dots > 1) return false;
  return SHARE_CLASS.test(upper) || parseExchangeSuffix(upper) !== null;
}

/**
 * The peers worth linking, in their order.
 *
 * A suffixed peer is checked against the symbol directory, the same lookup
 * its own page makes, and dropped only on positive evidence: the directory
 * knows the ticker but not on that exchange, which is how a listing that has
 * stopped trading looks. An empty answer — a slow or unavailable directory —
 * keeps the peer, because dropping every Canadian peer whenever the directory
 * stalls would be worse than one dead link.
 */
export async function confirmPeers(
  peers: string[],
  search: (query: string, limit: number) => Promise<SymbolSearchResult[]> = searchGlobalSymbols,
): Promise<string[]> {
  const shaped = peers.filter(opensHere);
  const checked = await Promise.all(
    shaped.map(async (peer) => {
      const listing = parseExchangeSuffix(peer);
      if (!listing) return peer;
      const found = await search(listing.base, 12).catch(() => []);
      const sameTicker = found.filter((m) => m.symbol.toUpperCase() === listing.base);
      if (sameTicker.length === 0 && found.length === 0) return peer;
      return sameTicker.some((m) => matchesListing(listing, m)) ? peer : null;
    }),
  );
  return checked.filter((p): p is string => p !== null);
}
