import type {
  CanonicalField,
  Fact,
  FinancialPeriod,
  NormalizedFundamentals,
} from "../fundamentals/types";
import type { SymbolSearchResult } from "./types";

const BASE = "https://www.alphavantage.co/query";

/**
 * Alpha Vantage — fundamentals for companies outside SEC coverage.
 *
 * Used only as an on-demand fallback, never for the nightly universe pass. Its
 * free tier allows 25 requests a day, which would take three weeks to cover 544
 * companies but is ample for the actual job here: someone looks up a TSX-only
 * name such as Aritzia, two requests answer it, and the result is cached.
 *
 * Chosen over the unofficial Yahoo endpoints because it is a documented API
 * with a published free tier, rather than an internal endpoint whose terms
 * prohibit automated access. Coverage is confirmed international — symbols
 * carry an exchange suffix (`.TRT` Toronto, `.LON` London, `.FRK` Frankfurt).
 *
 * Reports arrive in the company's own currency, which for a Canadian filer is
 * CAD. Ratios are currency-neutral so scores stay valid, but absolute figures
 * are not directly comparable with a US company's, and the UI says so.
 */
export class AlphaVantageProvider {
  readonly name = "Alpha Vantage";

  private get key() {
    return process.env.ALPHAVANTAGE_API_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.key);
  }

  private async call<T>(params: Record<string, string>): Promise<T | null> {
    if (!this.isConfigured()) return null;

    const search = new URLSearchParams({ ...params, apikey: this.key! });
    const res = await fetch(`${BASE}?${search}`, {
      // Cached hard: the daily allowance is 25 requests, so a repeat lookup
      // must never cost one.
      next: { revalidate: 60 * 60 * 24 },
    });
    if (!res.ok) return null;

    const json = (await res.json()) as Record<string, unknown>;

    // Business errors arrive as HTTP 200 with an explanatory field, including
    // the daily limit — which is the one most likely to be hit here.
    if (json.Information || json.Note) {
      const message = String(json.Information ?? json.Note);
      if (/limit|frequency/i.test(message)) {
        throw new Error(
          "Alpha Vantage daily limit reached (25 requests on the free plan). " +
            "It resets at midnight US Eastern.",
        );
      }
      return null;
    }
    if (json["Error Message"]) return null;

    return json as T;
  }

  /**
   * The commercial facts about a fund, which no filing carries.
   *
   * N-PORT says what a fund owns; it does not say what it charges to own it,
   * when it opened, or whether it is leveraged. Those live in the prospectus,
   * as prose in an HTML fee table, and are not extractable at any sensible
   * cost — so the one number every fund reader looks for first was the one
   * thing the fund pages could not show.
   *
   * Alpha Vantage is used for the same reason it is used for foreign
   * fundamentals above: a documented API with a published free tier, rather
   * than an undocumented endpoint whose terms forbid automated access. Its
   * daily allowance is 25 requests, which `call` caches hard against — a fund
   * profile changes about once a year, so a repeat view must never spend one.
   *
   * Returns null when unconfigured, unknown, or over the limit, and the panel
   * omits what it did not get rather than showing a blank.
   */
  async getEtfProfile(symbol: string): Promise<EtfProfile | null> {
    const json = await this.call<AvEtfProfile>({
      function: "ETF_PROFILE",
      symbol: symbol.toUpperCase(),
    }).catch(() => null);

    return mapEtfProfile(json);
  }

  /** Finds the exchange-suffixed symbol for a company, e.g. ATZ -> ATZ.TRT. */
  async search(query: string, limit = 8): Promise<SymbolSearchResult[]> {
    const json = await this.call<{ bestMatches?: Record<string, string>[] }>({
      function: "SYMBOL_SEARCH",
      keywords: query,
    });
    if (!json?.bestMatches) return [];

    return json.bestMatches.slice(0, limit).map((m) => ({
      symbol: m["1. symbol"],
      name: m["2. name"],
      exchange: m["4. region"] ?? null,
      country: m["4. region"] ?? null,
      cik: null,
      supported: true,
    }));
  }

  /**
   * Fetches annual fundamentals and maps them onto the canonical model, so the
   * scoring engine cannot tell this apart from an SEC filing.
   *
   * Costs two requests — one for the balance sheet, one for the income
   * statement — which is why cash-flow figures are omitted: a third request
   * would consume 12% of the daily allowance for one company.
   */
  async getFundamentals(symbol: string): Promise<NormalizedFundamentals | null> {
    const [balance, income] = await Promise.all([
      this.call<AvStatement>({ function: "BALANCE_SHEET", symbol }),
      this.call<AvStatement>({ function: "INCOME_STATEMENT", symbol }),
    ]);

    if (!balance?.annualReports?.length) return null;

    const incomeByDate = new Map(
      (income?.annualReports ?? []).map((r) => [r.fiscalDateEnding, r]),
    );

    // Alpha Vantage reports a fiscal period end but never the date it filed
    // that report, so there is nothing honest to put in filedAt — treating the
    // period end as the filing date would understate the real reporting lag by
    // six to ten weeks, exactly the gap point-in-time backtesting exists to
    // respect. Left null; a period with no known filing date is excluded from
    // point-in-time reconstruction rather than assumed to have been public
    // immediately.
    const annual: FinancialPeriod[] = balance.annualReports
      .slice(0, 8)
      .map((b) => {
        const date = b.fiscalDateEnding;
        const i = incomeByDate.get(date);
        const currency = b.reportedCurrency ?? "USD";
        const facts: Partial<Record<CanonicalField, Fact>> = {};

        const put = (field: CanonicalField, raw: string | undefined, source: string) => {
          const value = toNumber(raw);
          if (value == null) return;
          facts[field] = {
            value,
            unit: currency,
            end: date,
            fiscalYear: Number(date.slice(0, 4)),
            fiscalPeriod: "FY",
            form: "annual-report",
            sourceConcept: `alphavantage:${source}`,
            sourceFilingUrl: null,
          };
        };

        put("assets", b.totalAssets, "totalAssets");
        put("liabilities", b.totalLiabilities, "totalLiabilities");
        put("equity", b.totalShareholderEquity, "totalShareholderEquity");
        put("currentAssets", b.totalCurrentAssets, "totalCurrentAssets");
        put("currentLiabilities", b.totalCurrentLiabilities, "totalCurrentLiabilities");
        put("cash", b.cashAndCashEquivalentsAtCarryingValue, "cash");
        put("receivables", b.currentNetReceivables, "currentNetReceivables");
        put("inventory", b.inventory, "inventory");
        put("ppe", b.propertyPlantEquipment, "propertyPlantEquipment");
        put("longTermDebt", b.longTermDebt, "longTermDebt");
        put("shortTermDebt", b.shortTermDebt, "shortTermDebt");
        put("retainedEarnings", b.retainedEarnings, "retainedEarnings");
        put("sharesOutstanding", b.commonStockSharesOutstanding, "sharesOutstanding");

        if (i) {
          put("revenue", i.totalRevenue, "totalRevenue");
          put("costOfRevenue", i.costOfRevenue, "costOfRevenue");
          put("grossProfit", i.grossProfit, "grossProfit");
          put("operatingIncome", i.operatingIncome, "operatingIncome");
          put("netIncome", i.netIncome, "netIncome");
          put("incomeBeforeTax", i.incomeBeforeTax, "incomeBeforeTax");
          put("interestExpense", i.interestExpense, "interestExpense");
          put("sga", i.sellingGeneralAndAdministrative, "sga");
          put("depreciation", i.depreciationAndAmortization, "depreciation");
        }

        // Same derivation the SEC normalizer applies, so both paths behave alike.
        if (!facts.liabilities && facts.assets && facts.equity) {
          facts.liabilities = {
            ...facts.assets,
            value: facts.assets.value - facts.equity.value,
            sourceConcept: "derived:Assets-Equity",
            derived: true,
          };
        }

        return {
          fiscalYear: Number(date.slice(0, 4)),
          fiscalPeriod: "FY",
          end: date,
          form: "annual-report",
          facts,
          filedAt: null,
        };
      })
      .filter((p) => Object.keys(p.facts).length > 0);

    if (annual.length === 0) return null;

    return {
      cik: "",
      entityName: balance.symbol ?? symbol,
      taxonomy: "us-gaap",
      annual,
      missingFields: [],
    };
  }
}

