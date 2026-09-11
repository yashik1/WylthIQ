import { fieldValue } from "../fundamentals/normalize";
import type { NormalizedFundamentals } from "../fundamentals/types";
import { div } from "./math";
import { freeCashFlowOf } from "./returns";

/**
 * The figures a reader coming from any other stock site expects to find.
 *
 * Every one of these is computed from fields this app already ingests and
 * stores for every company — several of which were being written to the
 * database and then never read again. `capex` was the starkest: stored on
 * every filing since the beginning, referenced in exactly two column lists,
 * and used in no calculation anywhere. Which meant free cash flow — the
 * number most fundamental analysis is actually built on — did not exist in
 * this codebase at all.
 *
 * The five questions remain the point of the app, and this is not an attempt
 * to become a wall of ratios. It is the smaller claim that somebody weighing
 * one company against another needs to see what it earns per share and
 * whether it generates cash after paying for its own upkeep, and that
 * refusing to show those makes the page look thin rather than focused.
 *
 * Nothing here needs a new data source, so it stays inside the SEC-derived
 * licensing line the rest of the app is held to.
 */

export interface KeyFigures {
  /** Cash from operations after paying for the plant that produced it. */
  freeCashFlow: number | null;
  /** Free cash flow as a share of sales. */
  fcfMargin: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  /** Profit against what the owners put in, rather than against everything owned. */
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  /**
   * Profit per share, from the share count on the balance sheet date.
   *
   * A company's own reported EPS divides by a *weighted average* of the
   * shares in issue across the year, and its diluted figure adds options and
   * convertibles on top. This app ingests a single share count, so its EPS
   * sits close to but not exactly on the headline one — Apple's FY2025 comes
   * out at $7.58 here against the $7.46 it reported. Close enough to be
   * useful, different enough that the hint beside it says so.
   */
  eps: number | null;
  /**
   * Operating profit divided by the interest bill.
   *
   * Null when there is no interest to cover, which is a different statement
   * from "cannot cover it" — a debt-free company has no ratio here, and
   * printing infinity would rank it beside one in trouble.
   */
  interestCoverage: number | null;
  /**
   * Change in share count against a year ago, negative when shares were
   * bought back. Buybacks return cash as surely as a dividend does, and a
   * company quietly issuing stock is diluting the holders it already has.
   */
  shareCountChange: number | null;
  /** What the market pays for each dollar of free cash flow. */
  priceToFreeCashFlow: number | null;
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

  // The whole reason this module exists. Both inputs were already stored.
  // The sign of capital spending is handled in freeCashFlowOf.
  const freeCashFlow = freeCashFlowOf(f("operatingCashFlow"), f("capex"));

  const shares = f("sharesOutstanding");
  const priorShares = p("sharesOutstanding");

  /*
    Net cash per share is deliberately absent.

    It was computed and displayed here until it was checked against a real
    company: this app's `cash` field maps only to cash and equivalents, and
    not to the short-term marketable securities where a cash-rich company
    keeps most of its liquidity. For Apple that produced "-$3.71 a share",
    stating it was in net debt when it holds roughly $20bn more cash than
    borrowings — the opposite of the truth, in a figure a reader would take
    at face value.

    Fixing it properly means ingesting short-term investments, which would
    also move the existing debt question's ratings across the whole universe.
    Removing the wrong number is the honest half of that, and it is the half
    that does not silently re-rate 542 companies.
  */

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
    // A company with no borrowings has no interest to cover, so there is no
    // ratio — not an infinitely good one.
    interestCoverage:
      interest != null && interest > 0 ? div(operatingIncome, interest) : null,
    shareCountChange:
      shares != null && priorShares != null && priorShares > 0
        ? (shares - priorShares) / priorShares
        : null,
    priceToFreeCashFlow:
      freeCashFlow != null && freeCashFlow > 0 ? div(marketCap, freeCashFlow) : null,
  };
}
