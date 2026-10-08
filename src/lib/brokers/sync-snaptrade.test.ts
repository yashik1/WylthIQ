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
    "DELETE /connection/auth-trade": { detail: "Connection queued for deletion", connection_id: "auth-trade" },
    "GET /accounts": [
      { id: "acc-ib", brokerage_authorization: "auth-read", institution_name: "Interactive Brokers", name: "Margin", number: "U0000001", raw_type: "Individual TFSA" },
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

    expect(calls).toContain("DELETE /connection/auth-trade");
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
    expect(details.accounts).toEqual([
      { id: "acc-ib", institution: "Interactive Brokers", description: "Margin ···0001", type: "TFSA" },
    ]);
  });

  it("neither shows nor reads a connection the reader removed while SnapTrade is still deleting it", async () => {
    const { fetchImpl, calls } = fakeSnapTrade(routes);
    const { report, details } = await fetchSnapTrade(USER, { fetch: fetchImpl }, { removed: ["auth-read"] });
    expect(calls.some((c) => c.includes("acc-ib"))).toBe(false);
    expect(calls).not.toContain("DELETE /connection/auth-read");
    expect(details.brokerages).toEqual([]);
    expect(details.accounts).toEqual([]);
    expect(report.positions).toEqual([]);
  });

  describe("reading trades no more than once a day, as SnapTrade asks", () => {
    const now = new Date("2025-10-01T12:00:00Z");
    const hoursAgo = (hours: number) => new Date(now.getTime() - hours * 3_600_000).toISOString();

    it("reads them the first time, and records when", async () => {
      const { fetchImpl, calls } = fakeSnapTrade(routes);
      const { report, details } = await fetchSnapTrade(USER, { fetch: fetchImpl }, {}, now);
      expect(calls).toContain("GET /accounts/acc-ib/activities");
      expect(report.sections.trades).toBe(true);
      expect(details.tradesReadAt).toBe(now.toISOString());
    });

    it("refreshes holdings but not trades within the day", async () => {
      const { fetchImpl, calls } = fakeSnapTrade(routes);
      const { report, details } = await fetchSnapTrade(USER, { fetch: fetchImpl }, { tradesReadAt: hoursAgo(23) }, now);
      expect(calls).toContain("GET /accounts/acc-ib/positions/all");
      expect(calls.some((c) => c.endsWith("/activities"))).toBe(false);
      expect(report.positions).toHaveLength(1);
      expect(report.executions).toEqual([]);
      // Without trades the journal is left alone rather than paired against no fills.
      expect(report.sections).toEqual({ positions: true, trades: false });
      expect(details.tradesReadAt).toBe(hoursAgo(23));
    });

    it("reads them again once a day has passed", async () => {
      const { fetchImpl, calls } = fakeSnapTrade(routes);
      const { details } = await fetchSnapTrade(USER, { fetch: fetchImpl }, { tradesReadAt: hoursAgo(24) }, now);
      expect(calls).toContain("GET /accounts/acc-ib/activities");
      expect(details.tradesReadAt).toBe(now.toISOString());
    });

    it("does not count a read with no account connected yet", async () => {
      const { fetchImpl } = fakeSnapTrade({ "GET /authorizations": [], "GET /accounts": [] });
      const { details } = await fetchSnapTrade(USER, { fetch: fetchImpl }, {}, now);
      expect(details.tradesReadAt).toBeUndefined();
    });
  });

  it("stops rather than half-reading when SnapTrade fails part-way", async () => {
    const broken: Record<string, unknown> = { ...routes };
    delete broken["GET /accounts/acc-ib/activities"];
    const { fetchImpl } = fakeSnapTrade(broken);
    await expect(fetchSnapTrade(USER, { fetch: fetchImpl })).rejects.toMatchObject({ category: "NOT_FOUND" });
  });
});
