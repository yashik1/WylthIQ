import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pairRoundTrips } from "./round-trips";
import {
  accountActivities,
  assertSnapTradeRoute,
  connectionPortalUrl,
  describeAccount,
  listAuthorizations,
  registerUser,
  signRequest,
  snapSymbol,
  SnapTradeError,
  toBrokerReport,
  type SnapAccountData,
} from "./snaptrade";

/*
  Signatures produced by the official snaptrade-typescript-sdk 12.2.12 for
  these exact requests, captured by running the SDK against a local adapter.
  If these stop matching, requests from this app would be refused.
*/
const SDK_VECTORS = [
  {
    method: "POST",
    url: "https://api.snaptrade.com/snapTrade/registerUser?clientId=WYLTHIQ-TEST&timestamp=1790553018",
    data: { userId: "user-123" },
    signature: "9YStJrPseoLVG5ZZ0YfRL15ZHJMqiAyiP/Rf4dfZ4BY=",
  },
  {
    method: "POST",
    url: "https://api.snaptrade.com/snapTrade/login?clientId=WYLTHIQ-TEST&userId=user-123&userSecret=secret-abc&timestamp=1790553018",
    data: {
      immediateRedirect: true,
      customRedirect: "https://example.com/api/brokers/snaptrade/return",
      connectionType: "read",
    },
    signature: "HoeGf8uyxUSfWCuQ9XiQSt6T7L3qKlojUq5yC1PoiC4=",
  },
  {
    method: "GET",
    url: "https://api.snaptrade.com/authorizations?clientId=WYLTHIQ-TEST&userId=user-123&userSecret=secret-abc&timestamp=1790553018",
    data: null,
    signature: "b2EHgZMuk78ZAjFjVRH9pVqxQd7W/+C3BPERDXfAdQY=",
  },
  {
    method: "GET",
    url: "https://api.snaptrade.com/accounts/acc-1/activities?clientId=WYLTHIQ-TEST&userId=user-123&userSecret=secret-abc&offset=0&limit=1000&type=BUY%2CSELL&timestamp=1790553018",
    data: null,
    signature: "oafRSz/e80ZzcEcD5elYZCYEiTTKXX9vC2ZVljN5FBk=",
  },
];
const SDK_CONSUMER_KEY = "test-consumer-key/with?odd=chars";

const USER = { userId: "user-123", userSecret: "secret-abc-SHOULD-NOT-LEAK" };

describe("signing requests the way SnapTrade checks them", () => {
  it.each(SDK_VECTORS)("matches the official SDK for $method $url", (vector) => {
    const url = new URL(vector.url);
    const signature = signRequest(
      { content: vector.data, path: url.pathname, query: url.search.slice(1) },
      SDK_CONSUMER_KEY,
    );
    expect(signature).toBe(vector.signature);
  });
});

describe("the requests this client may make", () => {
  it("allows the read calls and the connect/disconnect housekeeping", () => {
    for (const [method, path] of [
      ["POST", "/snapTrade/registerUser"],
      ["POST", "/snapTrade/login"],
      ["DELETE", "/snapTrade/deleteUser"],
      ["GET", "/authorizations"],
      ["DELETE", "/authorizations/8b5f262d-4bb9-365d-888a-202bd3b15fa1"],
      ["GET", "/accounts"],
      ["GET", "/accounts/917c8734/positions/all"],
      ["GET", "/accounts/917c8734/activities"],
    ]) {
      expect(() => assertSnapTradeRoute(method, path), `${method} ${path}`).not.toThrow();
    }
  });

  it("refuses anything that could trade, and anything else not listed", () => {
    for (const [method, path] of [
      ["POST", "/trade/place"],
      ["POST", "/trade/impact"],
      ["POST", "/accounts/917c8734/trading/replace"],
      ["POST", "/accounts/917c8734/trading/cancel"],
      ["GET", "/accounts/917c8734/orders"],
      ["GET", "/accounts/917c8734/quotes"],
      ["POST", "/snapTrade/resetUserSecret"],
      ["GET", "/authorizations/x/../../trade/place"],
      ["POST", "/accounts"],
      ["GET", "/snapTrade/deleteUser"],
    ]) {
      expect(() => assertSnapTradeRoute(method, path), `${method} ${path}`).toThrow(SnapTradeError);
    }
  });
});

