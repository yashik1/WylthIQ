import { SEC_USER_AGENT } from "../providers/sec-config";
import { NportReader, type FundPortfolio } from "./nport";

/**
 * Finding a fund's latest portfolio filing, from its ticker.
 *
 * Three hops, each against a free SEC endpoint:
 *
 *   1. `company_tickers_mf.json` maps a fund ticker to a CIK *and a series id*.
 *      The series is the part that matters. A ticker's CIK is often a trust
 *      that runs dozens of funds — Vanguard Index Funds is one CIK for VOO,
 *      VTI and a great many others — so a CIK alone identifies the family, not
 *      the fund, and the newest filing under it usually belongs to a different
 *      one.
 *   2. EDGAR's browse endpoint accepts a series id where it accepts a CIK, and
 *      that is what narrows the filing list to this fund. Asked for Atom so
 *      the answer is parsed as data rather than scraped out of a page.
 *   3. The filing's own `primary_doc.xml` holds the portfolio.
 *
 * Failure at any hop returns null. A fund page without holdings is a smaller
 * loss than a company page that 500s, and plenty of tickers legitimately have
 * no N-PORT — see `getFundReport`.
 */

const SEC_HEADERS = { "User-Agent": SEC_USER_AGENT };

/** The fund ticker map is republished daily and is about 1.2MB. */
const FUND_MAP_TTL = 60 * 60 * 24;
/** Filings appear quarterly; six hours is far more often than they change. */
const FILING_LIST_TTL = 60 * 60 * 6;

export interface FundSeries {
  cik: string;
  seriesId: string;
  classId: string;
}

let fundMapPromise: Promise<Map<string, FundSeries>> | null = null;

/**
 * Ticker to CIK, series and class, memoised for the life of the process.
 *
 * A separate file from the `company_tickers.json` the equity pages use, and
 * deliberately a separate loader: they answer different questions and a symbol
 * can appear in both. Cached through Next's data cache as well, which is safe
 * here where it is not for the filings themselves — this file is well under
 * the two-megabyte ceiling that quietly rejects a larger entry.
 */
export async function loadFundMap(): Promise<Map<string, FundSeries>> {
  fundMapPromise ??= (async () => {
    const res = await fetch("https://www.sec.gov/files/company_tickers_mf.json", {
      headers: { ...SEC_HEADERS, Accept: "application/json" },
      next: { revalidate: FUND_MAP_TTL },
    });
    if (!res.ok) throw new Error(`SEC fund ticker map: HTTP ${res.status}`);

    const raw = (await res.json()) as {
      fields: string[];
      data: [number, string, string, string][];
    };

    const map = new Map<string, FundSeries>();
    for (const [cik, seriesId, classId, symbol] of raw.data) {
      if (!symbol) continue;
      // First entry wins. A ticker appears once, but a malformed republished
      // file should not let a later row silently redirect an existing symbol.
      const key = symbol.toUpperCase();
      if (!map.has(key)) map.set(key, { cik: String(cik), seriesId, classId });
    }
    return map;
  })().catch((err) => {
    // Never cache a failure, or the process is stuck with it forever.
    fundMapPromise = null;
    throw err;
  });

  return fundMapPromise;
}

export interface NportFiling {
  accession: string;
  /** When it was filed, which is two months or so after what it describes. */
  filedAt: string | null;
  /** The human-readable EDGAR page, for citing the source. */
  indexUrl: string;
}

/** The newest public NPORT-P for one series, or null if it has never filed one. */
export async function latestNportFiling(
  cik: string,
  seriesId: string,
): Promise<NportFiling | null> {
  const url =
    "https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany" +
    `&CIK=${encodeURIComponent(seriesId)}&type=NPORT-P&dateb=&owner=include&count=1&output=atom`;

  const res = await fetch(url, {
    headers: { ...SEC_HEADERS, Accept: "application/atom+xml" },
    next: { revalidate: FILING_LIST_TTL },
  });
  if (!res.ok) return null;

  const xml = await res.text();
  const accession = /<accession-number>([^<]+)</i.exec(xml)?.[1]?.trim();
  if (!accession) return null;

  const filedAt = /<filing-date>([^<]+)</i.exec(xml)?.[1]?.trim() ?? null;
  const bare = accession.replace(/-/g, "");
  const digits = cik.replace(/\D/g, "");

  return {
    accession,
    filedAt,
    indexUrl: `https://www.sec.gov/Archives/edgar/data/${digits}/${bare}/${accession}-index.htm`,
  };
}

export interface FundReport {
  portfolio: FundPortfolio;
  filing: NportFiling;
}

