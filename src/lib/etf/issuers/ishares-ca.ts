import type { EtfProfile } from "../../providers/alphavantage";

/**
 * iShares Canada — fees, size and every holding, from BlackRock's own site.
 *
 * Two public files, both served without a key. The fund list the site's
 * product screener reads carries every iShares Canada ETF's MER, launch date
 * and net assets in one response; each fund page links a holdings download
 * listing every position with its weight, sector and exchange. Both are what
 * the site hands any visitor, and BlackRock's robots.txt leaves them open.
 *
 * Neither is a documented API, so every step fails soft: a changed shape, a
 * refusal or a slow response returns null, and the page falls back to
 * whatever else it has.
 */

const SITE = "https://www.blackrock.com";

const FUND_LIST_URL =
  `${SITE}/ca/investors/en/product-screener/product-screener-v3.1.jsn` +
  "?dcrPath=/templatedata/config/product-screener-v3/data/en/ca-one/product-screener-backend-config" +
  "&siteEntryPassthrough=true";

/**
 * The page component the holdings download hangs off.
 *
 * The same on every iShares Canada fund page checked — XIC, XBB, XUS and
 * XEQT — which is what lets the link be built from the fund list rather than
 * read out of each fund's page first.
 */
const HOLDINGS_COMPONENT = "1464253357814";

/** Says who is asking, rather than passing as a browser. */
const HEADERS = {
  "User-Agent": "Mozilla/5.0 (compatible; WylthIQ/1.0; +https://wylthiq.com)",
  Accept: "application/json, text/csv, */*",
};

/** How long a fund page waits on BlackRock before rendering without it. */
const TIMEOUT_MS = 8000;

/** Net assets move daily and the fee about once a year; a day serves both. */
const FUND_LIST_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Holdings are republished each business day. Kept here rather than in Next's
 * data cache because the largest files are past what that cache stores —
 * XEQT's runs to 2 MB.
 */
const HOLDINGS_TTL_MS = 12 * 60 * 60 * 1000;
/** A failed download is retried sooner, but not on every page view. */
const HOLDINGS_FAILURE_TTL_MS = 10 * 60 * 1000;
const HOLDINGS_CACHE_MAX = 200;

const TOP_HOLDINGS = 10;

/** Above this an MER is a units mistake, not a fee. Percent units. */
const MAX_CREDIBLE_MER = 25;

/** A figure as the fund list writes one: display text and a raw number, or "-". */
type Figure = { d?: string; r?: number } | string | null | undefined;

export interface ISharesFund {
  localExchangeTicker?: string;
  fundName?: string;
  /** Percent units: 0.06 is 0.06%. */
  mer?: Figure;
  /** A compact date, 20010216. */
  inceptionDate?: Figure;
  /** Canadian dollars, as the screener's own column says. */
  totalNetAssets?: Figure;
  /** Percent units. */
  twelveMonTrlYield?: Figure;
  productPageUrl?: string;
}

export interface ISharesHolding {
  ticker: string;
  name: string;
  sector: string;
  assetClass: string;
  /** A fraction of the fund: 0.0779 is 7.79%. */
  weight: number;
  exchange: string;
  maturity: string | null;
  coupon: string | null;
}

export interface ISharesHoldings {
  asOf: string | null;
  holdings: ISharesHolding[];
}

function rawFigure(figure: Figure): number | null {
  if (!figure || typeof figure !== "object") return null;
  return typeof figure.r === "number" && Number.isFinite(figure.r) ? figure.r : null;
}

/** 20010216 → "2001-02-16", the way the fund list stores a date. */
export function isoFromCompactDate(value: number | null): string | null {
  if (value == null) return null;
  const digits = String(Math.trunc(value));
  if (!/^\d{8}$/.test(digits)) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * "Sep 9, 2026" → "2026-09-09".
 *
 * Built from the string's own parts rather than through `Date`, so no
 * timezone can move a holdings date onto the day before.
 */
export function isoFromLongDate(value: string | null | undefined): string | null {
  const match = value?.trim().match(/^([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{1,2}),\s*(\d{4})$/);
  if (!match) return null;
  const month = MONTHS[match[1].toLowerCase()];
  return month ? `${match[3]}-${month}-${match[2].padStart(2, "0")}` : null;
}

/** One CSV line, honouring quotes: "2,652,727,561.33" is one cell, not four. */
export function splitCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') {
        quoted = false;
      } else {
        cell += ch;
      }
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += ch;
    }
  }

  cells.push(cell);
  return cells;
}

/**
 * The fund list, keyed by Toronto ticker.
 *
 * The response is an object of funds keyed by BlackRock's portfolio id. Rows
 * without a ticker or a product page are skipped: without the one the fund
 * cannot be found, and without the other its holdings cannot be.
 */
