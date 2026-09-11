import type { NormalizedFundamentals } from "../fundamentals/types";

/**
 * Chart timeframes. The intraday buckets are the reason Twelve Data is used
 * for price data rather than Finnhub, whose free tier no longer serves candles.
 */
export type Timeframe = "1Min" | "5Min" | "15Min" | "1Hour" | "1Day" | "1Week";

export const TIMEFRAMES: { value: Timeframe; label: string; intraday: boolean }[] = [
  { value: "1Min", label: "1m", intraday: true },
  { value: "5Min", label: "5m", intraday: true },
  { value: "15Min", label: "15m", intraday: true },
  { value: "1Hour", label: "1h", intraday: true },
  { value: "1Day", label: "1D", intraday: false },
  { value: "1Week", label: "1W", intraday: false },
];

/** A single OHLCV candle. `time` is a Unix timestamp in seconds (UTC). */
export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

/**
 * How fresh a price is. Surfaced in the UI as a badge so a user always knows
 * whether they are looking at a live price or a delayed one — free tiers stream
 * IEX in real time but consolidated data is 15 minutes behind.
 */
/**
 * How current a quote is. "stale" is set by the failover layer, never by a
 * provider: a quote whose own timestamp is days old, kept only because nothing
 * current could be found.
 */
export type PriceFreshness = "realtime-iex" | "delayed-15min" | "end-of-day" | "stale" | "unknown";

export interface Quote {
  symbol: string;
  price: number | null;
  change: number | null;
  changePercent: number | null;
  previousClose: number | null;
  dayHigh: number | null;
  dayLow: number | null;
  volume: number | null;
  freshness: PriceFreshness;
  asOf: string | null;
  /**
   * The currency the shares trade in, which need not be the one the company
   * keeps its books in — SK hynix files in won and lists in New York.
   */
  currency?: string | null;
}

export interface CompanyProfile {
  symbol: string;
  name: string;
  exchange: string | null;
  country: string | null;
  currency: string | null;
  sicCode: string | null;
  sicDescription: string | null;
  industry: string | null;
  website: string | null;
  logo: string | null;
  marketCap: number | null;
  sharesOutstanding: number | null;
  cik: string | null;
  description: string | null;
  /**
   * EDGAR's own classification: "operating", "investment", or "other".
   * The strongest keyless signal of whether a symbol is a company or a fund —
   * QQQ reports "investment" while Apple reports "operating".
   */
  entityType?: string | null;
}

export interface NewsItem {
  id: string;
  headline: string;
  summary: string | null;
  source: string;
  url: string;
  publishedAt: string;
  imageUrl: string | null;
}

/**
 * Something that happened to the shares, marked on the price chart.
 *
 * A price history alone invites wrong conclusions. A 10:1 split looks like a
 * 90% collapse, a dividend looks like an unexplained overnight drop, and a gap
 * of either kind is exactly the sort of thing a newcomer reads as a disaster.
 * Marking the cause is the difference between a chart that informs and one that
 * misleads.
 */
export interface CorporateEvent {
  kind: "dividend" | "split" | "earnings";
  /** Epoch seconds, matching the bar times the chart is drawn from. */
  time: number;
  /** Short text for the marker itself. */
  label: string;
  /** A full sentence for the legend, in plain English. */
  detail: string;
}

/** A regulatory filing, linked directly to its source. */
export interface Filing {
  form: string;
  filedAt: string;
  periodOfReport: string | null;
  description: string | null;
  url: string;
  /**
   * For an 8-K, the comma-separated item numbers it reports under — "2.02" is
   * results, "4.02" is a restatement. Null for every other form, which have a
   * fixed meaning and need no further qualification.
   */
  items?: string | null;
}

/**
 * What kind of instrument a symbol refers to.
 *
 * This matters because funds file no financial statements. SEC `companyfacts`
 * returns 404 for SPY, and most ETFs (VTI, VOO, IWM) are absent from EDGAR's
 * ticker file entirely — so every balance-sheet score is meaningless for them
 * and must be suppressed rather than computed from nothing.
 */
export type InstrumentType = "stock" | "etf" | "unknown";

export interface SymbolSearchResult {
  symbol: string;
  name: string;
  exchange: string | null;
  cik: string | null;
  type?: InstrumentType;
  country?: string | null;
  /**
   * False when the symbol exists but this deployment cannot analyse it — a
   * listing outside SEC coverage, with no filings to score.
   */
  supported?: boolean;
}

/**
 * The contract every data source implements.
 *
 * Adding a provider means implementing this interface and registering it in
 * `index.ts` — no page or component changes. This is what makes the jump from
 * the free US-only stack to worldwide coverage a configuration change.
 */
export interface MarketDataProvider {
  readonly name: string;
  /** False when required credentials are absent, so the UI can explain why. */
  isConfigured(): boolean;

  getBars(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Bar[]>;
  getQuote(symbol: string): Promise<Quote | null>;
  getProfile(symbol: string): Promise<CompanyProfile | null>;
  getFundamentals(symbol: string): Promise<NormalizedFundamentals | null>;
  getNews(symbol: string, limit?: number): Promise<NewsItem[]>;
  getFilings(symbol: string, limit?: number): Promise<Filing[]>;
  searchSymbols(query: string, limit?: number): Promise<SymbolSearchResult[]>;
}

/** Raised when a provider is called without the credentials it needs. */
export class ProviderNotConfiguredError extends Error {
  constructor(provider: string, envVars: string[]) {
    super(
      `${provider} is not configured. Set ${envVars.join(" and ")} in your environment. ` +
        `See .env.example for setup instructions.`,
    );
    this.name = "ProviderNotConfiguredError";
  }
}
