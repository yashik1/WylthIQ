import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSnapTrade } from "./sync";

const USER = { userId: "user-123", userSecret: "secret" };

/** A fake SnapTrade answering by method and path, recording what it was asked. */
function fakeSnapTrade(routes: Record<string, unknown>) {
  const calls: string[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const key = `${init?.method ?? "GET"} ${url.pathname}`;
    calls.push(key);
    if (!(key in routes)) return new Response("not found", { status: 404 });
    return new Response(JSON.stringify(routes[key]), { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

describe("reading a reader's SnapTrade connections", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.SNAPTRADE_CLIENT_ID = "WYLTHIQ-TEST";
    process.env.SNAPTRADE_CONSUMER_KEY = "consumer-key";
  });
  afterEach(() => {
    process.env = { ...env };
  });

  const routes = {
    "GET /authorizations": [
      { id: "auth-read", type: "read", disabled: false, brokerage: { display_name: "Interactive Brokers" } },
      { id: "auth-trade", type: "trade", disabled: false, brokerage: { display_name: "Wealthsimple" } },
    ],
    "DELETE /authorizations/auth-trade": {},
    "GET /accounts": [
      { id: "acc-ib", brokerage_authorization: "auth-read", institution_name: "Interactive Brokers", name: "Margin", number: "U0000001" },
      { id: "acc-ws", brokerage_authorization: "auth-trade", institution_name: "Wealthsimple", name: "TFSA", number: "WS0000002" },
    ],
    "GET /accounts/acc-ib/positions/all": {
      results: [
        { instrument: { kind: "stock", symbol: "AAPL", raw_symbol: "AAPL", currency: "USD", exchange: "XNAS" }, units: "15", cost_basis: "180.25" },
      ],
      data_freshness: { as_of: "2025-09-30T20:00:00Z" },
    },
    "GET /accounts/acc-ib/activities": {
      data: [
        { id: "act-1", type: "BUY", units: 15, price: 180, fee: 1, trade_date: "2025-02-10T14:35:12Z", symbol: { raw_symbol: "AAPL", exchange: { mic_code: "XNAS" }, currency: { code: "USD" } } },
      ],
      pagination: { offset: 0, limit: 1000, total: 1 },
    },
  };

  it("deletes a connection that could trade, and never reads its accounts", async () => {
    const { fetchImpl, calls } = fakeSnapTrade(routes);
    const { report, details } = await fetchSnapTrade(USER, { fetch: fetchImpl });

    expect(calls).toContain("DELETE /authorizations/auth-trade");
    expect(calls.some((c) => c.includes("acc-ws"))).toBe(false);
    expect(details.refused).toEqual(["Wealthsimple"]);
    expect(details.brokerages).toEqual([{ id: "auth-read", institution: "Interactive Brokers", disabled: false }]);
    expect(report.accounts).toEqual(["acc-ib"]);
  });

  it("reads the read-only one into the shared report", async () => {
    const { fetchImpl } = fakeSnapTrade(routes);
    const { report, details } = await fetchSnapTrade(USER, { fetch: fetchImpl });

    expect(report.positions).toMatchObject([{ symbol: "AAPL", quantity: 15, averageCost: 180.25, label: "Interactive Brokers" }]);
    expect(report.executions).toMatchObject([{ externalId: "act-1", symbol: "AAPL", quantity: 15 }]);
    expect(details.accounts).toEqual([{ id: "acc-ib", institution: "Interactive Brokers", description: "Margin ···0001" }]);
  });

  it("stops rather than half-reading when SnapTrade fails part-way", async () => {
    const broken: Record<string, unknown> = { ...routes };
    delete broken["GET /accounts/acc-ib/activities"];
    const { fetchImpl } = fakeSnapTrade(broken);
    await expect(fetchSnapTrade(USER, { fetch: fetchImpl })).rejects.toMatchObject({ category: "NOT_FOUND" });
  });
});