describe("talking to SnapTrade", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.SNAPTRADE_CLIENT_ID = "WYLTHIQ-TEST";
    process.env.SNAPTRADE_CONSUMER_KEY = "consumer-key-SHOULD-NOT-LEAK";
  });
  afterEach(() => {
    process.env = { ...env };
  });

  function answering(...bodies: unknown[]) {
    const calls: { url: URL; init?: RequestInit }[] = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: new URL(String(input)), init });
      const body = bodies.shift();
      if (body instanceof Response) return body;
      return new Response(JSON.stringify(body ?? {}), { status: 200 });
    }) as unknown as typeof fetch;
    return { fetchImpl, calls };
  }

  it("signs, refuses redirects, and sends the secret only where SnapTrade expects it", async () => {
    const { fetchImpl, calls } = answering([]);
    await listAuthorizations(USER, { fetch: fetchImpl, now: () => 1790553018 });
    const [{ url, init }] = calls;
    expect(url.origin + url.pathname).toBe("https://api.snaptrade.com/authorizations");
    expect(url.searchParams.get("clientId")).toBe("WYLTHIQ-TEST");
    expect(url.searchParams.get("timestamp")).toBe("1790553018");
    expect(init?.redirect).toBe("error");
    expect((init?.headers as Record<string, string>).Signature).toMatch(/^[A-Za-z0-9+/]+=*$/);
    expect(url.toString()).not.toContain("consumer-key");
  });

  it("registers a reader and keeps the secret SnapTrade hands back", async () => {
    const { fetchImpl, calls } = answering({ userId: "user-123", userSecret: "s3cret" });
    await expect(registerUser("user-123", { fetch: fetchImpl })).resolves.toEqual({ userId: "user-123", userSecret: "s3cret" });
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ userId: "user-123" });
  });

  it("always asks for a read-only connection", async () => {
    const { fetchImpl, calls } = answering({ redirectURI: "https://app.snaptrade.com/snapTrade/redeemToken?token=x" });
    await connectionPortalUrl(USER, "https://wylthiq.example/api/brokers/snaptrade/return", { fetch: fetchImpl });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({
      connectionType: "read",
      customRedirect: "https://wylthiq.example/api/brokers/snaptrade/return",
    });
  });

  it("will not send a reader anywhere but SnapTrade's own page", async () => {
    for (const redirectURI of ["https://evil.example/login", "http://app.snaptrade.com/x", "https://snaptrade.com.evil.example/", "nonsense"]) {
      const { fetchImpl } = answering({ redirectURI });
      await expect(connectionPortalUrl(USER, "https://x.example/r", { fetch: fetchImpl })).rejects.toMatchObject({
        category: "INVALID_RESPONSE",
      });
    }
  });

  it("reads each connection's access level", async () => {
    const { fetchImpl } = answering([
      { id: "auth-1", type: "read", disabled: false, brokerage: { display_name: "Interactive Brokers" } },
      { id: "auth-2", type: "trade", disabled: false, brokerage: { name: "Wealthsimple" } },
    ]);
    expect(await listAuthorizations(USER, { fetch: fetchImpl })).toEqual([
      { id: "auth-1", type: "read", disabled: false, institution: "Interactive Brokers" },
      { id: "auth-2", type: "trade", disabled: false, institution: "Wealthsimple" },
    ]);
  });

  it("follows the pages of an account's fills", async () => {
    const page = (n: number, start: number) =>
      Array.from({ length: n }, (_, i) => ({ id: `a${start + i}`, type: "BUY", units: 1, price: 10, trade_date: "2025-01-02T10:00:00Z", symbol: { raw_symbol: "AAPL", exchange: { mic_code: "XNAS" }, currency: { code: "USD" } } }));
    const { fetchImpl, calls } = answering(
      { data: page(1000, 0), pagination: { offset: 0, limit: 1000, total: 1500 } },
      { data: page(500, 1000), pagination: { offset: 1000, limit: 1000, total: 1500 } },
    );
    const activities = await accountActivities(USER, "acc-1", { fetch: fetchImpl });
    expect(activities).toHaveLength(1500);
    expect(calls.map((c) => c.url.searchParams.get("offset"))).toEqual(["0", "1000"]);
    expect(calls[0].url.searchParams.get("type")).toBe("BUY,SELL,REI");
  });

  it("turns failures into categories, never repeating a secret", async () => {
    const refused = answering(new Response("Invalid signature for userSecret=secret-abc-SHOULD-NOT-LEAK", { status: 401 }));
    const auth = await listAuthorizations(USER, { fetch: refused.fetchImpl }).catch((e) => e);
    expect(auth).toMatchObject({ category: "AUTH" });
    expect(auth.message).not.toContain("SHOULD-NOT-LEAK");

    const down = vi.fn(async () => {
      throw new Error("ECONNREFUSED https://api.snaptrade.com/authorizations?userSecret=secret-abc-SHOULD-NOT-LEAK");
    }) as unknown as typeof fetch;
    const network = await listAuthorizations(USER, { fetch: down }).catch((e) => e);
    expect(network).toMatchObject({ category: "UNAVAILABLE" });
    expect(network.message).not.toContain("SHOULD-NOT-LEAK");
  });

  it("is switched off without both settings", async () => {
    delete process.env.SNAPTRADE_CONSUMER_KEY;
    const { fetchImpl, calls } = answering([]);
    await expect(listAuthorizations(USER, { fetch: fetchImpl })).rejects.toMatchObject({ category: "NOT_CONFIGURED" });
    expect(calls).toHaveLength(0);
  });
});

