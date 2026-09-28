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

  it("explains a return from SnapTrade that could not be completed", () => {
    const html = renderToStaticMarkup(
      <BrokerConnections unavailable={false} connections={[]} snaptradeAvailable showFlexToken={false} returned="unavailable" />,
    );
    expect(html).toContain("couldn&#x27;t be completed right now");
  });
});
