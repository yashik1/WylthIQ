/**
 * Canonical financial model.
 *
 * SEC filers report under two different XBRL taxonomies: US domestic filers use
 * `us-gaap`, while foreign private issuers (including Canadian 40-F/MJDS filers
 * such as Royal Bank of Canada) use `ifrs-full`. Everything downstream of this
 * module works against the canonical field names below so that scoring never has
 * to care which taxonomy a company reports under.
 */

/** Every financial input the scoring engine can consume. */
export type CanonicalField =
  // Balance sheet
  | "assets"
  | "liabilities"
  | "equity"
  | "currentAssets"
  | "currentLiabilities"
  | "cash"
  | "receivables"
  | "inventory"
  | "ppe"
  | "longTermDebt"
  | "shortTermDebt"
  | "retainedEarnings"
  // Income statement
  | "revenue"
  | "costOfRevenue"
  | "grossProfit"
  | "operatingIncome"
  | "netIncome"
  | "incomeBeforeTax"
  | "interestExpense"
  | "sga"
  | "depreciation"
  // Cash flow
  | "operatingCashFlow"
  | "capex"
  | "dividendsPaid"
  // Share data
  | "sharesOutstanding";

/**
 * A single reported number, always carrying its provenance.
 *
 * Provenance is not optional: the UI links every figure it displays back to the
 * filing it came from, which is a core promise of the product.
 */
export interface Fact {
  value: number;
  unit: string;
  /** Period end date, ISO `YYYY-MM-DD`. */
  end: string;
  /** Period start date for duration concepts (revenue, net income, cash flow). */
  start?: string;
  fiscalYear: number;
  /** `FY`, `Q1`, `Q2`, `Q3`, `Q4`. */
  fiscalPeriod: string;
  /** Filing type the value was taken from: `10-K`, `20-F`, `40-F`, etc. */
  form: string;
  /** Fully qualified source concept, e.g. `us-gaap:Assets` or `ifrs-full:ProfitLoss`. */
  sourceConcept: string;
  /** Link to the filing on EDGAR, or null when the accession number is unavailable. */
  sourceFilingUrl: string | null;
  /**
   * True when the value was computed rather than reported directly — for example
   * `liabilities = assets - equity` for filers that never tag total liabilities.
   */
  derived?: boolean;
  /**
   * ISO date the filing carrying this value was submitted to the SEC, not the
   * date the figure describes. A FY2020 result is typically filed six to ten
   * weeks into 2021, so a reader — or a backtest — that only knew what was
   * public on, say, 2021-01-15 could not yet have seen this number. Absent for
   * a derived fact, which was computed here rather than filed by anyone.
   */
  filed?: string;
}

/** One fiscal period's worth of canonical facts. */
export interface FinancialPeriod {
  fiscalYear: number;
  fiscalPeriod: string;
  end: string;
  form: string;
  facts: Partial<Record<CanonicalField, Fact>>;
  /**
   * The latest `filed` date among this period's own facts — the date the last
   * of them became public. A derived fact carries no filed date of its own, so
   * it does not enter this; the anchor facts (assets, revenue, net income) it
   * is derived from already do.
   */
  filedAt: string | null;
}

/** Which XBRL taxonomy a company reports under. */
export type Taxonomy = "us-gaap" | "ifrs-full";

/** One fiscal year inside an as-reported snapshot. */
export interface AsReportedPeriod {
  fiscalYear: number;
  end: string;
  /** The currency the money figures are in. Share counts are counts. */
  currency: string;
  values: Partial<Record<CanonicalField, number>>;
}

/**
 * A company's annual figures exactly as they stood on the day one annual
 * report was filed.
 *
 * The live figures are the latest word on every period, restatements
 * included, which is right for describing a company today and wrong for
 * describing what anybody could have known a year ago. A snapshot reads only
 * observations filed on or before `asOf`, so a figure corrected later appears
 * here as it was first published, and a year not yet reported is absent.
 *
 * Numbers only, without provenance, because a company carries several of
 * these in an in-process cache and each would otherwise repeat every fact's
 * metadata.
 */
export interface AsReportedSnapshot {
  /** The day this year's annual report was filed. Nothing filed later was read. */
  asOf: string;
  fiscalYear: number;
  form: string;
  sourceFilingUrl: string | null;
  /** Consecutive fiscal years, newest first, starting with `fiscalYear`. */
  periods: AsReportedPeriod[];
}

/** Normalized fundamentals for one company, newest period first. */
export interface NormalizedFundamentals {
  cik: string;
  entityName: string;
  taxonomy: Taxonomy;
  /** Annual periods, sorted newest first. */
  annual: FinancialPeriod[];
  /**
   * Discrete quarters from 10-Q filings, sorted newest first.
   *
   * Only quarters a company reported on their own. A fourth quarter is never
   * filed as one — it lives inside the annual report — and a foreign private
   * issuer files no 10-Q at all, so both are absent rather than derived.
   * Optional because the fallback providers supply annual statements only.
   */
  quarterly?: FinancialPeriod[];
  /**
   * Recent annual reports as each was first filed, newest first. Only EDGAR
   * supplies these; a fallback provider has no filing dates to rebuild from.
   */
  asReported?: AsReportedSnapshot[];
  /**
   * Fields the filer never reported and which could not be derived. Surfaced in
   * the UI as "not disclosed" rather than silently rendered as zero.
   */
  missingFields: CanonicalField[];
}

/** Raw shape of the SEC `companyfacts` JSON payload. */
export interface SecFactEntry {
  end: string;
  start?: string;
  val: number;
  accn?: string;
  fy?: number;
  fp?: string;
  form?: string;
  filed?: string;
  frame?: string;
}

export interface SecCompanyFacts {
  cik: number;
  entityName: string;
  facts: Record<string, Record<string, { units: Record<string, SecFactEntry[]> }>>;
}
