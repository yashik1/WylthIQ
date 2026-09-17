import { normalizeCompanyFacts } from "../fundamentals/normalize";
import type { NormalizedFundamentals, SecCompanyFacts } from "../fundamentals/types";
import { SEC_USER_AGENT } from "./sec-config";
import { describeEightK } from "../signals/eight-k-items";
import type {
  Bar,
  CompanyProfile,
  Filing,
  MarketDataProvider,
  NewsItem,
  Quote,
  SymbolSearchResult,
  Timeframe,
} from "./types";

const SEC_HEADERS = { "User-Agent": SEC_USER_AGENT, Accept: "application/json" };

/** Cache windows, in seconds. Filings change at most a few times a quarter. */
const TICKER_MAP_TTL = 60 * 60 * 24;
const SUBMISSIONS_TTL = 60 * 60 * 6;
const FACTS_TTL = 60 * 60 * 12;

interface TickerEntry {
  cik_str: number;
  ticker: string;
  title: string;
}

let tickerMapPromise: Promise<Map<string, TickerEntry>> | null = null;

/**
 * Loads the SEC's ticker-to-CIK map (~10,000 entries), memoised for the life of
 * the server process. Every other EDGAR endpoint is keyed by CIK, so this is the
 * entry point for symbol lookups.
 */
export async function loadTickerMap(): Promise<Map<string, TickerEntry>> {
  tickerMapPromise ??= (async () => {
    const res = await fetch("https://www.sec.gov/files/company_tickers.json", {
      headers: SEC_HEADERS,
      next: { revalidate: TICKER_MAP_TTL },
    });
    if (!res.ok) throw new Error(`SEC ticker map: HTTP ${res.status}`);
    const raw = (await res.json()) as Record<string, TickerEntry>;

    const map = new Map<string, TickerEntry>();
    for (const entry of Object.values(raw)) {
      map.set(entry.ticker.toUpperCase(), entry);
    }
    return map;
  })().catch((err) => {
    // Never cache a failure, or the process is stuck with it forever.
    tickerMapPromise = null;
    throw err;
  });

  return tickerMapPromise;
}

