import { describe, expect, it } from "vitest";
import { holdingsAfterLaterFills, matchProvisional, withConfirmations } from "./confirmations";
import { CONFIRMATION_PREFIX, FlexError, parseTradeConfirms } from "./ibkr-flex";
import type { BrokerReport, ReportExecution } from "./report";

/** A Trade Confirmation Flex report, the shape IBKR sends: one statement per account, executions as rows. */
const CONFIRMS = `<FlexQueryResponse queryName="Today" type="TCF">
<FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20260923" toDate="20260930" period="Last7CalendarDays" whenGenerated="20260930;121500">
<TradeConfirms>
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" conid="265598" tradeDate="20260929" dateTime="20260929;103000" quantity="5" buySell="BUY" price="226.10" commission="-1" commissionCurrency="USD" ibExecID="0000e0d5.old.01.01" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" conid="265598" tradeDate="20260930" dateTime="20260930;094512" quantity="10" buySell="BUY" price="228.40" commission="-1.05" commissionCurrency="USD" ibExecID="0000e0d5.aapl.01.01" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="STK" symbol="AAPL" conid="265598" tradeDate="20260930" dateTime="20260930;094512" quantity="10" buySell="BUY" price="228.40" levelOfDetail="ORDER" ibExecID="order-row" />
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="STK" symbol="MSFT" conid="272093" tradeDate="20260930" dateTime="20260930;101010" quantity="4" buySell="SELL" price="415.00" commission="-1" commissionCurrency="USD" execID="0000e0d5.msft.01.01" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="STK" symbol="NEWCO" conid="999999" tradeDate="20260930" dateTime="20260930;111111" quantity="20" buySell="BUY" price="12.00" ibExecID="0000e0d5.newco.01.01" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="STK" symbol="SHOP" conid="195014116" listingExchange="NYSE" tradeDate="20260930" dateTime="20260930;121212" quantity="3" buySell="BUY" price="150.00" ibExecID="0000e0d5.shop.01.01" levelOfDetail="EXECUTION" />
<TradeConfirm accountId="U1234567" currency="USD" assetCategory="OPT" symbol="AAPL 261016C00230000" conid="77" tradeDate="20260930" quantity="1" buySell="BUY" price="3.10" ibExecID="0000e0d5.opt.01.01" levelOfDetail="EXECUTION" />
</TradeConfirms>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

const known = new Map([
  ["265598", "AAPL"],
  ["272093", "MSFT"],
]);

describe("reading today's fills from a Trade Confirmation report", () => {
  const { executions, skipped } = parseTradeConfirms(CONFIRMS, { after: "2026-09-29", symbols: known });

  it("takes only the fills after the statement's last day, each once, from the executions", () => {
    expect(executions.map((e) => e.symbol)).toEqual(["AAPL", "MSFT", "SHOP"]);
    expect(executions[0]).toMatchObject({
      accountId: "U1234567",
      conid: "265598",
      quantity: 10,
      price: 228.4,
      commission: 1.05,
      tradeDate: "2026-09-30",
      executedAt: "2026-09-30T09:45:12",
    });
  });

  it("marks each as provisional, keyed by IBKR's execution id", () => {
    expect(executions.map((e) => e.externalId)).toEqual([
      `${CONFIRMATION_PREFIX}0000e0d5.aapl.01.01`,
      `${CONFIRMATION_PREFIX}0000e0d5.msft.01.01`,
      `${CONFIRMATION_PREFIX}0000e0d5.shop.01.01`,
    ]);
  });

  it("keeps a sale negative", () => {
    expect(executions[1].quantity).toBe(-4);
  });

  it("names a contract from the statement, or from its listing if the row has one, and never guesses", () => {
    expect(executions[2].symbol).toBe("SHOP");
    expect(skipped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ symbol: "NEWCO", reason: expect.stringContaining("daily statement") }),
        expect.objectContaining({ symbol: "AAPL 261016C00230000" }),
      ]),
    );
  });

  it("refuses a report with no trade confirmations in it, such as an Activity query given by mistake", () => {
    const activity = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1" toDate="20260929"><Trades/></FlexStatement></FlexStatements></FlexQueryResponse>`;
    expect(() => parseTradeConfirms(activity, { after: null, symbols: known })).toThrow(FlexError);
  });
});

