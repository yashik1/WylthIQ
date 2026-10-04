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

const two = [summary("Interactive Brokers", ["AAPL", "MSFT"]), summary("Wealthsimple", ["KO"])];

describe("the portfolio by broker", () => {
  it("shows the connected brokers, with what each is worth, and no holdings until one is selected", () => {
    const html = renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={two} />);
    expect(html).toContain("Interactive Brokers");
    expect(html).toContain("Wealthsimple");
    expect(html).toContain("Connected · 2 holdings");
    expect(html).toContain("$200.00");
    expect(html).toContain("50.0%");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('href="/stock/AAPL"');
  });

  it("opens one broker's holdings when selected", () => {
    const html = renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={two} defaultOpen="Interactive Brokers" />);
    expect(html).toContain("Held at Interactive Brokers");
    expect(html).toContain('href="/stock/AAPL"');
    expect(html).toContain('href="/stock/MSFT"');
    expect(html).not.toContain('href="/stock/KO"');
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
  });

  it("folds a long list after the first eight", () => {
    const many = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];
    const html = renderToStaticMarkup(
      <BrokerBreakdown currency="USD" brokers={[summary("Interactive Brokers", many)]} defaultOpen="Interactive Brokers" />,
    );
    expect(html).toContain("Show 2 more");
    expect(html).not.toContain('href="/stock/J"');
  });

  it("flags a broker connected twice on its tile, and says why when opened", () => {
    const twice = [summary("Interactive Brokers", ["AAPL"], { connectedTwice: ["a Flex token", "SnapTrade"] })];
    expect(renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={twice} />)).toContain("Connected twice");
    expect(
      renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={twice} defaultOpen="Interactive Brokers" />),
    ).toContain("a Flex token and SnapTrade");
  });

  it("marks what was typed in by hand as such, not as connected", () => {
    const html = renderToStaticMarkup(
      <BrokerBreakdown currency="USD" brokers={[summary("Entered by hand", ["F"], { synced: false })]} />,
    );
    expect(html).toContain("Typed in by you · 1 holding");
  });
});
