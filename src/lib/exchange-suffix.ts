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
  /**
   * A venue that mostly quotes listings whose home is another exchange in the
   * same country.
   *
   * Cboe Canada carries most Toronto ETFs as well, so symbol search returns
   * each of them twice under the same name. The Toronto row is the one kept;
   * a fund listed only on Cboe Canada is still shown.
   */
  secondary?: boolean;
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
  NE: {
    name: "Cboe Canada",
    aliases: ["NEO", "CBOE CA", "CBOE CANADA"],
    country: "Canada",
    secondary: true,
  },
  CN: { name: "Canadian Securities Exchange", aliases: ["CSE", "CNSX"], country: "Canada" },
  // United Kingdom and Europe
  L: { name: "London Stock Exchange", aliases: ["LSE", "LON", "LONDON"], country: "United Kingdom" },
  PA: { name: "Euronext Paris", aliases: ["EURONEXT", "PARIS"], country: "France" },
  AS: { name: "Euronext Amsterdam", aliases: ["EURONEXT", "AMSTERDAM"], country: "Netherlands" },
  BR: { name: "Euronext Brussels", aliases: ["EURONEXT", "BRUSSELS"], country: "Belgium" },
  LS: { name: "Euronext Lisbon", aliases: ["EURONEXT", "LISBON"], country: "Portugal" },
  // "XETR" is how the worldwide symbol directory writes Xetra.
  DE: { name: "Deutsche Börse", aliases: ["XETRA", "XETR", "FSX", "FRANKFURT"], country: "Germany" },
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
  /** Whether that exchange is a secondary venue for its country — see `ExchangeEntry`. */
  secondary: boolean;
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
    secondary: Boolean(entry.secondary),
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

/** Where a listing trades, as a symbol search describes it. */
export interface ListingPlace {
  exchange?: string | null;
  country?: string | null;
}

const US_COUNTRIES = new Set(["UNITED STATES", "UNITED STATES OF AMERICA", "USA", "US"]);

/** US venue names, for a result that names its exchange but not its country. */
const US_VENUES = new Set([
  "US",
  "NYSE",
  "NASDAQ",
  "NYSE ARCA",
  "NYSEARCA",
  "NYSE AMERICAN",
  "AMEX",
  "BATS",
  "CBOE",
  "IEX",
  "OTC",
]);

function normalise(value?: string | null): string {
  return value?.trim().toUpperCase() ?? "";
}

/**
 * Whether a listing trades in the US, and so is addressed by its bare ticker.
 *
 * Country decides when it is given. A result carrying neither country nor
 * exchange is an SEC EDGAR hit, and every ticker in EDGAR's file trades in
 * the US.
 */
export function isUsListing(place: ListingPlace): boolean {
  const country = normalise(place.country);
  if (country) return US_COUNTRIES.has(country);
  const exchange = normalise(place.exchange);
  return !exchange || US_VENUES.has(exchange);
}

/**
 * The exchange suffix a listing is addressed by, or null.
 *
 * The reverse of `parseExchangeSuffix`: symbol search answers "VCN on TSX",
 * and this turns that into "TO" so the result can link to VCN.TO. Null for a
 * US listing, which needs no suffix, and for any venue this table cannot
 * place with certainty.
 *
 * Country narrows the candidates before the exchange name picks among them,
 * because exchange names collide across countries: "TSE" is Toronto to one
 * provider and Tokyo to another. When two venues still fit equally well the
 * answer is null — a wrong suffix opens a different security, which is worse
 * than no suffix.
 */
export function suffixForListing(place: ListingPlace): string | null {
  if (isUsListing(place)) return null;

  const exchange = normalise(place.exchange);
  const country = normalise(place.country);
  if (!exchange) return null;

  let best: string | null = null;
  let bestScore = 0;
  let tied = false;

  for (const [suffix, entry] of Object.entries(EXCHANGES)) {
    if (country && entry.country.toUpperCase() !== country) continue;

    for (const alias of entry.aliases) {
      /*
        An exact name outranks a contained one, and a longer contained name a
        shorter: "TSX VENTURE" is the Venture exchange although it contains
        "TSX". Containment is only trusted once a country has narrowed the
        field — across every country, a three-letter alias turns up inside too
        many unrelated names.
      */
      const score =
        exchange === alias ? 1000 : country && exchange.includes(alias) ? alias.length : 0;
      if (score === 0) continue;

      if (score > bestScore) {
        best = suffix;
        bestScore = score;
        tied = false;
      } else if (score === bestScore && best !== suffix) {
        tied = true;
      }
    }
  }

  return tied ? null : best;
}

/**
 * The ticker a search result should link to.
 *
 * Bare for a US listing and suffixed everywhere else — the form this site's
 * pages use to tell VCN.TO from any VCN elsewhere. A symbol that already
 * carries a dot is left alone: it is either suffixed already, or a share
 * class such as BRK.B that a second dot would break.
 */
export function listingSymbol(result: ListingPlace & { symbol: string }): string {
  if (result.symbol.includes(".")) return result.symbol;
  const suffix = suffixForListing(result);
  return suffix ? `${result.symbol.trim().toUpperCase()}.${suffix}` : result.symbol;
}

/**
 * Search results, each pointed at the listing it names.
 *
 * The raw results made poor links in two ways. Every Canadian row linked to
 * its bare ticker, so choosing "VGRO — TSX" opened the US fund called VGRO and
 * priced it in dollars. And most Toronto ETFs are cross-listed on Cboe Canada,
 * so each one appeared twice under the same name.
 *
 * So each row gets its suffixed ticker, and then:
 *  - a Cboe Canada row is dropped when the same ticker trades in Toronto;
 *  - a foreign row that could not be given a suffix is dropped when a US
 *    listing in the same results owns its bare ticker, because following it
 *    would open that US security instead;
 *  - whatever remains is deduplicated by ticker, first occurrence kept.
 */
export function addressSearchResults<T extends ListingPlace & { symbol: string }>(
  results: T[],
): T[] {
  const rows = results.map((r) => ({ ...r, symbol: listingSymbol(r) }));

  // Bare tickers that a US listing in these same results answers to.
  const usTickers = new Set(rows.filter((r) => isUsListing(r)).map((r) => r.symbol.toUpperCase()));

  // Base ticker and country of every listing on a primary venue.
  const onPrimaryVenue = new Set(
    rows.flatMap((r) => {
      const parsed = parseExchangeSuffix(r.symbol);
      return parsed && !parsed.secondary ? [`${parsed.base}|${parsed.country}`] : [];
    }),
  );

  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = r.symbol.toUpperCase();
    const parsed = parseExchangeSuffix(key);

    if (parsed?.secondary && onPrimaryVenue.has(`${parsed.base}|${parsed.country}`)) return false;
    if (!parsed && !isUsListing(r) && usTickers.has(key)) return false;

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The listing a bare ticker names, out of every listing with that ticker.
 *
 * The US one when there is one, because a bare ticker is a US ticker on this
 * site and a suffixed one is everything else. Otherwise the first, which the
 * symbol directory orders primary venue first.
 */
export function listingForBareTicker<T extends ListingPlace & { symbol: string }>(
  symbol: string,
  listings: T[],
): T | null {
  const upper = symbol.trim().toUpperCase();
  const same = listings.filter((l) => l.symbol.toUpperCase() === upper);
  return same.find((l) => isUsListing(l)) ?? same[0] ?? null;
}
