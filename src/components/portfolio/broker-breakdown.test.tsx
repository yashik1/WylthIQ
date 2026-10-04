import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { BrokerSummary } from "@/lib/portfolio/brokers";
import { BrokerBreakdown } from "./broker-breakdown";

const summary = (name: string, symbols: string[], extra: Partial<BrokerSummary> = {}): BrokerSummary => ({
  name,
  synced: true,
  connectedTwice: [],
  value: symbols.length * 100,
  cost: symbols.length * 80,
  gain: symbols.length * 20,
  gainPercent: 0.25,
  share: 0.5,
  reportedAt: "2026-09-30",
  holdings: symbols.map((symbol) => ({
    key: `${name}:${symbol}`,
    symbol,
    name: `${symbol} Inc.`,
    quantity: 10,
    value: 100,
    share: 1 / symbols.length,
    gainPercent: 0.25,
  })),
  uncounted: 0,
  ...extra,
});

describe("the portfolio by broker", () => {
  it("says what each broker holds and how much it is worth", () => {
    const html = renderToStaticMarkup(
      <BrokerBreakdown
        currency="USD"
        brokers={[summary("Interactive Brokers", ["AAPL", "MSFT"]), summary("Wealthsimple", ["KO"])]}
      />,
    );
    expect(html).toContain("Interactive Brokers");
    expect(html).toContain("Wealthsimple");
    expect(html).toContain("2 holdings");
    expect(html).toContain("$200.00");
    expect(html).toContain("50.0%");
    expect(html).toContain("Sep 30, 2026");
    expect(html).toContain('href="/stock/AAPL"');
  });

  it("folds a long list away after the first eight", () => {
    const many = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const html = renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={[summary("Interactive Brokers", many)]} />);
    expect(html).toContain("Show 2 more");
  });

  it("warns when a broker is connected twice", () => {
    const html = renderToStaticMarkup(
      <BrokerBreakdown
        currency="USD"
        brokers={[summary("Interactive Brokers", ["AAPL"], { connectedTwice: ["a Flex token", "SnapTrade"] })]}
      />,
    );
    expect(html).toContain("Connected twice");
    expect(html).toContain("a Flex token and SnapTrade");
  });
});