interface AvReport {
  fiscalDateEnding: string;
  reportedCurrency?: string;
  [key: string]: string | undefined;
}

interface AvStatement {
  symbol?: string;
  annualReports?: AvReport[];
}

/**
 * The fund facts a filing does not carry.
 *
 * Ratios are fractions, as the provider sends them: 0.0018 is 0.18%.
 */
export interface EtfProfile {
  /** Net expense ratio, as a fraction. The number a fund is judged on. */
  expenseRatio: number | null;
  dividendYield: number | null;
  /** Portfolio turnover, as a fraction. Often absent for an index fund. */
  turnover: number | null;
  inceptionDate: string | null;
  leveraged: boolean;
  /** Weights as fractions, largest first. */
  sectors: { sector: string; weight: number }[];
  /**
   * Holdings as ticker and weight.
   *
   * The display list comes from the fund's N-PORT filing, which is richer —
   * it carries countries, bond terms and a link to the filing itself. This
   * one exists because it carries the thing N-PORT does not: a ticker. That
   * is what lets a holding be matched against this site's own scored
   * companies, which is what makes a portfolio valuation possible at all.
   */
  holdings: { symbol: string; weight: number }[];
  /**
   * The largest positions by name, for the card to list.
   *
   * Separate from `holdings` because the two do different jobs. That list
   * feeds the portfolio valuation, so it holds only tickers that can be
   * matched to a scored company; this one is for a reader, and a bond or a
   * Toronto-only stock belongs in it all the same. Empty where the fund's own
   * N-PORT filing already lists every position further down the page.
   */
  topHoldings: { name: string; symbol: string | null; weight: number; detail: string | null }[];
  /** Positions held, cash lines excluded. Null where the source does not say. */
  holdingCount: number | null;
  /** The whole fund's net assets, in `netAssetsCurrency`. */
  netAssets: number | null;
  netAssetsCurrency: string | null;
  /** Where these figures came from, so the card can say so. */
  source: EtfProfileSource;
}