export function indexFundList(json: unknown): Map<string, ISharesFund> {
  const funds = new Map<string, ISharesFund>();
  if (!json || typeof json !== "object") return funds;

  for (const row of Object.values(json as Record<string, unknown>)) {
    if (!row || typeof row !== "object") continue;
    const fund = row as ISharesFund;
    const ticker = fund.localExchangeTicker?.trim().toUpperCase();
    if (!ticker || ticker === "-" || !fund.productPageUrl) continue;
    if (!funds.has(ticker)) funds.set(ticker, fund);
  }

  return funds;
}

/**
 * The fund's own positions, out of its holdings download.
 *
 * The first section only. A fund of funds appends a second one listing what
 * the funds it holds own in turn — XEQT's runs to eight thousand rows of
 * NVIDIA and Apple — and reading on would report XEQT holding NVIDIA directly,
 * at a weight it does not have.
 */
export function parseHoldingsCsv(text: string): ISharesHoldings {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  let asOf: string | null = null;
  let columns: Map<string, number> | null = null;
  const holdings: ISharesHolding[] = [];

  for (const line of lines) {
    const cells = splitCsvLine(line);
    const first = (cells[0] ?? "").trim();

    if (!columns) {
      if (/^fund holdings as of$/i.test(first)) asOf = isoFromLongDate(cells[1]);
      else if (first === "Ticker") columns = new Map(cells.map((c, i) => [c.trim(), i]));
      continue;
    }

    // The section ends at its first blank line, which the file writes as a
    // non-breaking space rather than an empty one.
    if (line.replace(/\u00A0/g, "").trim() === "") break;

    const header = columns;
    const cell = (name: string): string => {
      const i = header.get(name);
      return i === undefined ? "" : (cells[i] ?? "").trim();
    };

    const weight = Number(cell("Weight (%)").replace(/,/g, ""));
    if (!Number.isFinite(weight)) continue;

    holdings.push({
      ticker: cell("Ticker"),
      name: cell("Name"),
      sector: cell("Sector"),
      assetClass: cell("Asset Class"),
      weight: weight / 100,
      exchange: cell("Exchange"),
      maturity: present(cell("Maturity")),
      coupon: present(cell("Coupon (%)")),
    });
  }

  return { asOf, holdings };
}

function present(value: string): string | null {
  return value && value !== "-" ? value : null;
}

/** Cash, currency forwards and futures all file under this one sector. */
const CASH_SECTOR = /^cash and\/or derivatives$/i;

/** Where a listed share can be matched to a company this site scores. */
const US_EXCHANGE = /^(nyse arca|nasdaq|new york stock exchange|nyse|cboe bzx)/i;

/** A position that is itself a fund — how a fund of funds shows up. */
const A_FUND = /\bishares\b|\betf\b/i;

/**
 * The link the fund page's "download holdings" button points at.
 *
 * Exported so a test can pin it against the link BlackRock's own page
 * carries, which is the only evidence the construction is right.
 */
export function holdingsUrl(ticker: string, fund: ISharesFund): string | null {
  if (!fund.productPageUrl) return null;
  const params = new URLSearchParams({
    fileType: "csv",
    fileName: `${ticker}_holdings`,
    dataType: "fund",
  });
  return `${SITE}${fund.productPageUrl.replace(/\/$/, "")}/${HOLDINGS_COMPONENT}.ajax?${params}`;
}

/**
 * The profile for one fund, from its fund-list row and its holdings file.
 *
 * Null only when the row describes no fund at all — neither a fee nor a
 * launch date — the same test the other providers' mappers use. A missing
 * holdings file costs the holdings and nothing else: the fee is still the
 * manager's own and is still worth showing.
 */
export function buildISharesProfile(
  fund: ISharesFund,
  file: ISharesHoldings | null,
): EtfProfile | null {
  const mer = rawFigure(fund.mer);
  const expenseRatio = mer != null && mer >= 0 && mer <= MAX_CREDIBLE_MER ? mer / 100 : null;
  const inceptionDate = isoFromCompactDate(rawFigure(fund.inceptionDate));
  if (expenseRatio === null && !inceptionDate) return null;

  const positions = (file?.holdings ?? []).filter((h) => !CASH_SECTOR.test(h.sector));
  const byWeight = [...positions].sort((a, b) => b.weight - a.weight);
  const netAssets = rawFigure(fund.totalNetAssets);
  const trailingYield = rawFigure(fund.twelveMonTrlYield);

  return {
    expenseRatio,
    dividendYield: trailingYield == null ? null : trailingYield / 100,
    turnover: null,
    inceptionDate,
    // iShares Canada has no leveraged funds, and inventing the warning this
    // drives would be worse than missing one.
    leveraged: false,
    sectors: sectorsOf(positions),
    /*
      Only shares listed in the US, because that is where this site's scores
      come from — and a Toronto ticker matched against them would be a
      different company as often as the same one: T is Telus in Toronto and
      AT&T in New York.
    */
    holdings: byWeight
      .filter(
        (h) =>
          h.assetClass === "Equity" &&
          US_EXCHANGE.test(h.exchange) &&
          !A_FUND.test(h.name) &&
          h.ticker !== "",
      )
      .map((h) => ({ symbol: h.ticker.toUpperCase(), weight: h.weight })),
    topHoldings: byWeight.slice(0, TOP_HOLDINGS).map((h) => ({
      name: h.name,
      symbol: h.ticker || null,
      weight: h.weight,
      detail: bondDetail(h),
    })),
    holdingCount: file ? positions.length : null,
    netAssets,
    netAssetsCurrency: netAssets == null ? null : "CAD",
    source: {
      name: "iShares Canada",
      url: `${SITE}${fund.productPageUrl ?? ""}`,
      asOf: file?.asOf ?? null,
      publishedByManager: true,
    },
  };
}