describe("SnapTrade listings in this app's notation", () => {
  it("maps US markets by MIC or code", () => {
    expect(snapSymbol("AAPL", "XNAS", "USD")).toEqual({ ok: true, symbol: "AAPL" });
    expect(snapSymbol("SPY", "ARCX", "USD")).toEqual({ ok: true, symbol: "SPY" });
    expect(snapSymbol("BRK.B", "XNYS", "USD")).toEqual({ ok: true, symbol: "BRK.B" });
    expect(snapSymbol("BRK-B", "NYSE", "USD")).toEqual({ ok: true, symbol: "BRK.B" });
  });

  it("gives Canadian listings their suffix, and a class a dash", () => {
    expect(snapSymbol("RY", "XTSE", "CAD")).toEqual({ ok: true, symbol: "RY.TO" });
    expect(snapSymbol("XEQT.TO", "XTSE", "CAD")).toEqual({ ok: true, symbol: "XEQT.TO" });
    expect(snapSymbol("BBD.B", "TSX", "CAD")).toEqual({ ok: true, symbol: "BBD-B.TO" });
    expect(snapSymbol("ABC", "XTSX", "CAD")).toEqual({ ok: true, symbol: "ABC.V" });
  });

  it("refuses a listing in the wrong currency or somewhere else", () => {
    expect(snapSymbol("RY", "XTSE", "USD").ok).toBe(false);
    expect(snapSymbol("VOD", "XLON", "GBP").ok).toBe(false);
    expect(snapSymbol("AAPL", null, "USD").ok).toBe(false);
  });
});