const statement = (executions: Partial<ReportExecution>[] = []): BrokerReport => ({
  accounts: ["U1234567"],
  toDate: "2026-09-29",
  positions: [],
  executions: executions.map((e) => ({
    accountId: "U1234567",
    conid: "265598",
    externalId: "x",
    symbol: "AAPL",
    quantity: 10,
    price: 228.4,
    commission: 1,
    commissionCurrency: "USD",
    currency: "USD",
    tradeDate: "2026-09-29",
    executedAt: "2026-09-29T09:45:12",
    label: "Interactive Brokers",
    ...e,
  })),
  skipped: [{ symbol: "NEWCO", reason: "earlier reason" }],
  reportedQuantities: { "U1234567|265598": 50 },
  sections: { positions: true, trades: true },
});

describe("adding today's fills to the statement", () => {
  it("adds the fills, and says what it left out without repeating the statement", () => {
    const { executions, skipped } = parseTradeConfirms(CONFIRMS, { after: "2026-09-29", symbols: known });
    const merged = withConfirmations(statement(), { executions, skipped });
    expect(merged.executions).toHaveLength(3);
    expect(merged.skipped.filter((s) => s.symbol === "NEWCO")).toEqual([{ symbol: "NEWCO", reason: "earlier reason" }]);
    expect(merged.reportedQuantities).toEqual({ "U1234567|265598": 50 });
  });
});

const fill = (externalId: string, overrides: Record<string, unknown> = {}) => ({
  accountId: "U1234567",
  conid: "265598",
  externalId,
  quantity: 10,
  price: 228.4,
  tradeDate: "2026-09-30",
  executedAt: "2026-09-30T09:45:12",
  ...overrides,
});

describe("pairing against holdings that are a day old", () => {
  it("adds today's provisional fills to the statement's holding, so they are not mistaken for old shares", () => {
    const holdings = holdingsAfterLaterFills(
      { "U1234567|265598": 50 },
      [fill(`${CONFIRMATION_PREFIX}a`), fill(`${CONFIRMATION_PREFIX}b`, { quantity: -4 }), fill("statement-fill", { tradeDate: "2026-09-29" })],
      "2026-09-29",
    );
    expect(holdings["U1234567|265598"]).toBe(56);
  });

  it("starts a holding bought today from nothing plus the purchase", () => {
    const holdings = holdingsAfterLaterFills({}, [fill(`${CONFIRMATION_PREFIX}a`, { conid: "999" })], "2026-09-29");
    expect(holdings["U1234567|999"]).toBe(10);
  });

  it("leaves the holding alone for a provisional fill the statement already covers", () => {
    const holdings = holdingsAfterLaterFills({ k: 1 }, [fill(`${CONFIRMATION_PREFIX}a`, { tradeDate: "2026-09-29" })], "2026-09-29");
    expect(holdings).toEqual({ k: 1 });
  });
});

