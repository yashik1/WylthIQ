/**
 * Exchange suffixes on a ticker, and what they identify.
 *
 * People type the ticker they were given, and outside the US that ticker
 * carries its exchange: VCN.TO, RIO.L, BHP.AX. This app's symbol search
 * returns "VCN" with the exchange in a separate field and never "VCN.TO", so
 * a suffixed ticker matched nothing and answered 404 on a page that would
 * have loaded one keystroke shorter.
 *
 * The suffix is not noise to be stripped, though — for an ambiguous ticker it
 * is the only thing that says which security is meant. QQC is a US fund from
 * Simplify and QQC.TO is a Canadian one from CI Invesco; they are different
 * funds, in different currencies, holding different things. A bare ticker can
 * only ever be one of them, so the suffixed form has to survive as its own
 * page rather than collapse into the other.
 *
 * Only known exchange suffixes are recognised, and that restriction is the
 * whole safety of this. A dot in a ticker is not always a venue: BRK.B, BF.B
 * and RDS.A are share classes, and treating those as exchanges would resolve
 * one security as another. Anything not listed below is left exactly as typed.
 */

interface ExchangeEntry {
  /** How the exchange is written for a reader. */
  name: string;
  /**
   * How data providers write it.
   *
   * Matched case-insensitively against whatever a symbol search returns,
   * because they disagree: Toronto comes back as "TSX", "TSE" and "Toronto"
   * depending on who is asked.
   */
  aliases: string[];
  /** The country, which providers agree on far more often than exchange names. */
  country: string;
}

/**
 * Suffix to exchange.
 *
 * Deliberately not exhaustive. Every entry is a suffix in common use that
 * cannot be confused with a share class — which is why single letters that
 * collide with class conventions (A, B, C) are absent, and why `V` is
 * present: no US class share is quoted as ".V".
 */
const EXCHANGES: Record<string, ExchangeEntry> = {
  // Canada
  TO: { name: "Toronto Stock Exchange", aliases: ["TSX", "TSE", "TORONTO"], country: "Canada" },
  V: { name: "TSX Venture Exchange", aliases: ["TSXV", "TSX VENTURE", "VENTURE"], country: "Canada" },
  NE: { name: "Cboe Canada", aliases: ["NEO", "CBOE CA", "CBOE CANADA"], country: "Canada" },
  CN: { name: "Canadian Securities Exchange", aliases: ["CSE", "CNSX"], country: "Canada" },
  // United Kingdom and Europe
  L: { name: "London Stock Exchange", aliases: ["LSE", "LON", "LONDON"], country: "United Kingdom" },
  PA: { name: "Euronext Paris", aliases: ["EURONEXT", "PARIS"], country: "France" },
  AS: { name: "Euronext Amsterdam", aliases: ["EURONEXT", "AMSTERDAM"], country: "Netherlands" },
  BR: { name: "Euronext Brussels", aliases: ["EURONEXT", "BRUSSELS"], country: "Belgium" },
  LS: { name: "Euronext Lisbon", aliases: ["EURONEXT", "LISBON"], country: "Portugal" },
  DE: { name: "Deutsche Börse", aliases: ["XETRA", "FSX", "FRANKFURT"], country: "Germany" },
  F: { name: "Frankfurt Stock Exchange", aliases: ["FSX", "FRANKFURT"], country: "Germany" },
  MI: { name: "Borsa Italiana", aliases: ["MTA", "MILAN"], country: "Italy" },
  MC: { name: "Bolsa de Madrid", aliases: ["BME", "MADRID"], country: "Spain" },
  SW: { name: "SIX Swiss Exchange", aliases: ["SIX", "SWX"], country: "Switzerland" },
  ST: { name: "Nasdaq Stockholm", aliases: ["OMX", "STOCKHOLM"], country: "Sweden" },
  HE: { name: "Nasdaq Helsinki", aliases: ["OMX", "HELSINKI"], country: "Finland" },
  CO: { name: "Nasdaq Copenhagen", aliases: ["OMX", "COPENHAGEN"], country: "Denmark" },
  OL: { name: "Oslo Børs", aliases: ["OSE", "OSLO"], country: "Norway" },
  IR: { name: "Euronext Dublin", aliases: ["EURONEXT", "DUBLIN", "ISE"], country: "Ireland" },
  // Asia-Pacific
  HK: { name: "Hong Kong Stock Exchange", aliases: ["HKEX", "SEHK"], country: "Hong Kong" },
  T: { name: "Tokyo Stock Exchange", aliases: ["TSE", "JPX", "TOKYO"], country: "Japan" },
  AX: { name: "Australian Securities Exchange", aliases: ["ASX"], country: "Australia" },
  NZ: { name: "New Zealand Exchange", aliases: ["NZX"], country: "New Zealand" },
  SI: { name: "Singapore Exchange", aliases: ["SGX"], country: "Singapore" },
  KS: { name: "Korea Exchange", aliases: ["KRX", "KOSPI"], country: "South Korea" },
  TW: { name: "Taiwan Stock Exchange", aliases: ["TWSE"], country: "Taiwan" },
  NS: { name: "National Stock Exchange of India", aliases: ["NSE"], country: "India" },
  BO: { name: "BSE India", aliases: ["BSE", "BOMBAY"], country: "India" },
  // Americas, outside the US
  SA: { name: "B3 Brazil", aliases: ["B3", "BOVESPA", "SAO PAULO"], country: "Brazil" },
  MX: { name: "Bolsa Mexicana de Valores", aliases: ["BMV", "MEXICO"], country: "Mexico" },
  BA: { name: "Buenos Aires Exchange", aliases: ["BCBA", "BUENOS AIRES"], country: "Argentina" },
  // Other
  JO: { name: "Johannesburg Stock Exchange", aliases: ["JSE"], country: "South Africa" },
  TA: { name: "Tel Aviv Stock Exchange", aliases: ["TASE"], country: "Israel" },
  IS: { name: "Borsa Istanbul", aliases: ["BIST"], country: "Turkey" },
};

