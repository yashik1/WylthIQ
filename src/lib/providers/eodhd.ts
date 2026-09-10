import type {
  CanonicalField,
  Fact,
  FinancialPeriod,
  NormalizedFundamentals,
} from "../fundamentals/types";
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
import { ProviderNotConfiguredError } from "./types";
import { parseEodhdAnalystRatings, type AnalystView } from "../signals/analysts";
import type { EtfProfile } from "./alphavantage";

const BASE = "https://eodhd.com/api";

/**
 * Says, once, why EODHD refused a request.
 *
 * Every call here treats a non-OK response as "no data" and returns null,
 * which is right for the page and useless for whoever runs it: a wrong key, a
 * plan without the endpoint and a symbol EODHD does not cover all look alike
 * from outside. That silence is how a failing key took every price off the
 * live site with nothing in the logs to say why.
 *
 * Once per endpoint and status for the life of the process, so a bad key does
 * not write a line per page view. The URL is never logged: it carries the API
 * token as a query parameter.
 */
const reported = new Set<string>();

function reportRefusal(endpoint: string, status: number): void {
  const key = `${endpoint}:${status}`;
  if (reported.has(key)) return;
  reported.add(key);
  const hint =
    status === 401 || status === 403
      ? "check EODHD_API_KEY is valid and that the plan includes this endpoint"
      : status === 404
        ? "the symbol is not covered"
        : status === 429
          ? "rate or daily limit reached"
          : "unexpected response";
  console.warn(`[eodhd] ${endpoint} refused with HTTP ${status} — ${hint}.`);
}

/**
 * EODHD — the worldwide upgrade path.
 *
 * Dormant until `EODHD_API_KEY` is set, at which point it is layered behind the
 * free US/Canada stack: every method still asks the free sources first and
 * consults EODHD only where they come up empty — see `LayeredProvider` in
 * index.ts. It once replaced the stack outright, and a key it would not serve
 * took every price off the site.
 *
 * Freshness note: EODHD's WebSocket feed is genuinely real time for US
 * equities, forex and crypto, but international exchanges are 15-20 minutes
 * delayed because of per-exchange licensing. Quotes are therefore reported as
 * `delayed-15min` for non-US symbols rather than claiming to be live.
 */
export class EodhdProvider implements MarketDataProvider {
  readonly name = "EODHD";

