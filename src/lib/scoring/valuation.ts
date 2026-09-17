import { fieldValue } from "../fundamentals/normalize";
import type { NormalizedFundamentals } from "../fundamentals/types";
import { freeCashFlowOf } from "./returns";
import type { SectorKind } from "./applicability";

/** A metric is never silently turned into a dash without explaining why. */
export type MetricStatus =
  | "available"
  | "calculated"
  | "unavailable"
  | "not_meaningful"
  | "stale";

export interface ValuationMetric {
  value: number | null;
  status: MetricStatus;
  source: string;
  basis: string;
  asOf: string | null;
}

export interface ValuationMetrics {
  trailingPE: ValuationMetric;
  priceToSales: ValuationMetric;
  priceToBook: ValuationMetric;
  priceToFreeCashFlow: ValuationMetric;
  fcfYield: ValuationMetric;
  enterpriseValueToRevenue: ValuationMetric;
  enterpriseValueToEbitda: ValuationMetric;
}

const STALE_DAYS = 548;

function unavailable(basis: string): ValuationMetric {
  return {
    value: null,
    status: "unavailable",
    source: "local calculation",
    basis,
    asOf: null,
  };
}

function metric(
  value: number | null,
  basis: string,
  asOf: string | null,
  status: MetricStatus = "calculated",
): ValuationMetric {
  return {
    value: value != null && Number.isFinite(value) ? value : null,
    status: value != null && Number.isFinite(value) ? status : "unavailable",
    source: "local calculation",
    basis,
    asOf,
  };
}

/**
 * Builds the common valuation set from the same normalized statements used by
 * the health score. This is the final fallback: if a provider has no ratio,
 * WylthIQ calculates it when the underlying facts exist.
 *
 * Important distinction: a negative denominator is not reported as a fake
 * negative multiple. It is explicitly `not_meaningful`, while a missing input
 * is `unavailable`. A tiny positive profit is valid and therefore produces the
 * very large P/E a reader should see for a company such as CRWD.
 */
export function buildValuationMetrics(
  fundamentals: NormalizedFundamentals,
  marketCap: number | null,
  sector: SectorKind = "other",
  now = new Date(),
): ValuationMetrics {
  const latest = fundamentals.annual[0];
  const revenue = fieldValue(latest, "revenue");
  const netIncome = fieldValue(latest, "netIncome");
  const equity = fieldValue(latest, "equity");
  const operatingIncome = fieldValue(latest, "operatingIncome");
  const depreciation = fieldValue(latest, "depreciation");
  const cash = fieldValue(latest, "cash");
  const longTermDebt = fieldValue(latest, "longTermDebt") ?? 0;
  const shortTermDebt = fieldValue(latest, "shortTermDebt") ?? 0;
  const fcf = freeCashFlowOf(
    fieldValue(latest, "operatingCashFlow"),
    fieldValue(latest, "capex"),
  );

  const asOf = latest?.end ?? null;
  const stale = asOf
    ? now.getTime() - Date.parse(`${asOf}T00:00:00Z`) > STALE_DAYS * 86_400_000
    : false;

  const statusFor = (value: number | null): MetricStatus =>
    value == null ? "unavailable" : stale ? "stale" : "calculated";

  const pe =
    marketCap != null && netIncome != null && netIncome > 0
      ? marketCap / netIncome
      : null;
  const ps =
    marketCap != null && revenue != null && revenue > 0
      ? marketCap / revenue
      : null;
  const pb =
    marketCap != null && equity != null && equity > 0
      ? marketCap / equity
      : null;
  const pfcf =
    marketCap != null && fcf != null && fcf > 0
      ? marketCap / fcf
      : null;
  const fcfYield =
    marketCap != null && marketCap > 0 && fcf != null && fcf > 0
      ? fcf / marketCap
      : null;

  const ebitda =
    operatingIncome != null && depreciation != null
      ? operatingIncome + Math.abs(depreciation)
      : null;
  const enterpriseValue =
    marketCap != null && cash != null
      ? marketCap + longTermDebt + shortTermDebt - cash
      : null;
  const evRevenue =
    enterpriseValue != null && revenue != null && revenue > 0
      ? enterpriseValue / revenue
      : null;
  const evEbitda =
    enterpriseValue != null && ebitda != null && ebitda > 0
      ? enterpriseValue / ebitda
      : null;

  const negative = (value: number | null, reason: string, basis: string): ValuationMetric => ({
    value: null,
    status: value != null && value <= 0 ? "not_meaningful" : "unavailable",
    source: "local calculation",
    basis: value != null && value <= 0 ? reason : basis,
    asOf,
  });

  return {
    trailingPE:
      netIncome != null && netIncome <= 0
        ? negative(netIncome, "Trailing GAAP earnings are zero or negative; P/E is not meaningful.", "market value / trailing net income")
        : metric(pe, "market value / trailing net income", asOf, statusFor(pe)),
    priceToSales: metric(ps, "market value / trailing revenue", asOf, statusFor(ps)),
    priceToBook:
      equity != null && equity <= 0
        ? negative(equity, "Book equity is zero or negative; P/B is not meaningful.", "market value / book equity")
        : metric(pb, "market value / book equity", asOf, statusFor(pb)),
    priceToFreeCashFlow:
      fcf != null && fcf <= 0
        ? negative(fcf, "Trailing free cash flow is zero or negative; P/FCF is not meaningful.", "market value / trailing free cash flow")
        : metric(pfcf, "market value / trailing free cash flow", asOf, statusFor(pfcf)),
    fcfYield: metric(fcfYield, "trailing free cash flow / market value", asOf, statusFor(fcfYield)),
    enterpriseValueToRevenue: metric(
      sector === "financial" ? null : evRevenue,
      sector === "financial" ? "EV/revenue is not a useful primary measure for financial companies." : "enterprise value / trailing revenue",
      asOf,
      sector === "financial" ? "not_meaningful" : statusFor(evRevenue),
    ),
    enterpriseValueToEbitda: metric(
      sector === "financial" ? null : evEbitda,
      sector === "financial" ? "EV/EBITDA is not a useful primary measure for financial companies." : "enterprise value / trailing EBITDA",
      asOf,
      sector === "financial" ? "not_meaningful" : statusFor(evEbitda),
    ),
  };
}

export function displayMetricValue(metricValue: ValuationMetric): number | null {
  return metricValue.value;
}
