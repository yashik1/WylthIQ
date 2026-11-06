import type { InvestmentResult } from "./single-stock";

/**
 * The question a backtest answers, asked as a heading and answered in one
 * sentence.
 *
 * A run's figures sit in metric tiles — "Would be worth", "Total return" —
 * which a person reads at a glance but which, as text, are a label and a
 * number with nothing joining them. An answer engine quoting the page needs
 * the sentence: what was put in, when, what it became and by how much. A site
 * audit found no heading on these pages phrased as the question they answer.
 */

/**
 * Where a run starts when a link names only a symbol.
 *
 * A crypto or commodity page links to "/backtest?symbol=BTC-USD" — the
 * instrument, not a date — and that URL used to open on an empty form saying
 * "Nothing to show yet", which is all a crawler following it ever saw. It now
 * runs from New Year's Day five years back: inside the ten-year fetch limit,
 * and long enough to mean something. A coin listed since then starts from its
 * first price, and the page says so.
 */
export function defaultBacktestStart(now = new Date()): string {
  return `${now.getUTCFullYear() - 5}-01-01`;
}

export interface BacktestAnswer {
  question: string;
  answer: string;
}

const DOLLARS = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

function day(seconds: number): string {
  return new Date(seconds * 1000).toLocaleDateString("en-US", {
    timeZone: "UTC",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function percent(fraction: number): string {
  const value = Math.abs(fraction * 100);
  return `${value >= 100 ? Math.round(value).toLocaleString("en-US") : value.toFixed(1)}%`;
}

export function backtestAnswer(input: {
  symbol: string;
  /** The instrument's own name where known: "Apple Inc.", "Gold". */
  name?: string | null;
  amount: number;
  result: InvestmentResult;
  reinvest: boolean;
  /** True when the series already carries dividends, whatever was asked for. */
  dividendsBakedIn?: boolean;
}): BacktestAnswer {
  const { symbol, result } = input;
  const subject = input.name && input.name !== symbol ? `${input.name} (${symbol})` : symbol;
  const put = DOLLARS.format(input.amount);
  const year = new Date(result.startTime * 1000).getUTCFullYear();

  const moved =
    result.totalReturn >= 0 ? `a gain of ${percent(result.totalReturn)}` : `a loss of ${percent(result.totalReturn)}`;
  const yearly =
    result.cagr == null
      ? ""
      : `, or ${result.cagr >= 0 ? "" : "minus "}${percent(result.cagr)} a year on average`;
  const dividends = input.dividendsBakedIn
    ? ", with dividends reinvested"
    : result.reinvested
      ? ", with any dividends reinvested"
      : result.dividendsReceived > 0
        ? `, including ${DOLLARS.format(result.dividendsReceived)} of dividends taken as cash`
        : "";

  return {
    question: `What would ${put} in ${symbol} from ${year} be worth today?`,
    answer:
      `${put} put into ${subject} on ${day(result.startTime)} was worth ` +
      `${DOLLARS.format(result.finalValue)} on ${day(result.endTime)}: ${moved}${yearly}${dividends}. ` +
      "That is the actual price history, held without selling, before fees and taxes.",
  };
}
