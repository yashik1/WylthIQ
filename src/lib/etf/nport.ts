/**
 * Reading a fund's portfolio out of its N-PORT filing.
 *
 * Every US-registered fund — ETFs included — files Form N-PORT with the SEC,
 * listing every position it held, what each was worth, and what share of the
 * fund each represented. It is free, public, machine-readable, and it is the
 * fund's own statement to its regulator rather than a vendor's summary of one.
 * That is the same standard the company pages are held to, which is why the
 * fund pages are built on it rather than on a data provider: a figure here can
 * be clicked through to the filing it came from.
 *
 * Two limits are inherent to the source and are stated on the page rather than
 * smoothed over. Only the third month of each quarter becomes public, and it
 * appears about sixty days after the period it covers — so a holdings list is
 * typically two to four months old. And N-PORT reports what the fund *held*,
 * not what it *charges*: there is no expense ratio in this form, so the page
 * does not show one rather than guessing at it.
 *
 * Parsed with regular expressions rather than an XML library, which is the
 * same choice `scripts/ingest-13f.ts` makes against the same publisher. These
 * are machine-generated filings against a published schema, the fields wanted
 * are a dozen flat leaf elements, and the alternative is a dependency and a
 * full DOM of a document that reaches twenty megabytes for a bond fund.
 */

/** Percent-of-net-assets is reported in percent units: 0.19 means 0.19%. */
export interface FundHolding {
  name: string;
  cusip: string | null;
  isin: string | null;
  /** Share of the fund's net assets, in percent. */
  percent: number | null;
  valueUsd: number | null;
  /** Raw N-PORT asset category code, e.g. "EC". Labelled by `assetLabel`. */
  assetCategory: string | null;
  /** ISO 3166 alpha-2, or null when the filing says "N/A". */
  country: string | null;
  /**
   * Coupon and maturity, for a debt security only.
   *
   * These are what make one bond distinguishable from another. A total bond
   * fund's twenty largest positions are all filed under the name "United
   * States Treasury Note/Bond", so without them the page rendered twenty
   * identical rows and looked broken while being perfectly accurate.
   */
  coupon: number | null;
  maturity: string | null;
  /**
   * A short position, from `payoffProfile`.
   *
   * Kept because a weight means something different for one: an index fund
   * holding 3% Apple and an inverse fund short 3% Apple are opposite bets and
   * would otherwise render identically.
   */
  isShort: boolean;
}

export interface FundPortfolio {
  /** The fund itself. A trust may file for many, so this is the specific one. */
  seriesName: string | null;
  /** The trust or registrant the series belongs to. */
  registrantName: string | null;
  /** The portfolio date, not the filing date. What the numbers describe. */
  asOf: string | null;
  netAssets: number | null;
  totalAssets: number | null;
  /** Every position in the filing, including the ones not returned below. */
  holdingCount: number;
  /** Weight by instrument type, over every position. Largest first. */
  byAsset: Breakdown[];
  /** Weight by country of the issuer, over every position. Largest first. */
  byCountry: Breakdown[];
  /** Combined weight of the ten largest positions, in percent. */
  topTenPercent: number | null;
  /** The largest positions by value, descending. Capped — see `parseNport`. */
  holdings: FundHolding[];
  /**
   * Monthly total returns for the three months of the reporting quarter, in
   * percent, oldest first. The fund's own figures, after its fees.
   */
  monthlyReturns: number[];
}

/**
 * N-PORT asset category codes, spelled out.
 *
 * Only the codes this maps are labelled; anything else falls through to the
 * raw code. A wrong label on a financial instrument is worse than an opaque
 * one — a reader who sees "DCR" can look it up, whereas a reader told that a
 * credit derivative is a commodity has been misinformed with confidence.
 */
const ASSET_LABELS: Record<string, string> = {
  EC: "Shares",
  EP: "Preferred shares",
  DBT: "Bonds",
  STIV: "Cash and short-term",
  RE: "Real estate",
  LON: "Loans",
  COMMOD: "Commodities",
  SN: "Structured notes",
  "ABS-MBS": "Mortgage-backed",
  "ABS-ABSCBDO": "Collateralised debt",
  "ABS-O": "Other asset-backed",
  DE: "Equity derivatives",
  DIR: "Interest-rate derivatives",
  DCR: "Credit derivatives",
  DFE: "Currency derivatives",
  DCO: "Commodity derivatives",
  DO: "Other derivatives",
};

export function assetLabel(code: string | null): string {
  if (!code) return "Unclassified";
  return ASSET_LABELS[code] ?? code;
}

/**
 * Country name for an ISO alpha-2 code, via the runtime's own tables.
 *
 * `Intl.DisplayNames` ships with Node and every browser, so a 250-entry map
 * does not need to live in this repository and go stale. Falls back to the
 * code when the runtime does not recognise it, which is the same principle as
 * the asset labels above.
 */
