import { parseExchangeSuffix } from "../../exchange-suffix";
import type { EtfProfile } from "../../providers/alphavantage";
import { getISharesCanadaProfile } from "./ishares-ca";
import { getVanguardCanadaProfile } from "./vanguard-ca";

/**
 * Fund facts from the fund's own manager, for a Canadian listing.
 *
 * A Toronto fund files nothing with the SEC, so the fee and size a US fund
 * page gets from EDGAR and a data feed had no free source at all. The two
 * largest managers publish both themselves: iShares in a fund list its site
 * serves openly, Vanguard in a product list copied into ./vanguard-ca.ts.
 *
 * Only a ticker carrying a Canadian exchange suffix is looked up. A bare
 * ticker is a US ticker on this site, and the two overlap — VGRO is Vanguard
 * Canada's growth portfolio in Toronto and an unrelated fund in New York — so
 * answering a bare one would put a Canadian fee on a US fund's page.
 */
export async function getCanadianIssuerProfile(symbol: string): Promise<EtfProfile | null> {
  const listing = parseExchangeSuffix(symbol);
  if (!listing || listing.country !== "Canada") return null;

  // Toronto tickers are unique across managers, so the order only decides
  // which lookup is tried first: the table costs nothing.
  return getVanguardCanadaProfile(listing.base) ?? (await getISharesCanadaProfile(listing.base));
}