/**
 * Finished reports, cached in this process.
 *
 * The same reasoning as `factsCache` in src/lib/providers/sec-edgar.ts, and
 * for the same reason it cannot be done with `next: { revalidate }`: the
 * framework's data cache refuses an entry over two megabytes and these filings
 * are far larger, so the fetch below is uncacheable by it. Without this, every
 * view of a fund page redownloaded the whole document — measured at fourteen
 * seconds and twenty megabytes for BND, on every single load, against a free
 * public service that asks callers not to do that.
 *
 * What is cached is the reduced report, which is a few kilobytes whatever the
 * filing weighed, and the cache is bounded because this process is long-lived
 * and there are thousands of funds.
 *
 * Null results are cached too, deliberately. Most symbols that reach this are
 * not funds at all, and the answer "not a fund" is stable — recomputing it on
 * every view would mean an EDGAR round trip per page for exactly the tickers
 * that gain nothing from one.
 */
const REPORT_CACHE_MAX = 200;
/** Filings appear quarterly. A day is still far more often than they change. */
const REPORT_TTL_MS = 60 * 60 * 24 * 1000;

const reportCache = new Map<string, { at: number; value: FundReport | null }>();
/**
 * In-flight requests, so a burst for one fund makes one download.
 *
 * Without it, three concurrent views of BND are three simultaneous
 * twenty-megabyte reads — which is the memory spike the streaming reader
 * exists to avoid, reintroduced by concurrency.
 */
const reportInflight = new Map<string, Promise<FundReport | null>>();

function readReport(symbol: string): { value: FundReport | null } | null {
  const hit = reportCache.get(symbol);
  if (!hit) return null;

  if (Date.now() - hit.at > REPORT_TTL_MS) {
    reportCache.delete(symbol);
    return null;
  }

  // Refresh insertion order so eviction drops genuinely cold entries rather
  // than merely old ones.
  reportCache.delete(symbol);
  reportCache.set(symbol, hit);
  return hit;
}

function writeReport(symbol: string, value: FundReport | null): void {
  reportCache.set(symbol, { at: Date.now(), value });

  while (reportCache.size > REPORT_CACHE_MAX) {
    const oldest = reportCache.keys().next().value;
    if (oldest === undefined) break;
    reportCache.delete(oldest);
  }
}

/**
 * The fund's latest reported portfolio, or null.
 *
 * Null is an ordinary answer here, not an error, and it has several honest
 * causes: the ticker is not a registered fund, it is a trust that files under
 * a different form (SPY is a unit investment trust and does not appear in the
 * fund ticker map at all), it is too new to have filed, or SEC is briefly
 * unavailable. None of them is worth failing a page over — the price history
 * and everything else on it still works — so every failure path returns null
 * and the page simply omits the section.
 */
export async function getFundReport(symbol: string): Promise<FundReport | null> {
  const upper = symbol.trim().toUpperCase();

  const cached = readReport(upper);
  if (cached) return cached.value;

  const existing = reportInflight.get(upper);
  if (existing) return existing;

  const work = fetchFundReport(upper).then(
    (value) => {
      writeReport(upper, value);
      reportInflight.delete(upper);
      return value;
    },
    () => {
      // Never cached, so a blip does not blank the fund for a day.
      reportInflight.delete(upper);
      return null;
    },
  );

  reportInflight.set(upper, work);
  return work;
}

async function fetchFundReport(upper: string): Promise<FundReport | null> {
  try {
    const series = (await loadFundMap()).get(upper);
    if (!series) return null;

    const filing = await latestNportFiling(series.cik, series.seriesId);
    if (!filing) return null;

    const bare = filing.accession.replace(/-/g, "");
    const digits = series.cik.replace(/\D/g, "");
    const url = `https://www.sec.gov/Archives/edgar/data/${digits}/${bare}/primary_doc.xml`;

    /*
      Deliberately uncached by the framework.

      Next's data cache silently refuses an entry over two megabytes — the same
      ceiling that stopped `companyfacts` ever being cached in
      src/lib/providers/sec-edgar.ts — and these documents are half a megabyte
      for a large-cap index fund and far more for a bond one. Asking it to
      cache them would not fail loudly; it would simply never cache, while the
      whole document sat in the framework's buffers on the way through. The
      reduced result is cached instead, by the caller.
    */
    const res = await fetch(url, { headers: SEC_HEADERS, cache: "no-store" });
    if (!res.ok || !res.body) return null;

    /*
      Read as it arrives, never assembled.

      `res.text()` would be one line and would put the whole filing in memory:
      twenty megabytes for a total-market bond fund, and more than that once
      the string is decoded. Several concurrent requests for one of those is
      the shape of an out-of-memory kill on a small container. The reader folds
      each position into its totals and drops it, so what this holds is a few
      hundred bytes of aggregates however large the document is — which also
      means there is no size at which a fund simply gets no holdings.
    */
    const reader = new NportReader();
    const decoder = new TextDecoder();

    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      // `stream: true` matters: a multi-byte character split across two chunks
      // would otherwise decode as two replacement characters, in the middle of
      // a company name.
      reader.push(decoder.decode(chunk, { stream: true }));
    }
    reader.push(decoder.decode());

    const portfolio = reader.finish();
    if (!portfolio) return null;

    return { portfolio, filing };
  } catch {
    return null;
  }
}