export function countryLabel(code: string | null): string {
  if (!code) return "Unknown";
  try {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    return names.of(code) ?? code;
  } catch {
    return code;
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

/** Filings carry `&amp;` in names — AT&T and Procter & Gamble both arrive escaped. */
function decode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name: string) => ENTITIES[name] ?? _);
}

/** First text value of a leaf tag, ignoring namespace prefixes. */
function tag(xml: string, name: string): string | null {
  const match = new RegExp(`<(?:\\w+:)?${name}\\b[^>]*>([^<]*)</`, "i").exec(xml);
  const value = match?.[1]?.trim();
  return value ? decode(value) : null;
}

function num(xml: string, name: string): number | null {
  const raw = tag(xml, name);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * "N/A" is a value these filings actually write into country and payoff
 * fields, and it means the opposite of what a string comparison assumes: it is
 * the absence of an answer, not an answer.
 */
function present(value: string | null): string | null {
  if (!value) return null;
  return value.toUpperCase() === "N/A" ? null : value;
}

export interface ParseOptions {
  /**
   * How many positions to return. Aggregates are computed over all of them
   * either way; this caps only what is carried out of the parse.
   *
   * A total-market bond fund files eighteen thousand positions, and nothing on
   * the page shows more than a couple of dozen. Returning them all would put
   * megabytes into a cache to render a list of twenty.
   */
  limit?: number;
}

/**
 * Reads a filing incrementally.
 *
 * The whole document is never held. A broad bond fund files twenty megabytes
 * of XML and the page shows twenty rows of it, so buffering the document to
 * render that is a bad trade on a small container — and it was a real ceiling
 * rather than a theoretical one: the first version of this capped filings at
 * twelve megabytes and silently dropped the holdings of some of the most
 * widely held funds there are, BND and AGG among them.
 *
 * Positions are complete by the time they matter, so each `<invstOrSec>` is
 * parsed as it arrives, folded into the running totals, and dropped. What
 * survives is a few hundred bytes of aggregates and the largest positions,
 * whatever the filing weighed.
 */
export class NportReader {
  private readonly limit: number;
  /** Unconsumed text, always shorter than one position plus one chunk. */
  private buffer = "";
  /** Everything before the first position. Complete once `header` is set. */
  private header: string | null = null;
  private headerBytes = 0;
  private kept: FundHolding[] = [];
  private assetTotals = new Map<string, number>();
  private countryTotals = new Map<string, number>();
  private count = 0;

  constructor(options: ParseOptions = {}) {
    this.limit = options.limit ?? 25;
  }

  push(chunk: string): void {
    this.buffer += chunk;

    for (;;) {
      const open = this.buffer.indexOf("<invstOrSec>");
      if (open === -1) break;
      const close = this.buffer.indexOf("</invstOrSec>", open);
      if (close === -1) break;

      // The first position marks the end of the header, wherever it lands.
      if (this.header === null) this.header = this.buffer.slice(0, open);

      this.take(this.buffer.slice(open + "<invstOrSec>".length, close));
      this.buffer = this.buffer.slice(close + "</invstOrSec>".length);
    }

    /*
      Two ways the buffer could grow without bound, both guarded.

      Before the first position it is the header, which is twenty kilobytes in
      practice and is capped in case a malformed document never opens one.
      After it, the buffer only ever holds a partial position, so nothing but a
      document with an unclosed tag can make it grow — and that document would
      otherwise consume the whole filing into memory, which is the thing this
      class exists to avoid.
    */
    if (this.header === null) {
      this.headerBytes = this.buffer.length;
      if (this.headerBytes > MAX_HEADER_BYTES) this.buffer = this.buffer.slice(0, MAX_HEADER_BYTES);
    } else if (this.buffer.length > MAX_PENDING_BYTES) {
      this.buffer = this.buffer.slice(-MAX_PENDING_BYTES);
    }
  }

  /** Folds one position into the totals, keeping it only if it is large. */
  private take(block: string): void {
    this.count += 1;

    // `title` is the fallback because a handful of positions — cash sweeps
    // especially — carry one and no `name`.
    const name = tag(block, "name") ?? tag(block, "title");
    if (!name) return;

    const debt = /<debtSec>([\s\S]*?)<\/debtSec>/i.exec(block)?.[1] ?? null;

    const holding: FundHolding = {
      name,
      cusip: present(tag(block, "cusip")),
      isin: present(/<isin\b[^>]*value="([^"]*)"/i.exec(block)?.[1]?.trim() ?? null),
      percent: num(block, "pctVal"),
      valueUsd: num(block, "valUSD"),
      assetCategory: present(tag(block, "assetCat")),
      country: present(tag(block, "invCountry")),
      isShort: (present(tag(block, "payoffProfile")) ?? "").toLowerCase() === "short",
      // Scoped to <debtSec>, not read from the whole position: a derivative
      // carries its own maturity, and a swap's expiry is not a bond's.
      coupon: debt ? num(debt, "annualizedRt") : null,
      maturity: debt ? tag(debt, "maturityDt") : null,
    };

    if (holding.percent !== null) {
      const asset = holding.assetCategory ?? "";
      const country = holding.country ?? "";
      this.assetTotals.set(asset, (this.assetTotals.get(asset) ?? 0) + holding.percent);
      this.countryTotals.set(country, (this.countryTotals.get(country) ?? 0) + holding.percent);
    }

    /*
      The kept list is trimmed in batches rather than on every position.

      Sorting on each of eighteen thousand insertions is the obvious version
      and the slow one. Letting it grow to a few multiples of the limit and
      then cutting costs a handful of sorts across the whole filing, and the
      list never holds more than a hundred positions.
    */
    this.kept.push(holding);
    if (this.kept.length >= this.limit * 4) this.trim();
  }

  private trim(): void {
    // By absolute value: a short is reported negative, so ordering by the
    // signed number would drop a fund's largest bets first — which for an
    // inverse or long/short fund is precisely what a reader came to see.
    this.kept.sort((a, b) => Math.abs(b.valueUsd ?? 0) - Math.abs(a.valueUsd ?? 0));
    this.kept = this.kept.slice(0, Math.max(this.limit, TOP_FOR_CONCENTRATION));
  }

  /**
   * The finished portfolio, or null.
   *
   * Null for a document that is not an N-PORT, rather than an empty portfolio:
   * a fund that genuinely holds nothing and a fetch that failed must not
   * render the same way.
   */
  finish(): FundPortfolio | null {
    // A document with no positions at all never set the header from a
    // boundary, so what is left in the buffer is the whole of it.
    const header = this.header ?? this.buffer;
    if (!/<(?:\w+:)?genInfo\b/i.test(header)) return null;

    this.trim();

    return {
      seriesName: tag(header, "seriesName"),
      registrantName: tag(header, "regName"),
      asOf: tag(header, "repPdDate"),
      netAssets: num(header, "netAssets"),
      totalAssets: num(header, "totAssets"),
      holdingCount: this.count,
      byAsset: toBreakdown(this.assetTotals, "assetCategory"),
      byCountry: toBreakdown(this.countryTotals, "country"),
      topTenPercent: concentration(this.kept, TOP_FOR_CONCENTRATION),
      holdings: this.kept.slice(0, this.limit),
      monthlyReturns: monthlyReturns(header),
    };
  }
}