  private get token() {
    return process.env.EODHD_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.token);
  }

  private url(path: string, params: Record<string, string> = {}): string {
    if (!this.isConfigured()) {
      throw new ProviderNotConfiguredError("EODHD", ["EODHD_API_KEY"]);
    }
    const search = new URLSearchParams({ ...params, api_token: this.token!, fmt: "json" });
    return `${BASE}${path}?${search}`;
  }

  /** EODHD expects `TICKER.EXCHANGE`; bare tickers default to US. */
  private qualify(symbol: string): string {
    return symbol.includes(".") ? symbol : `${symbol}.US`;
  }

  private isUs(symbol: string): boolean {
    return this.qualify(symbol).endsWith(".US");
  }

  async getBars(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Bar[]> {
    const s = this.qualify(symbol);

    if (timeframe === "1Day" || timeframe === "1Week") {
      const res = await fetch(
        this.url(`/eod/${s}`, {
          from: from.toISOString().slice(0, 10),
          to: to.toISOString().slice(0, 10),
          period: timeframe === "1Week" ? "w" : "d",
        }),
        { next: { revalidate: 3600 } },
      );
      if (!res.ok) return [];
      const rows = (await res.json()) as {
        date: string; open: number; high: number; low: number; close: number; volume: number;
      }[];
      return (rows ?? []).map((r) => ({
        time: Math.floor(Date.parse(`${r.date}T00:00:00Z`) / 1000),
        open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
      }));
    }

    // EODHD supports 1m, 5m and 1h natively; 15m is resampled from 5m.
    const interval = timeframe === "1Hour" ? "1h" : timeframe === "1Min" ? "1m" : "5m";
    const res = await fetch(
      this.url(`/intraday/${s}`, {
        interval,
        from: String(Math.floor(from.getTime() / 1000)),
        to: String(Math.floor(to.getTime() / 1000)),
      }),
      { next: { revalidate: 60 } },
    );
    if (!res.ok) return [];

    const rows = (await res.json()) as {
      timestamp: number; open: number; high: number; low: number; close: number; volume: number;
    }[];
    const bars: Bar[] = (rows ?? [])
      .filter((r) => r.open != null && r.close != null)
      .map((r) => ({
        time: r.timestamp,
        open: r.open, high: r.high, low: r.low, close: r.close, volume: r.volume,
      }));

    return timeframe === "15Min" ? resample(bars, 900) : bars;
  }

  async getQuote(symbol: string): Promise<Quote | null> {
    const res = await fetch(this.url(`/real-time/${this.qualify(symbol)}`), {
      next: { revalidate: 30 },
    });
    if (!res.ok) {
      reportRefusal("/real-time", res.status);
      return null;
    }

    const q = (await res.json()) as {
      close?: number; previousClose?: number; change?: number;
      change_p?: number; high?: number; low?: number; volume?: number; timestamp?: number;
    };
    const price = typeof q.close === "number" ? q.close : null;

    return {
      symbol: symbol.toUpperCase(),
      price,
      change: q.change ?? null,
      changePercent: q.change_p != null ? q.change_p / 100 : null,
      previousClose: q.previousClose ?? null,
      dayHigh: q.high ?? null,
      dayLow: q.low ?? null,
      volume: q.volume ?? null,
      // Only US equities are genuinely live on this feed.
      freshness: this.isUs(symbol) ? "realtime-iex" : "delayed-15min",
      asOf: q.timestamp ? new Date(q.timestamp * 1000).toISOString() : null,
    };
  }

  async getProfile(symbol: string): Promise<CompanyProfile | null> {
    const raw = await this.fetchFundamentals(symbol);
    if (!raw) return null;

    const g = raw.General ?? {};
    return {
      symbol: symbol.toUpperCase(),
      name: g.Name ?? symbol,
      exchange: g.Exchange ?? null,
      country: g.CountryISO ?? null,
      currency: g.CurrencyCode ?? null,
      sicCode: null,
      sicDescription: g.Industry ?? null,
      industry: g.Industry ?? g.Sector ?? null,
      website: g.WebURL ?? null,
      logo: g.LogoURL ? `https://eodhd.com${g.LogoURL}` : null,
      marketCap: raw.Highlights?.MarketCapitalization ?? null,
      sharesOutstanding: raw.SharesStats?.SharesOutstanding ?? null,
      cik: g.CIK ?? null,
      description: g.Description ?? null,
    };
  }

  async getFundamentals(symbol: string): Promise<NormalizedFundamentals | null> {
    const raw = await this.fetchFundamentals(symbol);
    return raw ? mapEodhdFundamentals(raw, symbol) : null;
  }

  private async fetchFundamentals(symbol: string): Promise<EodhdFundamentals | null> {
    const res = await fetch(this.url(`/fundamentals/${this.qualify(symbol)}`), {
      next: { revalidate: 60 * 60 * 12 },
    });
    if (!res.ok) {
      reportRefusal("/fundamentals", res.status);
      return null;
    }
    return (await res.json()) as EodhdFundamentals;
  }

  /**
   * A fund's commercial facts, out of the same fundamentals payload.
   *
   * No new request: `/fundamentals` is already fetched and cached for twelve
   * hours, and `ETF_Data` is sitting in that response. It is also the only
   * source here that reaches beyond the SEC — a Toronto-listed fund files
   * with the CSA through SEDAR+, which has no public API, so an ETF on the
   * TSX had no fee, no holdings and no launch date on this site at all.
   *
   * Returns the same shape as the Alpha Vantage version so the page cannot
   * tell them apart, which is what lets one replace the other.
   */
  async getEtfProfile(symbol: string): Promise<EtfProfile | null> {
    for (const candidate of this.fundCandidates(symbol)) {
      const data = await this.fetchFundamentals(candidate).catch(() => null);
      const profile = mapEodhdEtfProfile(data?.ETF_Data ?? null);
      if (profile) return profile;
    }
    return null;
  }

  /**
   * Which exchange to ask about, when the ticker does not say.
   *
   * `qualify` assumes `.US`, which is right for most of this app and wrong for
   * exactly the funds this method exists to reach: VFV and XIC are Toronto
   * listings, `VFV.US` is nothing, and a fund that files with the CSA has no
   * US listing to fall back on. So an unsuffixed ticker is tried in the US
   * first and then in Toronto.
   *
   * Two requests only when the first misses, and both are cached for twelve
   * hours by `fetchFundamentals` — a US fund still costs one call. Kept to
   * this method rather than changed in `qualify`, because every other caller
   * is a company lookup where the US assumption is correct and a stray
   * Toronto request would be waste.
   */
  private fundCandidates(symbol: string): string[] {
    const upper = symbol.toUpperCase().trim();
    if (upper.includes(".")) return [upper];
    return [`${upper}.US`, `${upper}.TO`];
  }

  /**
   * Published analyst ratings, out of the fundamentals payload.
   *
   * No new request: `/fundamentals` was already being fetched for the
   * statements, and this block was sitting in the same response untyped. Unlike
   * Finnhub's free tier this one carries a consensus target price.
   *
   * See src/lib/signals/analysts.ts for the licensing position — EODHD's
   * standard plans are personal-use only, so displaying this in a product that
   * charges needs their commercial licence first.
   */
  async getAnalystView(symbol: string): Promise<AnalystView | null> {
    const data = await this.fetchFundamentals(symbol);
    return parseEodhdAnalystRatings(data?.AnalystRatings, data?.General?.UpdatedAt ?? null);
  }

  async getNews(symbol: string, limit = 20): Promise<NewsItem[]> {
    const res = await fetch(
      this.url("/news", { s: this.qualify(symbol), limit: String(limit) }),
      { next: { revalidate: 900 } },
    );
    if (!res.ok) return [];

    const items = (await res.json()) as {
      title?: string; content?: string; link?: string; date?: string;
    }[];
    return (items ?? [])
      .filter((n) => n.title && n.link)
      .map((n, i) => ({
        id: `${n.link}-${i}`,
        headline: n.title!,
        summary: n.content ? n.content.slice(0, 280) : null,
        source: "EODHD",
        url: n.link!,
        publishedAt: n.date ?? new Date().toISOString(),
        imageUrl: null,
      }));
  }

  async searchSymbols(query: string, limit = 10): Promise<SymbolSearchResult[]> {
    const res = await fetch(this.url(`/search/${encodeURIComponent(query)}`, {
      limit: String(limit),
    }), { next: { revalidate: 3600 } });
    if (!res.ok) return [];

    const rows = (await res.json()) as {
      Code: string; Name: string; Exchange: string;
    }[];
    return (rows ?? []).map((r) => ({
      symbol: r.Exchange === "US" ? r.Code : `${r.Code}.${r.Exchange}`,
      name: r.Name,
      exchange: r.Exchange,
      cik: null,
    }));
  }

  /** EODHD does not expose a filings index. */
  async getFilings(_symbol: string, _limit?: number): Promise<Filing[]> {
    return [];
  }
}

