/**
 * Exchange suffixes on a ticker, and how to take them off.
 *
 * People type the ticker they were given, and outside the US that ticker
 * usually carries its exchange: VCN.TO, RIO.L, BHP.AX. This app resolves bare
 * tickers — its symbol search returns "VCN" with the exchange in a separate
 * field, never "VCN.TO" — so a suffixed ticker matched nothing and answered
 * 404, on a page that would have loaded perfectly well one keystroke shorter.
 *
 * The suffix is stripped rather than honoured because there is one page per
 * fund here, reached by its bare ticker. Keeping both forms alive would mean
 * two URLs for one fund, which is precisely what the canonical tags added
 * elsewhere exist to prevent.
 *
 * Only known exchange suffixes are stripped, and that restriction is the
 * whole safety of this. A dot in a ticker is not always an exchange: BRK.B,
 * BF.B and RDS.A are share classes, and stripping those would send a reader
 * asking for Berkshire's B shares to a different security. Anything not on
 * the list below is left exactly as typed.
 */

/**
 * Suffix to the exchange it names.
 *
 * Deliberately not exhaustive. Every entry here is a suffix in common use
 * that cannot be confused with a share class — which is why single letters
 * that collide with class conventions (A, B, C) are absent, and why `V`
 * (TSX Venture) is included: no US class share is quoted as ".V".
 */
const EXCHANGE_SUFFIXES: Record<string, string> = {
  // Canada
  TO: "Toronto Stock Exchange",
  V: "TSX Venture Exchange",
  NE: "Cboe Canada",
  CN: "Canadian Securities Exchange",
  // United Kingdom and Europe
  L: "London Stock Exchange",
  PA: "Euronext Paris",
  AS: "Euronext Amsterdam",
  BR: "Euronext Brussels",
  LS: "Euronext Lisbon",
  DE: "Deutsche Börse",
  F: "Frankfurt Stock Exchange",
  MI: "Borsa Italiana",
  MC: "Bolsa de Madrid",
  SW: "SIX Swiss Exchange",
  VI: "Wiener Börse",
  ST: "Nasdaq Stockholm",
  HE: "Nasdaq Helsinki",
  CO: "Nasdaq Copenhagen",
  OL: "Oslo Børs",
  IR: "Euronext Dublin",
  // Asia-Pacific
  HK: "Hong Kong Stock Exchange",
  T: "Tokyo Stock Exchange",
  AX: "Australian Securities Exchange",
  NZ: "New Zealand Exchange",
  SI: "Singapore Exchange",
  KS: "Korea Exchange",
  TW: "Taiwan Stock Exchange",
  NS: "National Stock Exchange of India",
  BO: "BSE India",
  // Americas, outside the US
  SA: "B3 Brazil",
  MX: "Bolsa Mexicana de Valores",
  BA: "Buenos Aires Exchange",
  SN: "Santiago Exchange",
  // Other
  JO: "Johannesburg Stock Exchange",
  TA: "Tel Aviv Stock Exchange",
  IS: "Borsa Istanbul",
};

export interface SuffixedSymbol {
  /** The ticker without its exchange suffix. */
  base: string;
  /** The suffix as written, upper-cased, without the dot. */
  suffix: string;
  /** The exchange the suffix names. */
  exchange: string;
}

/**
 * Splits a ticker from its exchange suffix, or returns null.
 *
 * Null for a bare ticker, for a share class, and for anything whose suffix is
 * not a recognised exchange — in every one of those the symbol should be used
 * exactly as it was typed.
 */
export function parseExchangeSuffix(symbol: string): SuffixedSymbol | null {
  const trimmed = symbol.trim().toUpperCase();
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0 || dot === trimmed.length - 1) return null;

  const base = trimmed.slice(0, dot);
  const suffix = trimmed.slice(dot + 1);

  const exchange = EXCHANGE_SUFFIXES[suffix];
  if (!exchange) return null;

  // A base that is itself dotted is not a ticker plus a suffix; leave it be.
  if (base.includes(".")) return null;

  return { base, suffix, exchange };
}