export interface SuffixedSymbol {
  /** The ticker without its exchange suffix. */
  base: string;
  /** The suffix as written, upper-cased, without the dot. */
  suffix: string;
  /** The exchange it names, for a reader. */
  exchange: string;
  /** The country that exchange is in. */
  country: string;
  /** How providers spell that exchange. */
  aliases: string[];
}

/**
 * Splits a ticker from its exchange suffix, or returns null.
 *
 * Null for a bare ticker, for a share class, and for anything whose suffix is
 * not a recognised exchange — in every one of those the symbol should be used
 * exactly as typed.
 */
export function parseExchangeSuffix(symbol: string): SuffixedSymbol | null {
  const trimmed = symbol.trim().toUpperCase();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return null;

  const base = trimmed.slice(0, dot);
  const suffix = trimmed.slice(dot + 1);

  const entry = EXCHANGES[suffix];
  if (!entry) return null;

  // A base that is itself dotted is not a ticker plus a suffix; leave it be.
  if (base.includes(".")) return null;

  return {
    base,
    suffix,
    exchange: entry.name,
    country: entry.country,
    aliases: entry.aliases,
  };
}

/**
 * Whether a search result is the listing a suffix asked for.
 *
 * Exchange first, country second. Providers disagree about exchange names far
 * more than about countries — Toronto arrives as "TSX", "TSE" or "Toronto"
 * depending who is asked — so a country match is accepted as corroboration
 * when the exchange string is unfamiliar. Matching on neither is a different
 * listing and must not be returned: answering with the US fund when somebody
 * asked for the Canadian one is the failure this whole module exists to stop.
 */
export function matchesListing(
  wanted: SuffixedSymbol,
  candidate: { exchange?: string | null; country?: string | null },
): boolean {
  const exchange = candidate.exchange?.toUpperCase().trim() ?? "";
  if (exchange && wanted.aliases.some((a) => exchange.includes(a))) return true;

  const country = candidate.country?.toUpperCase().trim() ?? "";
  return Boolean(country) && country === wanted.country.toUpperCase();
}
