import { loadTickerMap } from "./providers/sec-edgar";
import { searchGlobalSymbols } from "./providers/twelvedata";
import type { SymbolSearchResult } from "./providers/types";
import {
  isUsListing,
  listingForBareTicker,
  listingSymbol,
  matchesListing,
  parseExchangeSuffix,
} from "./exchange-suffix";

/**
 * Works out what an unrecognised ticker actually is.
 *
 * Financial scores come from SEC filings, so a TSX-only listing such as ATZ
 * (Aritzia) has none and previously produced a bare "not found" that implied a
 * typo. The symbol exists — it just files with SEDAR+ in Canada, which has no
 * public API.
 *
 * Two things make a better answer possible without paying for data. The
 * worldwide symbol directory needs no API key, so the ticker can be identified
 * and its exchange named. And many foreign companies also list in the US under
 * a different ticker, which does file with the SEC — Canadian National Railway
 * is CNR in Toronto and CNI in New York. Finding that sibling turns a dead end
 * into a working page.
 */

export interface UnsupportedSymbol {
  symbol: string;
  /** Company name from the worldwide directory. */
  name: string | null;
  exchange: string | null;
  country: string | null;
  /**
   * Whether this is a fund rather than an operating company.
   *
   * The two are unavailable for entirely different reasons — a fund publishes
   * no statements anywhere, while a foreign company publishes them to a
   * regulator this app does not read — and saying the wrong one is worse than
   * saying nothing. A page once told a reader that a US-listed ETF was a
   * company filing with another country's regulator, which was untrue twice.
   */
  type: "stock" | "etf" | "unknown";
  /** Other listings of the same company, worldwide. */
  otherListings: SymbolSearchResult[];
  /** A US-listed ticker for the same company that does file with the SEC. */
  usEquivalent: { symbol: string; name: string } | null;
  /**
   * The suffixed ticker this listing is addressed by — "VCN.TO" for "VCN" —
   * when a bare ticker was asked for and nothing in the US trades under it.
   * Null otherwise, including whenever the ticker also trades in the US.
   */
  address: string | null;
}

/** Words that carry no identity when matching one company name to another. */
const NOISE =
  /\b(inc|incorporated|corp|corporation|co|company|companies|ltd|limited|plc|group|holdings?|the|and|of|sa|nv|ag|se|class|common|shares?|stock|adr|cda|canada)\b/gi;

function nameTokens(name: string): string[] {
  return name
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(NOISE, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

/**
 * Scores how strongly two company names refer to the same business.
 * Returns the share of the shorter name's distinctive words that both share.
 */
function nameSimilarity(a: string, b: string): number {
  const left = nameTokens(a);
  const right = new Set(nameTokens(b));
  if (left.length === 0 || right.size === 0) return 0;

  const shared = left.filter((w) => right.has(w)).length;
  return shared / Math.min(left.length, right.size);
}

/**
 * Finds a US-listed ticker for a company named in a foreign listing.
 *
 * Matches on name because there is no shared identifier between the two
 * directories — the SEC knows CIKs, the symbol directory does not. The
 * threshold is deliberately high: suggesting the wrong company is worse than
 * suggesting none, since someone might act on it.
 */
export async function findUsEquivalent(
  companyName: string,
): Promise<{ symbol: string; name: string } | null> {
  if (!companyName.trim()) return null;

  const map = await loadTickerMap().catch(() => null);
  if (!map) return null;

  let best: { symbol: string; name: string; score: number } | null = null;

  for (const entry of map.values()) {
    const score = nameSimilarity(companyName, entry.title);
    if (score >= 0.75 && (!best || score > best.score)) {
      best = { symbol: entry.ticker.toUpperCase(), name: entry.title, score };
    }
  }

  return best ? { symbol: best.symbol, name: best.name } : null;
}

/**
 * Identifies a ticker that SEC EDGAR does not cover.
 *
 * Returns null when the symbol is unknown everywhere, which is the genuine
 * "you mistyped it" case and should be reported as such.
 */
export async function resolveUnsupported(symbol: string): Promise<UnsupportedSymbol | null> {
  const upper = symbol.toUpperCase();

  /*
    An exchange suffix is a question about which listing, not part of the name.

    Symbol search answers in bare tickers with the exchange in its own field —
    "VCN" on TSX, never "VCN.TO" — so requiring an exact string match found
    nothing for a suffixed ticker and produced a 404 for a fund the site could
    otherwise show. Searching the base and filtering by exchange asks the
    question the suffix was actually asking.

    It also settles an ambiguity a bare ticker cannot. QQC is a US fund and
    QQC.TO a Canadian one; searching "QQC" returns both, and only the suffix
    says which was meant.
  */
  const suffixed = parseExchangeSuffix(upper);
  const query = suffixed ? suffixed.base : upper;
  const matches = await searchGlobalSymbols(query, 12);

  const sameTicker = matches.filter((m) => m.symbol.toUpperCase() === query);
  if (sameTicker.length === 0) return null;

  const exact = suffixed
    ? sameTicker.filter((m) => matchesListing(suffixed, m))
    : sameTicker;

  // A suffix naming an exchange this ticker does not trade on is a dead end,
  // not an invitation to return a different listing.
  if (exact.length === 0) return null;

  /*
    Which listing the page is about.

    For a suffix, the one it named. For a bare ticker, the US listing when
    there is one — bare tickers are US tickers on this site — and otherwise
    the primary venue, which the directory lists first. Taking the first row
    unconditionally gave TEC, a US fund, the name of TD's Toronto fund with the
    same ticker, because the directory happens to list Toronto first.
  */
  const primary = suffixed ? exact[0] : (listingForBareTicker(query, exact) ?? exact[0]);

  /*
    Where a bare ticker with no US listing actually lives.

    Search links to the suffixed form, but a bare ticker still arrives by typed
    address and old links, and its page could only guess which listing each
    provider meant: bare VRE showed a Toronto price under a US company's name,
    and bare QQC a dollar price under a Canadian fund's. Naming the suffixed
    ticker lets the page send the reader to the one unambiguous address.
  */
  const address = suffixed || exact.some((m) => isUsListing(m)) ? null : listingSymbol(primary);

  const usEquivalent = primary.name ? await findUsEquivalent(primary.name) : null;

  return {
    symbol: upper,
    name: primary.name ?? null,
    exchange: primary.exchange ?? null,
    country: primary.country ?? null,
    type: primary.type === "etf" || primary.type === "stock" ? primary.type : "unknown",
    otherListings: exact.filter(
      (m) => m !== primary && m.exchange && m.exchange !== primary.exchange,
    ),
    // Never point at the same ticker we already failed to find.
    usEquivalent:
      usEquivalent && usEquivalent.symbol !== upper ? usEquivalent : null,
    address: address && address !== upper ? address : null,
  };
}
