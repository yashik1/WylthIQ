import { parseExchangeSuffix } from "../exchange-suffix";

/**
 * Who runs a Canadian-listed fund, read from its name.
 *
 * For the funds whose holdings this site has no open source for: the page says
 * whose they are and links to that manager, rather than leaving a blank where
 * the holdings would be. Canadian ETF names lead with the manager — "BMO S&P
 * 500 Index ETF", "Vanguard FTSE Canada All Cap Index ETF" — so the name is a
 * better guide than the ticker, whose prefixes are a convention, not a rule.
 *
 * Only for a Canadian listing: a bare ticker is a US fund on this site, which
 * has its own SEC filing to read.
 */

export interface FundManager {
  name: string;
  /**
   * The manager's own site. The home page rather than a fund list, because
   * those move with every redesign and a stale link is worse than a general
   * one; Vanguard's product list is the one this site already reads from.
   */
  url: string;
}

const MANAGERS: { pattern: RegExp; manager: FundManager }[] = [
  { pattern: /^vanguard\b/i, manager: { name: "Vanguard Canada", url: "https://www.vanguard.ca/en/product" } },
  { pattern: /^bmo\b/i, manager: { name: "BMO Global Asset Management", url: "https://www.bmogam.com" } },
  { pattern: /^ishares\b/i, manager: { name: "iShares Canada", url: "https://www.blackrock.com/ca" } },
  { pattern: /^(global x|horizons)\b/i, manager: { name: "Global X Canada", url: "https://www.globalx.ca" } },
  { pattern: /^td\b/i, manager: { name: "TD Asset Management", url: "https://www.td.com/ca/en/asset-management" } },
  { pattern: /^ci\b/i, manager: { name: "CI Global Asset Management", url: "https://www.ci.com" } },
  { pattern: /^fidelity\b/i, manager: { name: "Fidelity Canada", url: "https://www.fidelity.ca" } },
  { pattern: /^invesco\b/i, manager: { name: "Invesco Canada", url: "https://www.invesco.com/ca" } },
  { pattern: /^mackenzie\b/i, manager: { name: "Mackenzie Investments", url: "https://www.mackenzieinvestments.com" } },
  { pattern: /^rbc\b/i, manager: { name: "RBC iShares", url: "https://www.rbcgam.com" } },
  { pattern: /^desjardins\b/i, manager: { name: "Desjardins", url: "https://www.desjardins.com" } },
  { pattern: /^hamilton\b/i, manager: { name: "Hamilton ETFs", url: "https://hamiltonetfs.com" } },
  { pattern: /^purpose\b/i, manager: { name: "Purpose Investments", url: "https://www.purposeinvest.com" } },
  { pattern: /^evolve\b/i, manager: { name: "Evolve ETFs", url: "https://evolveetfs.com" } },
  { pattern: /^harvest\b/i, manager: { name: "Harvest ETFs", url: "https://harvestportfolios.com" } },
  { pattern: /^franklin\b/i, manager: { name: "Franklin Templeton Canada", url: "https://www.franklintempleton.ca" } },
  { pattern: /^manulife\b/i, manager: { name: "Manulife Investment Management", url: "https://www.manulifeim.com" } },
];

export function fundManager(name: string | null | undefined, symbol: string): FundManager | null {
  const listing = parseExchangeSuffix(symbol);
  if (!listing || listing.country !== "Canada") return null;
  const trimmed = (name ?? "").trim();
  if (!trimmed) return null;
  return MANAGERS.find((m) => m.pattern.test(trimmed))?.manager ?? null;
}
