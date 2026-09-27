import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { elementAttributes, hasSection, statementBlocks } from "./flex-xml";
import {
  assertFlexUrl,
  downloadFlexReport,
  flexDate,
  flexDateTime,
  FlexError,
  parseFlexReport,
  statementUrl,
} from "./ibkr-flex";

const STATEMENT = readFileSync(join(import.meta.dirname, "fixtures", "flex-statement.xml"), "utf8");
const TOKEN = "987654321098765432109876";

const envelope = (inner: string) =>
  `<FlexStatementResponse timestamp="01 October, 2025 02:00 AM EDT">${inner}</FlexStatementResponse>`;
const SENT = envelope(
  "<Status>Success</Status><ReferenceCode>1234567890</ReferenceCode>" +
    "<Url>https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url>",
);
const IN_PROGRESS = envelope(
  "<Status>Warn</Status><ErrorCode>1019</ErrorCode><ErrorMessage>Statement generation in progress.</ErrorMessage>",
);
const THROTTLED = envelope(
  "<Status>Warn</Status><ErrorCode>1018</ErrorCode><ErrorMessage>Too many requests.</ErrorMessage>",
);
const EXPIRED = envelope(
  "<Status>Fail</Status><ErrorCode>1012</ErrorCode><ErrorMessage>Token has expired.</ErrorMessage>",
);

/** A fetch that answers each call with the next body, recording what was asked. */
function scripted(bodies: string[]) {
  const calls: { url: URL; init?: RequestInit }[] = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: new URL(String(input)), init });
    const body = bodies.shift();
    if (body === undefined) throw new Error("unexpected request");
    return new Response(body, { status: 200 });
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const noSleep = vi.fn(async () => {});

describe("reading Flex XML", () => {
  it("reads attributes from self-closing elements without confusing Trade with Trades", () => {
    const [first] = statementBlocks(STATEMENT);
    expect(first.attributes.accountId).toBe("U0000001");
    const trades = elementAttributes(first.body, "Trade");
    expect(trades).toHaveLength(6);
    expect(trades[0].symbol).toBe("AAPL");
    expect(hasSection(first.body, "Trades")).toBe(true);
  });

  it("decodes entities in attribute values", () => {
    const [first] = statementBlocks(STATEMENT);
    const toyota = elementAttributes(first.body, "Trade").find((t) => t.symbol === "7203");
    expect(toyota?.description).toBe("TOYOTA & CO");
  });

  it("reads both date formats a Flex query commonly uses", () => {
    expect(flexDate("20250930")).toBe("2025-09-30");
    expect(flexDate("2025-09-30")).toBe("2025-09-30");
    expect(flexDate("09/30/2025")).toBeNull();
    expect(flexDateTime("20250210;093512", "x")).toBe("2025-02-10T09:35:12");
    expect(flexDateTime("2025-03-03;14:20:05", "x")).toBe("2025-03-03T14:20:05");
    expect(flexDateTime("2025-03-03, 14:20:05", "x")).toBe("2025-03-03T14:20:05");
    expect(flexDateTime(undefined, "2025-03-03")).toBe("2025-03-03T00:00:00");
  });
});

describe("parsing a Flex statement", () => {
  const report = parseFlexReport(STATEMENT);

  it("covers every account in the report", () => {
    expect(report.accounts).toEqual(["U0000001", "U0000002"]);
    expect(report.toDate).toBe("2025-09-30");
    expect(report.sections).toEqual({ positions: true, trades: true });
  });

  it("takes each holding once, from the summary, not again from its lots", () => {
    const aapl = report.positions.filter((p) => p.symbol === "AAPL");
    expect(aapl).toHaveLength(1);
    expect(aapl[0]).toMatchObject({ quantity: 15, averageCost: 180.25, currency: "USD", reportDate: "2025-09-30" });
  });

  it("maps listings into this app's notation", () => {
    expect(report.positions.map((p) => p.symbol).sort()).toEqual(["AAPL", "BRK.B", "RY.TO", "XEQT.TO"]);
  });

  it("never keeps the broker's own price or value for a holding", () => {
    for (const position of report.positions) {
      expect(Object.keys(position)).not.toContain("markPrice");
      expect(Object.keys(position)).not.toContain("positionValue");
    }
  });

  it("says what it left out, and why", () => {
    const reasons = Object.fromEntries(report.skipped.map((s) => [s.symbol, s.reason]));
    expect(reasons["TSLA"]).toMatch(/short/);
    expect(reasons["7203"]).toMatch(/outside the US and Canada/);
    expect(reasons["AAPL  251219C00250000"]).toMatch(/not a stock/);
  });

  it("lists something held and traded as one item, not two", () => {
    expect(report.skipped.filter((s) => s.symbol === "AAPL  251219C00250000")).toHaveLength(1);
  });

  it("takes each fill once, from the executions, ignoring order and closed-lot rows", () => {
    const aapl = report.executions.filter((e) => e.symbol === "AAPL");
    expect(aapl.map((e) => e.externalId)).toEqual(["0000e0d5.0001.01.01", "0000e0d5.0002.01.01"]);
    expect(aapl[0]).toMatchObject({
      quantity: 10,
      price: 170,
      commission: 1,
      commissionCurrency: "USD",
      tradeDate: "2025-02-10",
      executedAt: "2025-02-10T09:35:12",
    });
  });

  it("keeps a sale negative", () => {
    const sale = report.executions.find((e) => e.externalId === "0000f1a2.0003.01.01");
    expect(sale).toMatchObject({ symbol: "SHOP.TO", quantity: -10, price: 165 });
  });

  it("records every stock holding's true size, including the ones not shown", () => {
    expect(report.reportedQuantities["U0000001|265598"]).toBe(15);
    expect(report.reportedQuantities["U0000001|76792991"]).toBe(-5);
    expect(report.reportedQuantities["U0000001|13905"]).toBe(100);
    expect(report.reportedQuantities["U0000001|700000001"]).toBeUndefined();
  });

  it("leaves option fills out of the journal", () => {
    expect(report.executions.some((e) => e.conid === "700000001")).toBe(false);
  });

  it("refuses something that is not a Flex report", () => {
    expect(() => parseFlexReport("<html>maintenance</html>")).toThrow(FlexError);
    expect(() => parseFlexReport("<FlexQueryResponse><FlexStatements count=\"0\"></FlexStatements></FlexQueryResponse>")).toThrow(
      FlexError,
    );
  });

  it("notices a query that is missing a section", () => {
    const noTrades = STATEMENT.replace(/<Trades>[\s\S]*?<\/Trades>/g, "");
    expect(parseFlexReport(noTrades).sections).toEqual({ positions: true, trades: false });
  });
});

