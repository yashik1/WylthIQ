import type { MetricGuideId } from "../learn/metric-guide";
import { freeCashFlowOf } from "../scoring/returns";
import { fieldValue } from "./normalize";
import { periodLabel } from "./period-label";
import type { StatementRowKind } from "./statement-change";
import type { CanonicalField, FinancialPeriod, NormalizedFundamentals } from "./types";

/**
 * The three financial statements as tables, for the statement explorer.
 *
 * Built on the server from the figures the rest of the page already uses, so
 * a number in the explorer is the same number the health score read. Every
 * reported cell carries the XBRL concept it came from; every calculated row
 * carries its formula and is marked calculated, so a reader can tell a figure
 * the company filed from one this app worked out.
 */

export type StatementKey = "income" | "balance" | "cashflow";

export interface StatementRow {
  key: string;
  label: string;
  kind: StatementRowKind;
  /** How a calculated row is worked out. Absent for reported figures. */
  formula?: string;
  guide?: MetricGuideId;
  /** A total or subtotal, drawn heavier. */
  emphasis?: boolean;
}

export interface StatementCell {
  value: number | null;
  /** The XBRL concept, e.g. `us-gaap:Revenues`. Null for calculated rows. */
  concept: string | null;
  derived: boolean;
}

export interface StatementColumn {
  key: string;
  label: string;
  fiscalPeriod: string;
  end: string;
  form: string;
  filedAt: string | null;
  sourceUrl: string | null;
  cells: Record<string, StatementCell>;
}

export interface StatementTable {
  key: StatementKey;
  label: string;
  rows: StatementRow[];
}

export interface StatementData {
  currency: string;
  tables: StatementTable[];
  /** Newest first. */
  annual: StatementColumn[];
  /** Newest first. */
  quarterly: StatementColumn[];
  /** The annual column the latest is compared with — the year before — or null. */
  annualBase: number | null;
  /** The quarter a year before the latest one, or null. */
  quarterlyBase: number | null;
}

type Getter = (field: CanonicalField) => number | null;

interface RowSpec extends StatementRow {
  field?: CanonicalField;
  /** Shown as a magnitude, because filers disagree about the sign of an outflow. */
  magnitude?: boolean;
  compute?: (value: Getter) => number | null;
}

const ratio = (a: number | null, b: number | null): number | null =>
  a == null || b == null || b === 0 ? null : a / b;

const freeCashFlow = (v: Getter): number | null =>
  freeCashFlowOf(v("operatingCashFlow"), v("capex"));

const totalDebt = (v: Getter): number | null => {
  const longTerm = v("longTermDebt");
  const shortTerm = v("shortTermDebt");
  return longTerm == null && shortTerm == null ? null : (longTerm ?? 0) + (shortTerm ?? 0);
};

const TABLES: { key: StatementKey; label: string; rows: RowSpec[] }[] = [
  {
    key: "income",
    label: "Income statement",
    rows: [
      { key: "revenue", label: "Revenue", kind: "money", field: "revenue", guide: "revenue", emphasis: true },
      { key: "costOfRevenue", label: "Cost of revenue", kind: "money", field: "costOfRevenue" },
      { key: "grossProfit", label: "Gross profit", kind: "money", field: "grossProfit" },
      { key: "grossMargin", label: "Gross margin", kind: "percent", formula: "Gross profit ÷ revenue", guide: "gross-margin", compute: (v) => ratio(v("grossProfit"), v("revenue")) },
      { key: "sga", label: "Selling, general and administrative", kind: "money", field: "sga" },
      { key: "operatingIncome", label: "Operating income", kind: "money", field: "operatingIncome", emphasis: true },
      { key: "operatingMargin", label: "Operating margin", kind: "percent", formula: "Operating income ÷ revenue", guide: "operating-margin", compute: (v) => ratio(v("operatingIncome"), v("revenue")) },
      { key: "interestExpense", label: "Interest expense", kind: "money", field: "interestExpense" },
      { key: "incomeBeforeTax", label: "Income before tax", kind: "money", field: "incomeBeforeTax" },
      { key: "netIncome", label: "Net income", kind: "money", field: "netIncome", emphasis: true },
      { key: "netMargin", label: "Net margin", kind: "percent", formula: "Net income ÷ revenue", guide: "net-margin", compute: (v) => ratio(v("netIncome"), v("revenue")) },
      { key: "eps", label: "Earnings per share", kind: "perShare", formula: "Net income ÷ shares outstanding at the period end — close to, but not the same as, the reported EPS", guide: "eps", compute: (v) => ratio(v("netIncome"), v("sharesOutstanding")) },
    ],
  },
  {
    key: "balance",
    label: "Balance sheet",
    rows: [
      { key: "cash", label: "Cash and equivalents", kind: "money", field: "cash" },
      { key: "receivables", label: "Receivables", kind: "money", field: "receivables" },
      { key: "inventory", label: "Inventory", kind: "money", field: "inventory" },
      { key: "currentAssets", label: "Current assets", kind: "money", field: "currentAssets", emphasis: true },
      { key: "ppe", label: "Property, plant and equipment", kind: "money", field: "ppe" },
      { key: "assets", label: "Total assets", kind: "money", field: "assets", emphasis: true },
      { key: "currentLiabilities", label: "Current liabilities", kind: "money", field: "currentLiabilities" },
      { key: "shortTermDebt", label: "Short-term debt", kind: "money", field: "shortTermDebt" },
      { key: "longTermDebt", label: "Long-term debt", kind: "money", field: "longTermDebt" },
      { key: "totalDebt", label: "Total debt", kind: "money", formula: "Short-term debt + long-term debt", guide: "net-debt", compute: totalDebt },
      { key: "liabilities", label: "Total liabilities", kind: "money", field: "liabilities", emphasis: true },
      { key: "retainedEarnings", label: "Retained earnings", kind: "money", field: "retainedEarnings" },
      { key: "equity", label: "Shareholders' equity", kind: "money", field: "equity", emphasis: true },
      { key: "sharesOutstanding", label: "Shares outstanding", kind: "shares", field: "sharesOutstanding", guide: "share-count" },
      { key: "currentRatio", label: "Current ratio", kind: "multiple", formula: "Current assets ÷ current liabilities", guide: "current-ratio", compute: (v) => ratio(v("currentAssets"), v("currentLiabilities")) },
      { key: "debtToEquity", label: "Debt to equity", kind: "multiple", formula: "Total liabilities ÷ shareholders' equity", guide: "debt-to-equity", compute: (v) => ratio(v("liabilities"), v("equity")) },
    ],
  },
  {
    key: "cashflow",
    label: "Cash flow",
    rows: [
      { key: "operatingCashFlow", label: "Operating cash flow", kind: "money", field: "operatingCashFlow", emphasis: true },
      { key: "capex", label: "Capital expenditure", kind: "money", field: "capex", magnitude: true },
      { key: "freeCashFlow", label: "Free cash flow", kind: "money", formula: "Operating cash flow − capital expenditure", guide: "free-cash-flow", emphasis: true, compute: freeCashFlow },
      { key: "fcfMargin", label: "Free cash flow margin", kind: "percent", formula: "Free cash flow ÷ revenue", guide: "fcf-margin", compute: (v) => ratio(freeCashFlow(v), v("revenue")) },
      { key: "depreciation", label: "Depreciation and amortisation", kind: "money", field: "depreciation" },
      { key: "dividendsPaid", label: "Dividends paid", kind: "money", field: "dividendsPaid", magnitude: true, guide: "dividend-yield" },
    ],
  },
];