/**
 * Sector weights, summed from the positions — or none for a fund of funds.
 *
 * A fund holding other funds files each one under a sector that describes
 * nothing: XEQT's file puts its US equity fund under "Other" and its Canadian
 * one under "Financials". Summing those would publish a sector mix the fund
 * does not have, so a fund that holds funds gets no breakdown here.
 */
function sectorsOf(positions: ISharesHolding[]): { sector: string; weight: number }[] {
  // Equity positions only: XBB holds bonds issued by FIRST NATIONS ETF LP,
  // which is a borrower with "ETF" in its name, not a fund inside a fund.
  if (positions.some((h) => h.assetClass === "Equity" && A_FUND.test(h.name))) return [];

  const totals = new Map<string, number>();
  for (const h of positions) {
    if (!h.sector || h.sector === "-") continue;
    totals.set(h.sector, (totals.get(h.sector) ?? 0) + h.weight);
  }

  return [...totals]
    .map(([sector, weight]) => ({ sector, weight }))
    .sort((a, b) => b.weight - a.weight);
}

/**
 * "2.75% · due 2030-09" for a bond, and nothing for a share.
 *
 * Without it a bond fund's list reads "CANADA (GOVERNMENT OF)" ten times over
 * — accurate, and impossible to tell apart.
 */
function bondDetail(h: ISharesHolding): string | null {
  if (h.assetClass !== "Fixed Income") return null;
  const parts: string[] = [];
  if (h.coupon) parts.push(`${h.coupon}%`);
  const maturity = isoFromLongDate(h.maturity);
  if (maturity) parts.push(`due ${maturity.slice(0, 7)}`);
  return parts.length > 0 ? parts.join(" · ") : null;
}

let fundList: { at: number; value: Promise<Map<string, ISharesFund>> } | null = null;

function loadFundList(): Promise<Map<string, ISharesFund>> {
  if (fundList && Date.now() - fundList.at < FUND_LIST_TTL_MS) return fundList.value;

  const value = (async () => {
    const res = await fetch(FUND_LIST_URL, {
      headers: HEADERS,
      next: { revalidate: FUND_LIST_TTL_MS / 1000 },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`iShares fund list: HTTP ${res.status}`);
    return indexFundList(await res.json());
  })();

  const entry = { at: Date.now(), value };
  fundList = entry;
  // A failure is not kept, or one bad response would stand for a day.
  value.catch(() => {
    if (fundList === entry) fundList = null;
  });
  return value;
}

const holdingsCache = new Map<string, { at: number; ttl: number; value: ISharesHoldings | null }>();

async function loadHoldings(ticker: string, fund: ISharesFund): Promise<ISharesHoldings | null> {
  const hit = holdingsCache.get(ticker);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;

  const url = holdingsUrl(ticker, fund);
  if (!url) return null;

  const parsed = await fetch(url, {
    headers: HEADERS,
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
    .then(async (res) => (res.ok ? parseHoldingsCsv(await res.text()) : null))
    .catch(() => null);

  // A file that parses to nothing has changed shape; it is treated as missing.
  const value = parsed && parsed.holdings.length > 0 ? parsed : null;

  holdingsCache.delete(ticker);
  holdingsCache.set(ticker, {
    at: Date.now(),
    ttl: value ? HOLDINGS_TTL_MS : HOLDINGS_FAILURE_TTL_MS,
    value,
  });
  while (holdingsCache.size > HOLDINGS_CACHE_MAX) {
    const oldest = holdingsCache.keys().next().value;
    if (oldest === undefined) break;
    holdingsCache.delete(oldest);
  }

  return value;
}

/**
 * The profile for an iShares Canada ETF, by its Toronto ticker, or null.
 *
 * The bare Toronto ticker: which listing was meant is decided by the caller
 * from the exchange suffix, because several of these tickers are also
 * unrelated US funds.
 */
export async function getISharesCanadaProfile(ticker: string): Promise<EtfProfile | null> {
  const upper = ticker.trim().toUpperCase();
  const funds = await loadFundList().catch(() => null);
  const fund = funds?.get(upper);
  if (!fund) return null;

  const file = await loadHoldings(upper, fund);
  return buildISharesProfile(fund, file);
}