// ----------------------------------------------------------------- mapping

interface EodhdStatements {
  yearly?: Record<string, Record<string, string | number | null>>;
}

export interface EodhdFundamentals {
  General?: Record<string, string | null> & { CIK?: string; CountryISO?: string };
  /*
    Present only for funds, and the reason a Toronto-listed ETF can have a fee
    on this site at all — it files with the CSA, not the SEC, so nothing in
    EDGAR describes it.
  */
  ETF_Data?: EodhdEtfData;
  Highlights?: { MarketCapitalization?: number };
  SharesStats?: { SharesOutstanding?: number };
  /*
    Analyst opinion, which arrives in the same payload as the statements above
    and went unmapped until now. Declaring it costs no extra request — the
    fetch was already happening for the financials.
  */
  AnalystRatings?: {
    Rating?: number | string;
    TargetPrice?: number | string;
    StrongBuy?: number | string;
    Buy?: number | string;
    Hold?: number | string;
    Sell?: number | string;
    StrongSell?: number | string;
  };
  Financials?: {
    Balance_Sheet?: EodhdStatements;
    Income_Statement?: EodhdStatements;
    Cash_Flow?: EodhdStatements;
  };
}

/** EODHD statement keys mapped onto the canonical schema. */
const BALANCE_SHEET_MAP: Partial<Record<CanonicalField, string>> = {
  assets: "totalAssets",
  liabilities: "totalLiab",
  equity: "totalStockholderEquity",
  currentAssets: "totalCurrentAssets",
  currentLiabilities: "totalCurrentLiabilities",
  cash: "cash",
  receivables: "netReceivables",
  inventory: "inventory",
  ppe: "propertyPlantEquipment",
  longTermDebt: "longTermDebt",
  shortTermDebt: "shortTermDebt",
  retainedEarnings: "retainedEarnings",
};