describe("only ever talking to IBKR's report service", () => {
  it("accepts the two Flex report URLs", () => {
    expect(() =>
      assertFlexUrl(new URL("https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest")),
    ).not.toThrow();
    expect(statementUrl(null).hostname).toBe("ndcdyn.interactivebrokers.com");
  });

  it("refuses a statement URL anywhere else, so the token cannot be sent there", () => {
    for (const url of [
      "https://evil.example/AccountManagement/FlexWebService/GetStatement",
      "http://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement",
      "https://gdcdyn.interactivebrokers.com:8443/AccountManagement/FlexWebService/GetStatement",
      "https://user:pw@gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement",
      "https://gdcdyn.interactivebrokers.com/portal.proxy/v1/iserver/account/orders",
      "https://gdcdyn.interactivebrokers.com.evil.example/AccountManagement/FlexWebService/GetStatement",
      "not a url",
    ]) {
      expect(() => statementUrl(url), url).toThrow(FlexError);
    }
  });

  it("drops any parameters IBKR put on the statement URL and sets its own", () => {
    const url = statementUrl(
      "https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement?x=1",
    );
    expect(url.search).toBe("");
  });
});

describe("downloading a report", () => {
  it("requests the report, waits while it is generated, and returns it", async () => {
    const { fetchImpl, calls } = scripted([SENT, IN_PROGRESS, STATEMENT]);
    const xml = await downloadFlexReport(TOKEN, "123456", { fetch: fetchImpl, sleep: noSleep });

    expect(xml).toContain("<FlexQueryResponse");
    expect(calls).toHaveLength(3);
    expect(calls[0].url.pathname).toBe("/AccountManagement/FlexWebService/SendRequest");
    expect(calls[0].url.searchParams.get("q")).toBe("123456");
    expect(calls[1].url.hostname).toBe("gdcdyn.interactivebrokers.com");
    expect(calls[1].url.searchParams.get("q")).toBe("1234567890");
    for (const call of calls) {
      expect(call.init?.method).toBe("GET");
      expect(call.init?.redirect).toBe("error");
    }
  });

  it("backs off longer when IBKR says the token is being throttled", async () => {
    const sleep = vi.fn(async (ms: number) => void ms);
    const { fetchImpl } = scripted([SENT, THROTTLED, STATEMENT]);
    await downloadFlexReport(TOKEN, "123456", { fetch: fetchImpl, sleep });
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1500, 10_000]);
  });

  it("gives up after a bounded number of polls", async () => {
    const { fetchImpl, calls } = scripted([SENT, ...Array(10).fill(IN_PROGRESS)]);
    await expect(downloadFlexReport(TOKEN, "123456", { fetch: fetchImpl, sleep: noSleep })).rejects.toMatchObject({
      category: "NOT_READY",
    });
    expect(calls).toHaveLength(7);
  });

  it("reports an expired token as something the reader has to fix", async () => {
    const { fetchImpl } = scripted([EXPIRED]);
    const error = await downloadFlexReport(TOKEN, "123456", { fetch: fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(error).toBeInstanceOf(FlexError);
    expect(error.code).toBe("1012");
    expect(error.needsAttention).toBe(true);
  });

  it("never repeats the token or IBKR's own wording in what it throws", async () => {
    const failing = vi.fn(async () => {
      throw new Error(`connect ECONNREFUSED https://ndcdyn.interactivebrokers.com/?t=${TOKEN}`);
    }) as unknown as typeof fetch;
    const error = await downloadFlexReport(TOKEN, "123456", { fetch: failing, sleep: noSleep }).catch((e) => e);
    expect(error).toBeInstanceOf(FlexError);
    expect(error.category).toBe("UNAVAILABLE");
    expect(String(error.message)).not.toContain(TOKEN);

    const { fetchImpl } = scripted([EXPIRED]);
    const expired = await downloadFlexReport(TOKEN, "123456", { fetch: fetchImpl, sleep: noSleep }).catch((e) => e);
    expect(expired.message).not.toContain("Token has expired.");
  });

  it("refuses to follow a statement URL off IBKR's hosts", async () => {
    const hijacked = envelope(
      "<Status>Success</Status><ReferenceCode>1</ReferenceCode><Url>https://evil.example/collect</Url>",
    );
    const { fetchImpl, calls } = scripted([hijacked]);
    await expect(downloadFlexReport(TOKEN, "123456", { fetch: fetchImpl, sleep: noSleep })).rejects.toMatchObject({
      category: "INVALID_RESPONSE",
    });
    expect(calls).toHaveLength(1);
  });

  it("treats an HTTP error as the service being unavailable", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await expect(downloadFlexReport(TOKEN, "123456", { fetch: fetchImpl, sleep: noSleep })).rejects.toMatchObject({
      category: "UNAVAILABLE",
    });
  });
});
