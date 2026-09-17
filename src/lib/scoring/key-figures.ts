import { fieldValue } from "../fundamentals/normalize";
import type { NormalizedFundamentals } from "../fundamentals/types";
import { div } from "./math";
import { freeCashFlowOf } from "./returns";
import { buildValuationMetrics, type ValuationMetrics } from "./valuation";

/** Standard reference metrics plus the centralized valuation set. */
export interface KeyFigures {
  freeCashFlow: number | null;
  fcfMargin: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  eps: number | null;
  interestCoverage: number | null;
  shareCountChange: number | null;
  priceToFreeCashFlow: number | null;
  /** Every valuation metric carries value, status, source and basis. */
  valuation: ValuationMetrics;
}

export function buildKeyFigures(
  fundamentals: NormalizedFundamentals,
  marketCap: number | null,
): KeyFigures {
  const latest = fundamentals.annual[0];
  const prior = fundamentals.annual[1];
  const f = (k: Parameters<typeof fieldValue>[1]) => fieldValue(latest, k);
  const p = (k: Parameters<typeof fieldValue>[1]) => fieldValue(prior, k);

  const revenue = f("revenue");
  const netIncome = f("netIncome");
  const freeCashFlow = freeCashFlowOf(f("operatingCashFlow"), f("capex"));
  const shares = f("sharesOutstanding");
  const priorShares = p("sharesOutstanding");
  const interest = f("interestExpense");
  const operatingIncome = f("operatingIncome");

  return {
    freeCashFlow,
    fcfMargin: div(freeCashFlow, revenue),
    grossMargin: div(f("grossProfit"), revenue),
    operatingMargin: div(operatingIncome, revenue),
    netMargin: div(netIncome, revenue),
    returnOnEquity: div(netIncome, f("equity")),
    returnOnAssets: div(netIncome, f("assets")),
    eps: div(netIncome, shares),
    interestCoverage:
      interest != null && interest > 0 ? div(operatingIncome, interest) : null,
    shareCountChange:
      shares != null && priorShares != null && priorShares > 0
        ? (shares - priorShares) / priorShares
        : null,
    priceToFreeCashFlow:
      freeCashFlow != null && freeCashFlow > 0 ? div(marketCap, freeCashFlow) : null,
    valuation: buildValuationMetrics(fundamentals, marketCap),
  };
}