describe("SnapTrade data in the shared report shape", () => {
  const data: SnapAccountData[] = [
    {
      account: { id: "acc-1", authorizationId: "auth-1", institution: "Interactive Brokers", name: "Margin", number: "U0000001" },
      asOf: "2025-09-30T20:00:00Z",
      positions: [
        { kind: "stock", ticker: "AAPL", currency: "USD", exchange: "XNAS", units: 15, costBasis: 180.25 },
        { kind: "etf", ticker: "XEQT", currency: "CAD", exchange: "XTSE", units: 50, costBasis: 30.1 },
        { kind: "adr", ticker: "TSM", currency: "USD", exchange: "XNYS", units: 2, costBasis: 100 },
        { kind: "option", ticker: "AAPL 251219C00250000", currency: "USD", exchange: "XCBO", units: 1, costBasis: 5.2 },
        { kind: "crypto", ticker: "BTC", currency: "USD", exchange: null, units: 0.1, costBasis: 60000 },
        { kind: "stock", ticker: "TSLA", currency: "USD", exchange: "XNAS", units: -5, costBasis: 250 },
        { kind: "stock", ticker: "7203", currency: "JPY", exchange: "XTKS", units: 100, costBasis: 2800 },
      ],
      activities: [
        { id: "act-1", type: "BUY", ticker: "AAPL", exchange: "XNAS", currency: "USD", units: 10, price: 170, fee: -1, tradeDate: "2025-02-10T14:35:12Z" },
        { id: "act-2", type: "BUY", ticker: "AAPL", exchange: "XNAS", currency: "USD", units: 5, price: 200.5, fee: 1.05, tradeDate: "2025-04-02T14:15:00Z" },
        { id: "act-3", type: "BUY", ticker: "SHOP", exchange: "XTSE", currency: "CAD", units: 10, price: 150, fee: 1, tradeDate: "2025-05-05" },
        { id: "act-4", type: "SELL", ticker: "SHOP", exchange: "XTSE", currency: "CAD", units: -10, price: 165, fee: 1, tradeDate: "2025-06-06" },
        { id: "act-5", type: "REI", ticker: "XEQT", exchange: "XTSE", currency: "CAD", units: 0.5, price: 31, fee: 0, tradeDate: "2025-07-01" },
      ],
    },
  ];
  const report = toBrokerReport(data, "2025-10-01");

  it("shows shares of companies and funds, labelled with their broker", () => {
    expect(report.positions.map((p) => [p.symbol, p.quantity, p.averageCost, p.currency, p.label])).toEqual([
      ["AAPL", 15, 180.25, "USD", "Interactive Brokers"],
      ["XEQT.TO", 50, 30.1, "CAD", "Interactive Brokers"],
      ["TSM", 2, 100, "USD", "Interactive Brokers"],
    ]);
    expect(report.toDate).toBe("2025-09-30");
  });

  it("says what it left out and why", () => {
    const reasons = Object.fromEntries(report.skipped.map((s) => [s.symbol, s.reason]));
    expect(reasons["AAPL 251219C00250000"]).toMatch(/not a stock/);
    expect(reasons["BTC"]).toMatch(/not a stock/);
    expect(reasons["TSLA"]).toMatch(/short/);
    expect(reasons["7203"]).toMatch(/outside the US and Canada/);
  });

  it("records the true holding, shorts included, for pairing", () => {
    expect(report.reportedQuantities).toMatchObject({ "acc-1|AAPL": 15, "acc-1|TSLA": -5, "acc-1|XEQT.TO": 50 });
  });

  it("turns buys, sells and reinvested dividends into signed fills", () => {
    expect(report.executions.map((e) => [e.externalId, e.symbol, e.quantity, e.commission, e.executedAt])).toEqual([
      ["act-1", "AAPL", 10, 1, "2025-02-10T14:35:12"],
      ["act-2", "AAPL", 5, 1.05, "2025-04-02T14:15:00"],
      ["act-3", "SHOP.TO", 10, 1, "2025-05-05T00:00:00"],
      ["act-4", "SHOP.TO", -10, 1, "2025-06-06T00:00:00"],
      ["act-5", "XEQT.TO", 0.5, 0, "2025-07-01T00:00:00"],
    ]);
  });

  it("pairs into the same journal trades a Flex report would give", () => {
    const trips = pairRoundTrips(report.executions, report.reportedQuantities);
    const bySymbol = Object.fromEntries(trips.map((t) => [t.symbol, t]));
    expect(bySymbol["AAPL"]).toMatchObject({ quantity: 15, exitPrice: null, closedAt: null });
    expect(bySymbol["SHOP.TO"]).toMatchObject({ quantity: 10, entryPrice: 150, exitPrice: 165, closedAt: "2025-06-06" });
    // XEQT was held before the record began; the reinvestment adds to that, not to a new trade.
    expect(bySymbol["XEQT.TO"]).toBeUndefined();
  });

  it("describes an account without its full number", () => {
    expect(describeAccount(data[0].account)).toBe("Margin ···0001");
  });
});
