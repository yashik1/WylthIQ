import { fieldValue } from "../fundamentals/normalize";
import type { NormalizedFundamentals } from "../fundamentals/types";
import { freeCashFlowOf } from "./returns";
import type { SectorKind } from "./applicability";

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

function notMeaningful(reason: string, asOf: string | null): ValuationMetric {
  return {
    value: null,
    status: "not_meaningful",
    source: "local calculation",
    basis: reason,
    asOf,
  };
}

/** Use the latest four discrete quarters when available; otherwise fall back to the latest annual figure. */
function ttm(
  fundamentals: NormalizedFundamentals,
  field: Parameters<typeof fieldValue>[1],
): { value: number | null; asOf: string | null; basis: string } {
  const quarters = fundamentals.quarterly?.slice(0, 4) ?? [];
  if (quarters.length === 4) {
    const values = quarters.map((q) => fieldValue(q, field));
    if (values.every((v) => v != null)) {
      return {
        value: values.reduce((sum, value) => sum + value!, 0),
        asOf: quarters[0]?.end ?? null,
        basis: "market value / trailing twelve-month figure from four latest quarters",
      };
    }
  }

  const annual = fundamentals.annual[0];
  return {
    value: fieldValue(annual, field),
    asOf: annual?.end ?? null,
    basis: "market value / latest annual figure",
  };
}

/**
 * Calculates valuation from the normalized financials instead of requiring a
 * provider to supply a ratio. Profit/revenue/cash-flow multiples use TTM data;
 * P/B uses the latest balance sheet because book value is point-in-time.
 */
export function buildValuationMetrics(
  fundamentals: NormalizedFundamentals,
  marketCap: number | null,
  sector: SectorKind = "other",
  now = new Date(),
): ValuationMetrics {
  const latest = fundamentals.annual[0];
  const revenueTtm = ttm(fundamentals, "revenue");
  const netIncomeTtm = ttm(fundamentals, "netIncome");
  const operatingIncomeTtm = ttm(fundamentals, "operatingIncome");
  const depreciationTtm = ttm(fundamentals, "depreciation");
  const ocfTtm = ttm(fundamentals, "operatingCashFlow");
  const capexTtm = ttm(fundamentals, "capex");

  const revenue = revenueTtm.value;
  const netIncome = netIncomeTtm.value;
  const equity = fieldValue(latest, "equity");
  const operatingIncome = operatingIncomeTtm.value;
  const depreciation = depreciationTtm.value;
  const cash = fieldValue(latest, "cash");
  const longTermDebt = fieldValue(latest, "longTermDebt") ?? 0;
  const shortTermDebt = fieldValue(latest, "shortTermDebt") ?? 0;
  const fcf = freeCashFlowOf(ocfTtm.value, capexTtm.value);

  const asOf = revenueTtm.asOf ?? latest?.end ?? null;
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

  return {
    trailingPE:
      netIncome != null && netIncome <= 0
        ? notMeaningful(
            "Trailing twelve-month GAAP earnings are zero or negative; P/E is not meaningful.",
            netIncomeTtm.asOf,
          )
        : metric(pe, netIncomeTtm.basis, netIncomeTtm.asOf, statusFor(pe)),
    priceToSales: metric(ps, revenueTtm.basis, revenueTtm.asOf, statusFor(ps)),
    priceToBook:
      equity != null && equity <= 0
        ? notMeaningful(
            "Book equity is zero or negative; P/B is not meaningful.",
            latest?.end ?? null,
          )
        : metric(pb, "market value / latest reported book equity", latest?.end ?? null, statusFor(pb)),
    priceToFreeCashFlow:
      fcf != null && fcf <= 0
        ? notMeaningful(
            "Trailing twelve-month free cash flow is zero or negative; P/FCF is not meaningful.",
            capexTtm.asOf ?? ocfTtm.asOf,
          )
        : metric(
            pfcf,
            "market value / trailing twelve-month free cash flow",
            capexTtm.asOf ?? ocfTtm.asOf,
            statusFor(pfcf),
          ),
    fcfYield: metric(
      fcfYield,
      "trailing twelve-month free cash flow / market value",
      capexTtm.asOf ?? ocfTtm.asOf,
      statusFor(fcfYield),
    ),
    enterpriseValueToRevenue: metric(
      sector === "financial" ? null : evRevenue,
      sector === "financial"
        ? "EV/revenue is not a useful primary measure for financial companies."
        : "enterprise value / trailing twelve-month revenue",
      revenueTtm.asOf,
      sector === "financial" ? "not_meaningful" : statusFor(evRevenue),
    ),
    enterpriseValueToEbitda: metric(
      sector === "financial" ? null : evEbitda,
      sector === "financial"
        ? "EV/EBITDA is not a useful primary measure for financial companies."
        : "enterprise value / trailing twelve-month EBITDA",
      operatingIncomeTtm.asOf ?? depreciationTtm.asOf,
      sector === "financial" ? "not_meaningful" : statusFor(evEbitda),
    ),
  };
}

export function displayMetricValue(metricValue: ValuationMetric): number | null {
  return metricValue.value;
}
