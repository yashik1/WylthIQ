import { describe, expect, it } from "vitest";
import { backtestAnswer, defaultBacktestStart } from "./answer";
import type { InvestmentResult } from "./single-stock";

const at = (iso: string) => Date.parse(`${iso}T14:30:00Z`) / 1000;

const run = (over: Partial<InvestmentResult> = {}): InvestmentResult => ({
  startTime: at("2015-01-02"),
  endTime: at("2026-11-05"),
  startedLate: false,
  initialAmount: 10_000,
  finalValue: 102_345.6,
  totalReturn: 9.23456,
  cagr: 0.2172,
  dividendsReceived: 0,
  reinvested: true,
  series: [],
  ...over,
});

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

describe("the question a backtest answers", () => {
  it("is asked as a question and answered in one direct sentence", () => {
    const { question, answer } = backtestAnswer({
      symbol: "AAPL",
      name: "Apple Inc.",
      amount: 10_000,
      result: run(),
      reinvest: true,
    });
    expect(question).toBe("What would $10,000 in AAPL from 2015 be worth today?");
    expect(answer).toContain("$10,000 put into Apple Inc. (AAPL) on January 2, 2015 was worth $102,346 on November 5, 2026");
    expect(answer).toContain("a gain of 923%, or 21.7% a year on average, with any dividends reinvested");
    // Long enough to stand alone when quoted, short enough to be quoted whole.
    expect(words(answer)).toBeGreaterThanOrEqual(15);
    expect(words(answer)).toBeLessThanOrEqual(70);
  });

  it("asks about the date the run really started from", () => {
    const { question } = backtestAnswer({
      symbol: "AAPL",
      amount: 10_000,
      result: run({ startTime: at("2016-11-07"), startedLate: true }),
      reinvest: true,
    });
    expect(question).toContain("from 2016");
  });

  it("says a loss is a loss, and names dividends taken as cash", () => {
    const { answer } = backtestAnswer({
      symbol: "XYZ",
      amount: 5_000,
      result: run({ finalValue: 3_000, totalReturn: -0.4, cagr: -0.05, reinvested: false, dividendsReceived: 250 }),
      reinvest: false,
    });
    expect(answer).toContain("$5,000 put into XYZ on");
    expect(answer).toContain("a loss of 40.0%, or minus 5.0% a year on average");
    expect(answer).toContain("including $250 of dividends taken as cash");
  });

  it("leaves out a yearly figure the run is too short to have", () => {
    const { answer } = backtestAnswer({
      symbol: "BTC-USD",
      name: "Bitcoin",
      amount: 1_000,
      result: run({ finalValue: 1_050, totalReturn: 0.05, cagr: null, reinvested: false }),
      reinvest: false,
    });
    expect(answer).toContain("a gain of 5.0%.");
    expect(answer).not.toContain("a year");
  });
});

describe("a link that names only a symbol", () => {
  it("runs from New Year's Day five years back", () => {
    expect(defaultBacktestStart(new Date("2026-11-06T12:00:00Z"))).toBe("2021-01-01");
  });
});