/** Ten is the conventional concentration measure, and it fixes what to keep. */
const TOP_FOR_CONCENTRATION = 10;
/** Headers run to about twenty kilobytes; this is only a guard on a malformed one. */
const MAX_HEADER_BYTES = 4 * 1024 * 1024;
/** After the header the buffer holds at most a partial position. */
const MAX_PENDING_BYTES = 1024 * 1024;

/**
 * Parses one N-PORT submission held in memory.
 *
 * The same reader with the whole document as a single chunk, so the streaming
 * path and this one cannot drift apart. Used by the tests and by any caller
 * that already has the text.
 */
export function parseNport(xml: string, options: ParseOptions = {}): FundPortfolio | null {
  const reader = new NportReader(options);
  reader.push(xml);
  return reader.finish();
}
/**
 * The three monthly total returns, oldest first.
 *
 * Reported per share class as attributes on a single element. A fund with
 * several classes files one element each and they differ by fee, so the first
 * is taken rather than merged — averaging two share classes would produce a
 * return figure that belongs to neither.
 */
function monthlyReturns(xml: string): number[] {
  const el = /<monthlyTotReturn\b([^>]*)\/>/i.exec(xml)?.[1];
  if (!el) return [];

  return (["rtn1", "rtn2", "rtn3"] as const)
    .map((key) => {
      const raw = new RegExp(`${key}="([^"]*)"`).exec(el)?.[1];
      const parsed = raw === undefined ? NaN : Number(raw);
      return Number.isFinite(parsed) ? parsed : null;
    })
    .filter((n): n is number => n !== null);
}

export interface Breakdown {
  key: string;
  label: string;
  /** Percent of net assets. */
  percent: number;
}

/**
 * Turns the running totals into a sorted breakdown.
 *
 * Takes the accumulated map rather than a list of holdings, because by the
 * time this runs the holdings are gone — only the largest were kept. That is
 * the point: a breakdown derived from the top twenty positions would describe
 * the top twenty and be presented as though it described the fund. For an S&P
 * 500 tracker it would report the country mix of its twenty largest holdings,
 * all American, and call that the fund's exposure.
 */
function toBreakdown(
  totals: Map<string, number>,
  field: "assetCategory" | "country",
): Breakdown[] {
  return [...totals.entries()]
    .map(([key, percent]) => ({
      key,
      label: field === "country" ? countryLabel(key || null) : assetLabel(key || null),
      percent,
    }))
    .sort((a, b) => b.percent - a.percent);
}

/** Combined weight of the largest `n` positions, in percent of net assets. */
function concentration(holdings: FundHolding[], n: number): number | null {
  const top = holdings.slice(0, n).filter((h) => h.percent !== null);
  if (top.length === 0) return null;
  return top.reduce((sum, h) => sum + (h.percent ?? 0), 0);
}
