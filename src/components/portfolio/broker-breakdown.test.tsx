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
    account: "acct",
    symbol,
    name: `${symbol} Inc.`,
    quantity: 10,
    value: 100,
    share: 1 / symbols.length,
    gainPercent: 0.25,
  })),
  accounts: [
    { key: "acct", type: null, label: "Type not set", description: null, value: symbols.length * 100, share: 1, holdings: symbols.length },
  ],
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

  it("draws the brokers as a ring whose slices can be chosen", () => {
    const html = renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={two} />);
    expect(html).toContain('aria-label="Value by broker"');
    expect(html.match(/<path [^>]*role="button"/g)).toHaveLength(2);
    expect(html).toContain('aria-label="Interactive Brokers: ');
    expect(html).toContain("2 brokers connected");
  });

  it("opens one broker's holdings when selected", () => {
    const html = renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={two} defaultOpen="Interactive Brokers" />);
    expect(html).toContain("Held at Interactive Brokers");
    expect(html).toContain('href="/stock/AAPL"');
    expect(html).toContain('href="/stock/MSFT"');
    expect(html).not.toContain('href="/stock/KO"');
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    // A second ring, of what the chosen broker holds, company by company.
    expect(html).toContain('aria-label="What Interactive Brokers holds"');
    expect(html).toContain('aria-label="AAPL: ');
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
    expect(renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={twice} />)).toMatch(/connected twice/i);
    expect(
      renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={twice} defaultOpen="Interactive Brokers" />),
    ).toContain("a Flex token and SnapTrade");
  });

  describe("a broker with more than one account", () => {
    const base = summary("Questrade", ["XEQT.TO", "XEQT.TO", "AAPL"]);
    const questrade: BrokerSummary = {
      ...base,
      holdings: [
        { ...base.holdings[0], key: "q:tfsa:XEQT", account: "tfsa", value: 150, share: 0.5 },
        { ...base.holdings[1], key: "q:rrsp:XEQT", account: "rrsp", value: 100, share: 1 / 3 },
        { ...base.holdings[2], key: "q:rrsp:AAPL", account: "rrsp", value: 50, share: 1 / 6 },
      ],
      accounts: [
        { key: "tfsa", type: "TFSA", label: "TFSA", description: "TFSA ···0001", value: 150, share: 0.5, holdings: 1 },
        { key: "rrsp", type: "RRSP", label: "RRSP", description: "RRSP ···0002", value: 150, share: 0.5, holdings: 2 },
      ],
    };

    it("counts its accounts on its row", () => {
      const html = renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={[questrade]} />);
      expect(html).toContain("Connected · 2 accounts · 3 holdings");
    });

    it("offers each account, with its kind and value, to narrow the holdings to", () => {
      const html = renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={[questrade]} defaultOpen="Questrade" />);
      expect(html).toContain('aria-label="Accounts at Questrade"');
      expect(html.match(/aria-pressed="(true|false)"[^>]*>/g)?.length).toBeGreaterThanOrEqual(3);
      expect(html).toContain("All accounts");
      expect(html).toContain("TFSA ···0001");
      expect(html).toContain("RRSP ···0002");
    });

    it("names the account under each holding, so one ETF in two accounts reads as two holdings", () => {
      const html = renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={[questrade]} defaultOpen="Questrade" />);
      const rows = html.slice(html.indexOf("<tbody"));
      expect(rows.match(/href="\/stock\/XEQT.TO"/g)).toHaveLength(2);
      expect(rows).toMatch(/XEQT\.TO Inc\.<\/span><span[^>]*>TFSA</);
      expect(rows).toMatch(/XEQT\.TO Inc\.<\/span><span[^>]*>RRSP</);
    });
  });

  it("names a broker's one account in its heading when its kind is known", () => {
    const tfsa = summary("Wealthsimple", ["VFV.TO"], {
      accounts: [{ key: "acct", type: "TFSA", label: "TFSA", description: "TFSA ···0003", value: 100, share: 1, holdings: 1 }],
    });
    const html = renderToStaticMarkup(<BrokerBreakdown currency="USD" brokers={[tfsa]} defaultOpen="Wealthsimple" />);
    expect(html).toMatch(/Held at Wealthsimple<span[^>]*> · TFSA</);
    expect(html).not.toContain("Accounts at Wealthsimple");
  });

  it("marks what was typed in by hand as such, not as connected", () => {
    const html = renderToStaticMarkup(
      <BrokerBreakdown currency="USD" brokers={[summary("Entered by hand", ["F"], { synced: false })]} />,
    );
    expect(html).toContain("Typed in by you · 1 holding");
  });
});