export function padCik(cik: string | number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

/**
 * Normalized company facts, cached in this process.
 *
 * The `next: { revalidate }` directive below looks like it already covers this,
 * but Next's data cache silently refuses any entry over 2MB, and companyfacts
 * runs to 3.6MB for Apple and 4.7MB for Microsoft. So nothing was ever cached:
 * every single stock page view redownloaded and reparsed several megabytes,
 * costing roughly 10MB of heap and half a second before the page could render.
 * Under concurrent traffic on a small container that is a real memory ceiling,
 * not just a slow page.
 *
 * Caching the *normalized* result instead sidesteps the size limit entirely —
 * it is a few kilobytes per company, holds only the fields the app actually
 * reads, and skips the parse as well as the download on a repeat view.
 */
const FACTS_CACHE_MAX = 300;

interface CachedFacts {
  at: number;
  value: NormalizedFundamentals | null;
}

const factsCache = new Map<string, CachedFacts>();
const factsInflight = new Map<string, Promise<NormalizedFundamentals | null>>();

function readFacts(cik: string): CachedFacts | null {
  const hit = factsCache.get(cik);
  if (!hit) return null;

  if (Date.now() - hit.at > FACTS_TTL * 1000) {
    factsCache.delete(cik);
    return null;
  }

  // Refresh insertion order so the eviction below drops genuinely cold entries
  // rather than merely old ones.
  factsCache.delete(cik);
  factsCache.set(cik, hit);
  return hit;
}

function writeFacts(cik: string, value: NormalizedFundamentals | null): void {
  factsCache.set(cik, { at: Date.now(), value });

  // Bounded, because the universe is thousands of filers and this process is
  // long-lived — an unbounded map here would just relocate the leak.
  while (factsCache.size > FACTS_CACHE_MAX) {
    const oldest = factsCache.keys().next().value;
    if (oldest === undefined) break;
    factsCache.delete(oldest);
  }
}

async function fetchFactsByCik(cik: string): Promise<NormalizedFundamentals | null> {
  try {
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${cik}.json`, {
      headers: SEC_HEADERS,
      next: { revalidate: FACTS_TTL },
    });

    // A 404 is a settled answer — this filer has no XBRL facts — so it is worth
    // remembering. A 429 or a 5xx is SEC being busy, which must not be cached
    // or one throttled moment would blank the company for half a day.
    if (!res.ok) {
      if (res.status === 404) writeFacts(cik, null);
      return null;
    }

    const raw = (await res.json()) as SecCompanyFacts;
    const normalized = normalizeCompanyFacts(raw);
    writeFacts(cik, normalized);
    return normalized;
  } catch {
    // A network failure is transient in the same way a 5xx is: return nothing
    // for this view, and let the next one try again.
    return null;
  }
}

/**
 * One symbol's entry in the SEC ticker map.
 *
 * Extracted so the CIK and the company name are looked up the same way. The
 * share-class fallback below is the whole reason: written once it is a
 * correctness fix, copied twice it is a bug waiting for the second copy to
 * drift.
 */
async function lookupTicker(symbol: string): Promise<TickerEntry | null> {
  const map = await loadTickerMap();
  const upper = symbol.toUpperCase();

  const direct = map.get(upper);
  if (direct) return direct;

  // Share classes are written with a dot by most data sources (BRK.B) but with
  // a hyphen by EDGAR (BRK-B). Without this, every multi-class company fails.
  if (upper.includes(".")) {
    const hyphenated = map.get(upper.replace(/\./g, "-"));
    if (hyphenated) return hyphenated;
  }

  return null;
}

export async function cikForSymbol(symbol: string): Promise<string | null> {
  const entry = await lookupTicker(symbol);
  return entry ? padCik(entry.cik_str) : null;
}

/**
 * The registrant name the SEC has on file for a ticker.
 *
 * Reads the same memoised map as cikForSymbol, so on any page that has
 * already resolved a CIK this costs nothing. Used for page titles, where the
 * name is what somebody searched for and the ticker is not.
 *
 * The map's own casing is inconsistent — "Apple Inc." sits beside
 * "MICROSOFT CORP" in the same file — so an all-caps entry is de-shouted
 * rather than printed as a title that looks like a rendering fault.
 */
export async function nameForSymbol(symbol: string): Promise<string | null> {
  const entry = await lookupTicker(symbol);
  return entry ? deShout(entry.title) : null;
}

/**
 * Short tokens that are ordinary words rather than initialisms.
 *
 * The default for a two- or three-letter token in a registrant name is that
 * it is an acronym — AMC, PNC, CSX, IBM, TJX, RTX — so the rule below keeps
 * those in capitals and this list carries the exceptions. Corporate forms
 * that are conventionally written in capitals (SA, NV, AG, PLC) are
 * deliberately absent, because leaving them alone is already correct.
 */
const SHORT_WORDS = new Set([
  "THE", "AND", "FOR", "OF", "CO", "COM", "INC", "LTD",
  "NEW", "OLD", "ONE", "ALL", "OUR", "OIL", "GAS", "AIR", "SEA", "SUN",
]);

/**
 * Title-cases a name that arrived entirely in capitals, leaving mixed-case
 * names untouched.
 *
 * Deliberately conservative: it fires only when there is no lowercase letter
 * anywhere, so a name the SEC already cased properly is never "corrected" —
 * "lululemon athletica inc." keeps its lowercase l, and Apple Inc. is left
 * exactly as filed.
 *
 * Within a shouted name, short tokens stay in capitals unless they are in
 * SHORT_WORDS above. An earlier version tested for a vowel instead, on the
 * theory that acronyms lack them; AMC disproves that, and the rule now turns
 * on length and a list rather than on a guess about spelling.
 */
function deShout(name: string): string {
  if (/[a-z]/.test(name)) return name;

  return name
    .split(/(\s+)/)
    .map((token) => {
      if (/^\s+$/.test(token)) return token;

      // Punctuation and digits are not evidence either way — "AT&T" carries
      // three letters and "3M" carries one.
      const letters = token.replace(/[^A-Z]/g, "");
      if (letters.length <= 3 && !SHORT_WORDS.has(letters)) return token;

      return token.charAt(0) + token.slice(1).toLowerCase();
    })
    .join("");
}

/** Exposed for tests only. */
export const __nameTesting = { deShout };

export interface SecSubmissions {
  cik: string;
  name: string;
  sic: string;
  sicDescription: string;
  tickers: string[];
  exchanges: string[];
  entityType: string;
  stateOfIncorporation: string;
  filings: {
    recent: {
      accessionNumber: string[];
      filingDate: string[];
      reportDate: string[];
      form: string[];
      primaryDocument: string[];
      primaryDocDescription: string[];
      /**
       * Comma-separated 8-K item numbers, e.g. "2.02,9.01". Present all along
       * and ignored until now, which is why every 8-K was announced with the
       * same sentence.
       */
      items?: string[];
      /** When EDGAR accepted the filing — the moment it became public. */
      acceptanceDateTime?: string[];
    };
  };
}

export async function fetchSubmissions(cik: string): Promise<SecSubmissions | null> {
  const res = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: SEC_HEADERS,
    next: { revalidate: SUBMISSIONS_TTL },
  });
  if (!res.ok) return null;
  return (await res.json()) as SecSubmissions;
}

/**
 * SEC EDGAR — the fundamentals and filings backbone.
 *
 * Free, no API key, and not rate limited by quota (only by a 10 req/s fair-use
 * ceiling), which is why the screener can be rebuilt nightly across the whole
 * universe at no cost. Covers US filers plus Canadian companies that cross-list
 * in the US and file 40-F under the MJDS regime.
 *
 * It has no price data, so it implements only the fundamentals half of the
 * interface and defers bars and quotes to the market data provider.
 */
export class SecEdgarProvider implements MarketDataProvider {
  readonly name = "SEC EDGAR";

  /** No credentials required beyond a User-Agent. */
  isConfigured(): boolean {
    return true;
  }

  async getFundamentals(symbol: string): Promise<NormalizedFundamentals | null> {
    const cik = await cikForSymbol(symbol);
    if (!cik) return null;
    return this.getFundamentalsByCik(cik);
  }

  async getFundamentalsByCik(cik: string): Promise<NormalizedFundamentals | null> {
    const cached = readFacts(cik);
    if (cached) return cached.value;

    // Concurrent viewers of the same company share one download rather than
    // each pulling their own copy of a multi-megabyte file.
    let inflight = factsInflight.get(cik);
    if (!inflight) {
      inflight = fetchFactsByCik(cik).finally(() => factsInflight.delete(cik));
      factsInflight.set(cik, inflight);
    }
    return inflight;
  }

  async getProfile(symbol: string): Promise<CompanyProfile | null> {
    const cik = await cikForSymbol(symbol);
    if (!cik) return null;

    const sub = await fetchSubmissions(cik);
    if (!sub) return null;

    return {
      symbol: symbol.toUpperCase(),
      name: sub.name,
      exchange: sub.exchanges?.[0] ?? null,
      // EDGAR does not carry a country field; filers using IFRS via 40-F are
      // Canadian by definition of the MJDS regime.
      country: sub.stateOfIncorporation === "A1" ? "CA" : "US",
      currency: null,
      sicCode: sub.sic || null,
      sicDescription: sub.sicDescription || null,
      industry: sub.sicDescription || null,
      website: null,
      logo: null,
      marketCap: null,
      marketCapCurrency: null,
      sharesOutstanding: null,
      cik,
      description: null,
      entityType: sub.entityType ?? null,
    };
  }

  async getFilings(symbol: string, limit = 25): Promise<Filing[]> {
    const cik = await cikForSymbol(symbol);
    if (!cik) return [];

    const sub = await fetchSubmissions(cik);
    if (!sub?.filings?.recent) return [];

    const r = sub.filings.recent;
    const cikNum = String(Number(cik));
    const filings: Filing[] = [];

    // Only the filings a person would actually want to read.
    const interesting = /^(10-K|10-Q|8-K|20-F|40-F|6-K|DEF 14A|S-1)/;

    for (let i = 0; i < r.accessionNumber.length && filings.length < limit; i++) {
      const form = r.form[i];
      if (!interesting.test(form)) continue;

      const accn = r.accessionNumber[i];
      const bare = accn.replace(/-/g, "");
      const doc = r.primaryDocument[i];
      filings.push({
        form,
        filedAt: r.filingDate[i],
        periodOfReport: r.reportDate[i] || null,
        description: r.primaryDocDescription?.[i] || null,
        items: r.items?.[i] || null,
        url: doc
          ? `https://www.sec.gov/Archives/edgar/data/${cikNum}/${bare}/${doc}`
          : `https://www.sec.gov/Archives/edgar/data/${cikNum}/${bare}/${accn}-index.htm`,
      });
    }

    return filings;
  }

  async searchSymbols(query: string, limit = 10): Promise<SymbolSearchResult[]> {
    const map = await loadTickerMap();
    const q = query.trim().toUpperCase();
    if (!q) return [];

    const exact: SymbolSearchResult[] = [];
    const prefix: SymbolSearchResult[] = [];
    const nameMatch: SymbolSearchResult[] = [];

    for (const entry of map.values()) {
      const ticker = entry.ticker.toUpperCase();
      const title = entry.title.toUpperCase();
      const result: SymbolSearchResult = {
        symbol: ticker,
        name: entry.title,
        exchange: null,
        cik: padCik(entry.cik_str),
      };

      if (ticker === q) exact.push(result);
      else if (ticker.startsWith(q)) prefix.push(result);
      else if (title.includes(q)) nameMatch.push(result);

      if (exact.length + prefix.length >= limit * 3) break;
    }

    return [...exact, ...prefix, ...nameMatch].slice(0, limit);
  }

  // ---- Price data is not available from EDGAR ----

  async getBars(_symbol: string, _tf: Timeframe, _from: Date, _to: Date): Promise<Bar[]> {
    return [];
  }

  async getQuote(_symbol: string): Promise<Quote | null> {
    return null;
  }

  /**
   * Recent filings, presented as news.
   *
   * The last link in the news chain, and the only one that cannot be refused,
   * rate limited or unsubscribed: EDGAR needs no key and a US filer always has
   * filings. An 8-K *is* the news — a company is required to announce material
   * events there, and a journalist's article is a description of one written
   * afterwards. For an app whose premise is that every figure traces to a
   * primary source, this is the more defensible thing to show anyway.
   *
   * Routine paperwork is left out. An insider selling a scheduled block of
   * shares is a Form 4 every month and tells a newcomer nothing, so only forms
   * that carry an announcement are surfaced.
   */
  async getNews(symbol: string, limit = 20): Promise<NewsItem[]> {
    const filings = await this.getFilings(symbol, 40);
    const cutoff = Date.now() - NEWS_WINDOW_DAYS * 86_400_000;

    return filings
      .filter((f) => NEWSWORTHY[f.form] && Date.parse(f.filedAt) >= cutoff)
      .slice(0, limit)
      .map((f) => {
        /*
          An 8-K says which items it reports under, and those items are the
          difference between "we published results" and "our previous accounts
          cannot be relied on". Both used to arrive as "the company reported a
          major event". Every other form keeps its fixed label, because their
          meaning does not vary.
        */
        const decoded = f.form === "8-K" ? describeEightK(f.items) : null;

        return {
          id: f.url,
          headline: decoded ? decoded.headline : NEWSWORTHY[f.form],
          // The filing's own description, when EDGAR carries one, is a better
          // summary than anything that could be generated from the form type.
          summary: f.description || null,
          source: "SEC EDGAR",
          url: f.url,
          publishedAt: new Date(f.filedAt).toISOString(),
          imageUrl: null,
        };
      });
  }
}

/** How far back a filing still counts as news. Matches the panel's own wording. */
const NEWS_WINDOW_DAYS = 30;

/**
 * Forms worth announcing, in plain English.
 *
 * Deliberately short. Most filings are routine and listing them all would bury
 * the two or three that mean something.
 */
const NEWSWORTHY: Record<string, string> = {
  "8-K": "The company reported a major event",
  "6-K": "The company published an interim update",
  "10-K": "The company filed its annual report",
  "10-Q": "The company filed its quarterly results",
  "20-F": "The company filed its annual report",
  "40-F": "The company filed its annual report",
  "DEF 14A": "The company issued shareholder voting materials",
};

export const secEdgar = new SecEdgarProvider();
