import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

// The server actions are endpoints; rendering the card needs only their names.
vi.mock("@/lib/brokers/actions", () => ({
  connectIbkr: vi.fn(),
  disconnectBroker: vi.fn(),
  removeSnapTradeBrokerage: vi.fn(),
  startSnapTradeConnect: vi.fn(),
  syncBrokerNow: vi.fn(),
}));

const { BrokerConnections } = await import("./broker-connections");

describe("the connected-broker card", () => {
  it("says the feature is unavailable, and offers nothing that cannot work", () => {
    const html = renderToStaticMarkup(
      <BrokerConnections unavailable connections={[]} snaptradeAvailable showFlexToken returned={null} />,
    );
    expect(html).toContain("available right now");
    expect(html).not.toContain("Connect a broker");
    expect(html).not.toContain("Upload statement");
  });

  it("offers both routes when it can", () => {
    const html = renderToStaticMarkup(
      <BrokerConnections unavailable={false} connections={[]} snaptradeAvailable showFlexToken={false} returned={null} />,
    );
    expect(html).toContain("Connect a broker");
    expect(html).toContain("Upload statement");
    expect(html).not.toContain("Flex token");
  });

  it("asks for agreement to SnapTrade's terms and privacy policy before connecting", () => {
    const html = renderToStaticMarkup(
      <BrokerConnections unavailable={false} connections={[]} snaptradeAvailable showFlexToken={false} returned={null} />,
    );
    expect(html).toContain("https://snaptrade.com/terms-and-conditions");
    expect(html).toContain("https://snaptrade.com/privacy-policy");
  });

  it("offers to repair a connection the broker disabled, rather than add another", () => {
    const connection = {
      broker: "snaptrade" as const,
      status: "ok" as const,
      lastErrorCode: null,
      statementToDate: null,
      lastSyncedAt: null,
      positions: 0,
      linkedTrades: 0,
      journalSince: "2025-01-01",
      tokenHint: null,
      queryId: null,
      skipped: [],
      details: {
        brokerages: [
          { id: "auth-off", institution: "Questrade", disabled: true },
          { id: "auth-on", institution: "Interactive Brokers", disabled: false },
        ],
      },
    };
    const html = renderToStaticMarkup(
      <BrokerConnections unavailable={false} connections={[connection]} snaptradeAvailable showFlexToken={false} returned={null} />,
    );
    expect(html).toContain('name="reconnect" value="auth-off"');
    expect(html.match(/name="reconnect"/g)).toHaveLength(1);
    expect(html).toContain("Reconnect Questrade");
  });

  it("says when a new broker's trades wait for the daily read", () => {
    const html = renderToStaticMarkup(
      <BrokerConnections unavailable={false} connections={[]} snaptradeAvailable showFlexToken={false} returned="connected-holdings" />,
    );
    expect(html).toContain("next daily sync");
  });

  it("explains a return from SnapTrade that could not be completed", () => {
    const html = renderToStaticMarkup(
      <BrokerConnections unavailable={false} connections={[]} snaptradeAvailable showFlexToken={false} returned="unavailable" />,
    );
    expect(html).toContain("couldn&#x27;t be completed right now");
  });
});