const INCOME_MAP: Partial<Record<CanonicalField, string>> = {
  revenue: "totalRevenue",
  costOfRevenue: "costOfRevenue",
  grossProfit: "grossProfit",
  operatingIncome: "operatingIncome",
  netIncome: "netIncome",
  incomeBeforeTax: "incomeBeforeTax",
  interestExpense: "interestExpense",
  sga: "sellingGeneralAdministrative",
  depreciation: "depreciationAndAmortization",
};

const CASH_FLOW_MAP: Partial<Record<CanonicalField, string>> = {
  operatingCashFlow: "totalCashFromOperatingActivities",
  capex: "capitalExpenditures",
  dividendsPaid: "dividendsPaid",
};

function toNumber(v: string | number | null | undefined): number | null {
  if (v == null) return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Converts an EODHD fundamentals payload into the same canonical model the SEC
 * normalizer produces, so scoring is identical whichever provider supplied it.
 *
 * Exported separately from the class so it can be unit tested without a key.
 */
export function mapEodhdFundamentals(
  raw: EodhdFundamentals,
  symbol: string,
): NormalizedFundamentals {
  const bs = raw.Financials?.Balance_Sheet?.yearly ?? {};
  const is = raw.Financials?.Income_Statement?.yearly ?? {};
  const cf = raw.Financials?.Cash_Flow?.yearly ?? {};

  const dates = [...new Set([...Object.keys(bs), ...Object.keys(is), ...Object.keys(cf)])]
    .sort()
    .reverse()
    .slice(0, 12);

  const shares = raw.SharesStats?.SharesOutstanding ?? null;

  const annual: FinancialPeriod[] = dates.map((date) => {
    const fiscalYear = Number(date.slice(0, 4));
    const facts: Partial<Record<CanonicalField, Fact>> = {};

    const put = (field: CanonicalField, value: number | null, source: string) => {
      if (value == null) return;
      facts[field] = {
        value,
        unit: "USD",
        end: date,
        fiscalYear,
        fiscalPeriod: "FY",
        form: "annual-report",
        sourceConcept: `eodhd:${source}`,
        sourceFilingUrl: null,
      };
    };

    for (const [field, key] of Object.entries(BALANCE_SHEET_MAP)) {
      put(field as CanonicalField, toNumber(bs[date]?.[key]), key);
    }
    for (const [field, key] of Object.entries(INCOME_MAP)) {
      put(field as CanonicalField, toNumber(is[date]?.[key]), key);
    }
    for (const [field, key] of Object.entries(CASH_FLOW_MAP)) {
      put(field as CanonicalField, toNumber(cf[date]?.[key]), key);
    }

    // Same derivation the SEC normalizer applies, for consistency.
    if (!facts.liabilities && facts.assets && facts.equity) {
      facts.liabilities = {
        ...facts.assets,
        value: facts.assets.value - facts.equity.value,
        sourceConcept: "derived:Assets-Equity",
        derived: true,
      };
    }

    if (shares != null && shares > 0) put("sharesOutstanding", shares, "SharesOutstanding");

    // EODHD exposes no filings index (see getFilings below) and no filing date
    // on the fundamentals payload either, so filedAt is left null rather than
    // guessed at from the period end — which would understate the real
    // reporting lag and defeat the point of tracking it at all.
    return { fiscalYear, fiscalPeriod: "FY", end: date, form: "annual-report", facts, filedAt: null };
  });

  const latest = annual[0];
  const allFields = [
    ...Object.keys(BALANCE_SHEET_MAP),
    ...Object.keys(INCOME_MAP),
    ...Object.keys(CASH_FLOW_MAP),
  ] as CanonicalField[];

  return {
    cik: raw.General?.CIK ?? "",
    entityName: raw.General?.Name ?? symbol,
    taxonomy: "us-gaap",
    annual,
    missingFields: latest ? allFields.filter((f) => latest.facts[f] === undefined) : allFields,
  };
}

/** Aggregates finer bars into a coarser bucket, used to build 15m from 5m. */
export function resample(bars: Bar[], bucketSeconds: number): Bar[] {
  const out: Bar[] = [];
  let current: Bar | null = null;

  for (const bar of bars) {
    const bucket = Math.floor(bar.time / bucketSeconds) * bucketSeconds;
    if (!current || current.time !== bucket) {
      if (current) out.push(current);
      current = { ...bar, time: bucket };
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += bar.volume;
    }
  }
  if (current) out.push(current);
  return out;
}

/**
 * EODHD's fund block, as far as this app reads it.
 *
 * Everything arrives as a string, and several fields are optional in practice
 * even where the schema suggests otherwise.
 */
interface EodhdEtfData {
  Inception_Date?: string;
  Yield?: string;
  NetExpenseRatio?: string;
  Ongoing_Charge?: string;
  AnnualHoldingsTurnover?: string;
  Sector_Weights?: Record<string, { "Equity_%"?: string } | undefined>;
  Holdings?: Record<string, { Code?: string; "Assets_%"?: string } | undefined>;
}

/**
 * Percentages here, fractions in the app.
 *
 * This is the one thing in this file that would be silently, badly wrong. The
 * `EtfProfile` contract is fractions, because that is what Alpha Vantage
 * sends and what `percent()` renders — 0.0018 prints as 0.18%. EODHD sends the
 * same quantity as a percentage: 0.18 means 0.18%. Passing one through
 * unconverted puts an 18% annual fee on a fund that charges 0.18%, and it
 * looks like a real number.
 *
 * So everything is divided, and then checked. No fund charges a quarter of
 * its assets a year, and a figure that claims to has been read in the wrong
 * units — dropping it is better than rendering it, because a reader cannot
 * tell a units bug from an expensive fund.
 */
const MAX_CREDIBLE_FEE = 0.25;

function pctToFraction(raw: string | undefined, cap = 1): number | null {
  if (raw == null || raw === "" || raw.toLowerCase?.() === "n/a") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  const fraction = n / 100;
  return fraction > cap ? null : fraction;
}

/** The provider's own title casing is inconsistent; the app's is not. */
function tidySector(name: string): string {
  return name.replace(/_/g, " ").replace(/\s+/g, " ").trim();
}

export function mapEodhdEtfProfile(data: EodhdEtfData | null | undefined): EtfProfile | null {
  if (!data) return null;

  // Net expense ratio is the headline; the ongoing charge is the European
  // name for the same idea and stands in when the first is absent.
  const expenseRatio =
    pctToFraction(data.NetExpenseRatio, MAX_CREDIBLE_FEE) ??
    pctToFraction(data.Ongoing_Charge, MAX_CREDIBLE_FEE);

  const inception =
    data.Inception_Date && data.Inception_Date !== "0000-00-00" ? data.Inception_Date : null;

  // The same test the Alpha Vantage mapper uses: a payload with neither a fee
  // nor a launch date is not describing a fund.
  if (expenseRatio === null && !inception) return null;

  const sectors = Object.entries(data.Sector_Weights ?? {})
    .map(([name, v]) => ({ sector: tidySector(name), weight: pctToFraction(v?.["Equity_%"]) }))
    .filter((s): s is { sector: string; weight: number } => Boolean(s.sector) && s.weight !== null)
    .sort((a, b) => b.weight - a.weight);

  const holdings = Object.entries(data.Holdings ?? {})
    .map(([key, v]) => ({
      // Keyed as "AAPL.US"; the app matches on the bare ticker.
      symbol: (v?.Code ?? key.split(".")[0] ?? "").toUpperCase().trim(),
      weight: pctToFraction(v?.["Assets_%"]),
    }))
    .filter((h): h is { symbol: string; weight: number } => Boolean(h.symbol) && h.weight !== null)
    .sort((a, b) => b.weight - a.weight);

  return {
    expenseRatio,
    dividendYield: pctToFraction(data.Yield),
    turnover: pctToFraction(data.AnnualHoldingsTurnover),
    inceptionDate: inception,
    // EODHD does not carry a leveraged flag. Absent rather than guessed: this
    // drives a warning, and a false negative is quieter than a false alarm.
    leveraged: false,
    sectors,
    holdings,
  };
}

export const eodhd = new EodhdProvider();