export interface EtfProfileSource {
  name: string;
  /** A page a reader can check the figures against. */
  url: string | null;
  /** The date the figures describe, when the source states one. */
  asOf: string | null;
  /**
   * Whether the fund's own manager published them.
   *
   * Decides what the card tells a reader to do before acting on a fee: a data
   * provider's figure is worth checking against the factsheet, and the
   * manager's own figure is what the factsheet says.
   */
  publishedByManager: boolean;
}

interface AvEtfProfile {
  net_expense_ratio?: string;
  dividend_yield?: string;
  portfolio_turnover?: string;
  inception_date?: string;
  leveraged?: string;
  sectors?: { sector?: string; weight?: string }[];
  holdings?: { symbol?: string; description?: string; weight?: string }[];
}

/**
 * Maps the provider's payload onto the app's shape.
 *
 * Separate from the fetch so it can be tested against a real recorded payload
 * without a network or a key — everything interesting here is in the mapping,
 * not the request.
 *
 * Returns null when the response describes no fund. An equity ticker answers
 * this endpoint with an empty object rather than an error, so "no fee and no
 * launch date" is what a non-fund looks like and is the test for one.
 */
export function mapEtfProfile(json: AvEtfProfile | null): EtfProfile | null {
  if (!json) return null;

  const expenseRatio = toNumber(json.net_expense_ratio);
  const inception =
    json.inception_date && json.inception_date !== "n/a" ? json.inception_date : null;
  if (expenseRatio === null && !inception) return null;

  return {
    expenseRatio,
    dividendYield: toNumber(json.dividend_yield),
    turnover: toNumber(json.portfolio_turnover),
    inceptionDate: inception,
    // Anything but an explicit "YES" is treated as not leveraged: this drives a
    // warning on the page, and inventing one is worse than missing one.
    leveraged: typeof json.leveraged === "string" ? json.leveraged.toUpperCase() === "YES" : false,
    sectors: (json.sectors ?? [])
      .map((s) => ({ sector: titleCase(s.sector ?? ""), weight: toNumber(s.weight) }))
      .filter((s): s is { sector: string; weight: number } => Boolean(s.sector) && s.weight !== null)
      .sort((a, b) => b.weight - a.weight),
    holdings: (json.holdings ?? [])
      .map((h) => ({ symbol: (h.symbol ?? "").toUpperCase().trim(), weight: toNumber(h.weight) }))
      // A cash line and an untradeable position both come through with an
      // empty symbol; neither can be matched to a scored company.
      .filter((h): h is { symbol: string; weight: number } => Boolean(h.symbol) && h.weight !== null)
      .sort((a, b) => b.weight - a.weight),
    // A US fund's page lists its positions and size from its N-PORT filing,
    // so they are not repeated from here.
    topHoldings: [],
    holdingCount: null,
    netAssets: null,
    netAssetsCurrency: null,
    source: { name: "Alpha Vantage", url: null, asOf: null, publishedByManager: false },
  };
}

/** The provider shouts its sector names; the rest of the app does not. */
function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase())
    .trim();
}

/** Alpha Vantage returns numbers as strings, and "None" for absent values. */
function toNumber(raw: string | undefined): number | null {
  if (raw == null || raw === "None" || raw === "-" || raw === "" || raw === "n/a") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export const alphaVantage = new AlphaVantageProvider();