const ALL_ROWS: RowSpec[] = TABLES.flatMap((table) => table.rows);

function cellFor(row: RowSpec, period: FinancialPeriod): StatementCell {
  if (row.field) {
    const fact = period.facts[row.field];
    if (!fact) return { value: null, concept: null, derived: false };
    return {
      value: row.magnitude ? Math.abs(fact.value) : fact.value,
      concept: fact.sourceConcept,
      derived: Boolean(fact.derived),
    };
  }

  const value = row.compute?.((field) => fieldValue(period, field)) ?? null;
  return { value: value != null && Number.isFinite(value) ? value : null, concept: null, derived: true };
}

function columnFor(period: FinancialPeriod): StatementColumn {
  const anchor = period.facts.revenue ?? period.facts.netIncome ?? period.facts.assets;
  const anyUrl = Object.values(period.facts).find((fact) => fact?.sourceFilingUrl)?.sourceFilingUrl;

  return {
    key: period.end,
    label: periodLabel(period),
    fiscalPeriod: period.fiscalPeriod,
    end: period.end,
    form: period.form,
    filedAt: period.filedAt,
    sourceUrl: anchor?.sourceFilingUrl ?? anyUrl ?? null,
    cells: Object.fromEntries(ALL_ROWS.map((row) => [row.key, cellFor(row, period)])),
  };
}

function daysBetween(earlier: string, later: string): number {
  return (Date.parse(later) - Date.parse(earlier)) / 86_400_000;
}

export function buildStatements(
  fundamentals: NormalizedFundamentals,
  currency: string,
  { years = 5, quarters = 6 }: { years?: number; quarters?: number } = {},
): StatementData {
  const annualPeriods = fundamentals.annual.slice(0, years);
  const quarterPeriods = (fundamentals.quarterly ?? []).slice(0, quarters);

  const [latestYear, priorYear] = annualPeriods;
  const annualBase =
    latestYear && priorYear && latestYear.fiscalYear === priorYear.fiscalYear + 1 ? 1 : null;

  const latestQuarter = quarterPeriods[0];
  const yearAgo = latestQuarter
    ? quarterPeriods.findIndex(
        (quarter, index) =>
          index > 0 &&
          quarter.fiscalPeriod === latestQuarter.fiscalPeriod &&
          daysBetween(quarter.end, latestQuarter.end) >= 350 &&
          daysBetween(quarter.end, latestQuarter.end) <= 380,
      )
    : -1;

  return {
    currency,
    tables: TABLES.map(({ key, label, rows }) => ({
      key,
      label,
      rows: rows.map(({ key: rowKey, label: rowLabel, kind, formula, guide, emphasis }) => ({
        key: rowKey,
        label: rowLabel,
        kind,
        ...(formula ? { formula } : {}),
        ...(guide ? { guide } : {}),
        ...(emphasis ? { emphasis } : {}),
      })),
    })),
    annual: annualPeriods.map(columnFor),
    quarterly: quarterPeriods.map(columnFor),
    annualBase,
    quarterlyBase: yearAgo > 0 ? yearAgo : null,
  };
}
