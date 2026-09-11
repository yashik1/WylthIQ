import { fieldValue } from "../fundamentals/normalize";
import type { FinancialPeriod } from "../fundamentals/types";
import { div } from "./math";

/**
 * Returns on capital and enterprise value, from one annual period.
 *
 * Approximations, and labelled as such wherever they are shown. The canonical
 * model carries operating income, tax, debt and cash but not every input an
 * analyst would use: cash here is cash and equivalents only, without the
 * short-term investments where cash-rich companies keep most of their
 * liquidity, so enterprise value runs high for those companies and invested
 * capital runs high too.
 */

/** Used when the filings do not give a sensible effective rate. */
const FALLBACK_TAX_RATE = 0.21;

const value = (period: FinancialPeriod | undefined, field: Parameters<typeof fieldValue>[1]) =>
  fieldValue(period, field);

/** Short-term plus long-term borrowings, or null when neither was reported. */
export function totalDebt(period: FinancialPeriod | undefined): number | null {
  const longTerm = value(period, "longTermDebt");
  const shortTerm = value(period, "shortTermDebt");
  return longTerm == null && shortTerm == null ? null : (longTerm ?? 0) + (shortTerm ?? 0);
}

/**
 * The share of pre-tax income paid in tax, from the filings themselves.
 * Falls back to the US federal rate when there is no pre-tax profit, or when
 * the implied rate is outside what an ordinary year produces.
 */
export function effectiveTaxRate(period: FinancialPeriod | undefined): number {
  const pretax = value(period, "incomeBeforeTax");
  const net = value(period, "netIncome");
  if (pretax == null || net == null || pretax <= 0) return FALLBACK_TAX_RATE;
  const rate = 1 - net / pretax;
  return rate >= 0 && rate <= 0.5 ? rate : FALLBACK_TAX_RATE;
}

/**
 * Operating profit after tax, over the capital the business runs on — equity
 * plus debt, less cash. Null when that capital is not positive, where the
 * ratio stops meaning anything.
 */
export function returnOnInvestedCapital(period: FinancialPeriod | undefined): number | null {
  const operatingIncome = value(period, "operatingIncome");
  const equity = value(period, "equity");
  if (operatingIncome == null || equity == null) return null;

  const invested = equity + (totalDebt(period) ?? 0) - (value(period, "cash") ?? 0);
  if (invested <= 0) return null;

  return div(operatingIncome * (1 - effectiveTaxRate(period)), invested);
}

/** Operating income plus depreciation and amortisation. */
export function ebitda(period: FinancialPeriod | undefined): number | null {
  const operatingIncome = value(period, "operatingIncome");
  const depreciation = value(period, "depreciation");
  return operatingIncome == null || depreciation == null
    ? null
    : operatingIncome + Math.abs(depreciation);
}

/**
 * Enterprise value over EBITDA. Null without a debt figure, since leaving the
 * debt out would understate enterprise value, and null when EBITDA is not
 * positive.
 */
export function enterpriseValueToEbitda(
  period: FinancialPeriod | undefined,
  marketCap: number | null,
): number | null {
  const earnings = ebitda(period);
  const debt = totalDebt(period);
  if (marketCap == null || earnings == null || earnings <= 0 || debt == null) return null;
  return div(marketCap + debt - (value(period, "cash") ?? 0), earnings);
}

/** Borrowings over EBITDA. Null when EBITDA is not positive or debt was not reported. */
export function debtToEbitda(period: FinancialPeriod | undefined): number | null {
  const earnings = ebitda(period);
  const debt = totalDebt(period);
  if (earnings == null || earnings <= 0 || debt == null) return null;
  return div(debt, earnings);
}
