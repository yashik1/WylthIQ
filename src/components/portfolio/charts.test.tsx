import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { HAND_ENTERED, type PortfolioChart } from "@/lib/portfolio/charts";
import { AllocationChart } from "./allocation-chart";
import { HoldingsMap } from "./holdings-map";

const chart = (entries: [string, number, string][]): PortfolioChart => ({
  currency: "USD",
  converted: false,
  leftOut: 0,
  holdings: entries.map(([symbol, value, broker]) => ({
    symbol,
    name: `${symbol} Inc.`,
    sector: null,
    broker,
    accountType: "Type not set",
    currency: "USD",
    value,
    cost: value * 0.9,
  })),
});

describe("the allocation ring", () => {
  const eight = chart(
    ["AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "SHOP"].map((s, i) => [s, 800 - i * 50, HAND_ENTERED]),
  );

  it("draws six segments at most, the rest folded into Other", () => {
    const html = renderToStaticMarkup(<AllocationChart chart={eight} />);
    expect(html.match(/<path /g)).toHaveLength(6);
    expect(html).toContain("Other");
    expect(html).toContain("3 more companies");
  });

  it("lists every segment with its share and value, so colour is never the only key", () => {
    const html = renderToStaticMarkup(<AllocationChart chart={eight} />);
    expect(html).toContain("<table");
    expect(html).toContain("AAPL");
    expect(html).toMatch(/\d+\.\d%/);
    expect(html).toContain("$800.00");
    expect(html).toContain('aria-label="AAPL: ');
  });

  it("colours segments in the palette's fixed order, and Other in grey", () => {
    const html = renderToStaticMarkup(<AllocationChart chart={eight} />);
    const fills = [...html.matchAll(/<path[^>]*fill="([^"]+)"/g)].map((m) => m[1]);
    expect(fills).toEqual([1, 2, 3, 4, 5].map((n) => `var(--series-${n})`).concat("var(--faint)"));
  });

  it("offers only the groupings that split the portfolio", () => {
    const one = renderToStaticMarkup(<AllocationChart chart={chart([["AAPL", 100, HAND_ENTERED], ["MSFT", 50, HAND_ENTERED]])} />);
    expect(one).not.toContain("aria-pressed");
    const two = renderToStaticMarkup(
      <AllocationChart chart={chart([["AAPL", 100, HAND_ENTERED], ["MSFT", 50, "Interactive Brokers"]])} />,
    );
    expect(two).toContain(">Broker</button>");
    expect(two).not.toContain(">Currency</button>");
  });
});

describe("the portfolio map", () => {
  it("keys its shades from loss to gain", () => {
    const html = renderToStaticMarkup(<HoldingsMap chart={chart([["AAPL", 100, HAND_ENTERED], ["MSFT", 50, HAND_ENTERED]])} />);
    expect(html).toContain("Loss on cost");
    expect(html).toContain("Gain on cost");
    expect(html).toContain("−25%");
    expect(html).toContain("+25%");
  });
});