describe("handing a provisional fill over to the statement", () => {
  it("finds the statement's copy by IBKR's execution id", () => {
    const pairs = matchProvisional(
      [fill(`${CONFIRMATION_PREFIX}0000e0d5.aapl.01.01`)],
      statement([{ externalId: "0000e0d5.aapl.01.01", executedAt: "2026-09-30T09:45:13" }]).executions,
    );
    expect(pairs).toEqual([{ provisionalId: `${CONFIRMATION_PREFIX}0000e0d5.aapl.01.01`, statementId: "0000e0d5.aapl.01.01" }]);
  });

  it("falls back to the same account, contract, time, size and price when the ids differ", () => {
    const pairs = matchProvisional(
      [fill(`${CONFIRMATION_PREFIX}exec-1`)],
      statement([{ externalId: "trade-99", executedAt: "2026-09-30T09:45:12" }]).executions,
    );
    expect(pairs[0].statementId).toBe("trade-99");
  });

  it("claims each statement fill once, ids before lookalikes", () => {
    const pairs = matchProvisional(
      [fill(`${CONFIRMATION_PREFIX}other`), fill(`${CONFIRMATION_PREFIX}exact`)],
      statement([{ externalId: "exact", executedAt: "2026-09-30T09:45:12" }]).executions,
    );
    expect(pairs).toEqual([
      { provisionalId: `${CONFIRMATION_PREFIX}other`, statementId: null },
      { provisionalId: `${CONFIRMATION_PREFIX}exact`, statementId: "exact" },
    ]);
  });

  it("drops a provisional fill the statement never had, such as a trade IBKR reversed", () => {
    expect(matchProvisional([fill(`${CONFIRMATION_PREFIX}gone`)], statement().executions)).toEqual([
      { provisionalId: `${CONFIRMATION_PREFIX}gone`, statementId: null },
    ]);
  });

  it("never matches one provisional fill with another", () => {
    const pairs = matchProvisional(
      [fill(`${CONFIRMATION_PREFIX}a`)],
      statement([{ externalId: `${CONFIRMATION_PREFIX}b`, executedAt: "2026-09-30T09:45:12" }]).executions,
    );
    expect(pairs[0].statementId).toBeNull();
  });
});

describe("when the confirmation report cannot be read", () => {
  it("keeps the statement as it was, with a note, rather than failing the sync", async () => {
    const { readConfirmations } = await import("./sync");
    const envelope = `<FlexStatementResponse><Status>Success</Status><ReferenceCode>9</ReferenceCode><Url>https://gdcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url></FlexStatementResponse>`;
    // An Activity statement where the confirmations should be: a query set up as the wrong kind.
    const activity = `<FlexQueryResponse><FlexStatements><FlexStatement accountId="U1" toDate="20260929"><Trades/></FlexStatement></FlexStatements></FlexQueryResponse>`;
    const fetchImpl = (async (input: string | URL) =>
      new Response(String(input).includes("SendRequest") ? envelope : activity)) as unknown as typeof fetch;

    const base = statement();
    const { report, note } = await readConfirmations("123456789012345678901234", "222", base, {
      fetch: fetchImpl,
      sleep: async () => {},
    });
    expect(report).toBe(base);
    expect(note).toContain("Trade Confirmation Flex Query");
    expect(note).not.toContain("123456789012345678901234");
  });
});

describe("naming a stock first bought today", () => {
  const row = (attrs: string) =>
    `<FlexQueryResponse type="TCF"><FlexStatements><FlexStatement accountId="U1"><TradeConfirms>` +
    `<TradeConfirm accountId="U1" assetCategory="STK" tradeDate="20260930" dateTime="20260930;100000" quantity="10" buySell="BUY" price="10" ibExecID="e1" levelOfDetail="EXECUTION" ${attrs} />` +
    `</TradeConfirms></FlexStatement></FlexStatements></FlexQueryResponse>`;
  const read = (attrs: string) => parseTradeConfirms(row(attrs), { after: "2026-09-29", symbols: new Map() });

  it("reads a US listing from a US venue in dollars", () => {
    expect(read(`symbol="PLTR" conid="1" currency="USD" exchange="ISLAND"`).executions[0].symbol).toBe("PLTR");
    expect(read(`symbol="BRK B" conid="2" currency="USD" exchange="NYSE"`).executions[0].symbol).toBe("BRK.B");
  });

  it("reads Toronto and the Venture only from their own exchanges", () => {
    expect(read(`symbol="RY" conid="3" currency="CAD" exchange="TSE"`).executions[0].symbol).toBe("RY.TO");
    expect(read(`symbol="ABC" conid="4" currency="CAD" exchange="VENTURE"`).executions[0].symbol).toBe("ABC.V");
    // An alternative venue trades both markets, so it settles neither.
    expect(read(`symbol="RY" conid="5" currency="CAD" exchange="CHIX"`).executions).toEqual([]);
  });

  it("leaves a fill whose venue and currency disagree for the statement", () => {
    const { executions, skipped } = read(`symbol="SHOP" conid="6" currency="CAD" exchange="ISLAND"`);
    expect(executions).toEqual([]);
    expect(skipped[0].reason).toContain("daily statement");
  });
});
