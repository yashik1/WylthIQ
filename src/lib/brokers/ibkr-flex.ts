import { tagText } from "../signals/xml-extract";
import { elementAttributes, hasSection, statementBlocks, type Attributes } from "./flex-xml";
import { readCappedText } from "./http";
import { appSymbol } from "./ibkr-symbols";
import {
  positionKey,
  skipList,
  type BrokerReport,
  type ReportExecution,
  type ReportPosition,
  type SkippedItem,
} from "./report";

/**
 * Interactive Brokers, read through its Flex Web Service.
 *
 * READ-ONLY BY CONSTRUCTION. A Flex token is issued for downloading reports
 * and can do nothing else: there is no order, transfer or withdrawal a Flex
 * token can make, whatever this code asks for. That is the guarantee, and it
 * is IBKR's rather than ours. This module adds a second one on top: it can
 * only ever send a GET to two report URLs on IBKR's own hosts, which the test
 * beside it and src/lib/brokers/read-only.test.ts both hold it to.
 *
 * The exchange is two steps. SendRequest names the reader's saved query and
 * gets back a reference code; GetStatement exchanges that code for the report,
 * or for "still generating, try again", which is normal for a few seconds.
 *
 * Nothing IBKR says is passed through. Its error text and the request URL —
 * which carries the token in its query string — are never logged, stored or
 * shown; a failure leaves this module as a code and a category, and the
 * reader sees wording written here.
 */

const SEND_REQUEST_URL =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/SendRequest";
const DEFAULT_STATEMENT_URL =
  "https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement";

/** The only hosts and paths a request may go to. */
const ALLOWED_HOSTS = new Set(["ndcdyn.interactivebrokers.com", "gdcdyn.interactivebrokers.com"]);
const ALLOWED_PATHS = new Set([
  "/AccountManagement/FlexWebService/SendRequest",
  "/AccountManagement/FlexWebService/GetStatement",
]);

/**
 * IBKR's Flex servers have turned away requests carrying some client
 * libraries' default user agents. "Java" is what its own reference client
 * sends, and what the widely used open-source clients settled on.
 */
const USER_AGENT = "Java";

const REQUEST_TIMEOUT_MS = 20_000;
/** A year of fills for a busy account is a few megabytes; this is far past any real report. */
const MAX_BODY_BYTES = 25 * 1024 * 1024;
/** Polls of GetStatement before giving up: with the waits below, under a minute. */
const MAX_POLLS = 6;
const WAIT_NOT_READY_MS = 5_000;
const WAIT_THROTTLED_MS = 10_000;
/** IBKR allows one request a second per token; the first poll waits at least that. */
const FIRST_POLL_DELAY_MS = 1_500;

export type FlexErrorCategory =
  | "TOKEN"
  | "QUERY"
  | "RATE_LIMITED"
  | "NOT_READY"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE";

/** What a reader is told for each category. IBKR's own message is never shown. */
export const FLEX_ERROR_WORDS: Record<FlexErrorCategory, string> = {
  TOKEN:
    "IBKR did not accept the token. It may have expired or been regenerated, or be limited to an IP address — create a new one in the Flex Web Service settings.",
  QUERY:
    "IBKR could not run that Flex query. Check the query ID, and that the query is an Activity Flex Query in XML format.",
  RATE_LIMITED: "IBKR is limiting requests for this token right now. Try again in a minute.",
  NOT_READY: "IBKR took too long to prepare the report. Try again in a few minutes.",
  UNAVAILABLE: "IBKR's report service is not answering right now. Try again later.",
  INVALID_RESPONSE: "IBKR sent back something that was not a Flex report.",
};

export class FlexError extends Error {
  constructor(
    readonly category: FlexErrorCategory,
    /** IBKR's numeric code, when it gave one. */
    readonly code: string | null = null,
  ) {
    super(FLEX_ERROR_WORDS[category]);
    this.name = "FlexError";
  }

  /**
   * Whether the reader has to do something before a retry can work. The
   * nightly sync skips these until they reconnect, rather than spending
   * requests on a token IBKR has already refused.
   */
  get needsAttention(): boolean {
    return this.category === "TOKEN" || this.category === "QUERY";
  }
}

/** IBKR's documented Flex Web Service error codes, grouped by what they ask of the reader. */
function categoryForCode(code: string): FlexErrorCategory {
  switch (code) {
    case "1011": // service account is inactive
    case "1012": // token has expired
    case "1013": // IP restriction
    case "1015": // token is invalid
      return "TOKEN";
    case "1010": // legacy Flex query
    case "1014": // query is invalid
    case "1016": // account is invalid
      return "QUERY";
    case "1018": // too many requests
      return "RATE_LIMITED";
    case "1004": // statement incomplete
    case "1005": // settlement data not ready
    case "1006": // FIFO P/L not ready
    case "1007": // MTM P/L not ready
    case "1008": // MTM and FIFO P/L not ready
    case "1009": // server under heavy load
    case "1019": // statement generation in progress
      return "NOT_READY";
    default:
      return "UNAVAILABLE";
  }
}

/** Throws unless `url` is one of the two Flex report URLs on IBKR's own hosts. */
export function assertFlexUrl(url: URL): void {
  const allowed =
    url.protocol === "https:" &&
    ALLOWED_HOSTS.has(url.hostname) &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    ALLOWED_PATHS.has(url.pathname);
  if (!allowed) throw new FlexError("INVALID_RESPONSE");
}

/**
 * Where to collect the report.
 *
 * SendRequest names the URL itself. It is followed only if it is exactly the
 * GetStatement path on one of IBKR's hosts: a report URL taken on trust from
 * a response is a way to make this server send the reader's token anywhere.
 */
export function statementUrl(fromResponse: string | null): URL {
  if (!fromResponse) return new URL(DEFAULT_STATEMENT_URL);
  let url: URL;
  try {
    url = new URL(fromResponse);
  } catch {
    throw new FlexError("INVALID_RESPONSE");
  }
  assertFlexUrl(url);
  if (url.pathname !== new URL(DEFAULT_STATEMENT_URL).pathname) {
    throw new FlexError("INVALID_RESPONSE");
  }
  // Only the address is kept; the parameters are set here, never taken from IBKR.
  return new URL(`${url.origin}${url.pathname}`);
}

export interface FlexDeps {
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));


/**
 * The one way this module talks to IBKR: a GET to an allowlisted URL.
 *
 * Redirects are refused rather than followed, because following one would
 * carry the token to wherever it pointed. Any transport failure becomes a
 * category, so no message that could quote the URL escapes.
 */
async function flexGet(url: URL, fetchImpl: typeof fetch): Promise<string> {
  assertFlexUrl(url);
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { "User-Agent": USER_AGENT },
      cache: "no-store",
    });
  } catch {
    throw new FlexError("UNAVAILABLE");
  }
  if (!res.ok) throw new FlexError(res.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE");
  const body = await readCappedText(res, MAX_BODY_BYTES);
  if (body === null) throw new FlexError("INVALID_RESPONSE");
  return body;
}

/** The `<FlexStatementResponse>` envelope both steps use to report status and errors. */
function readEnvelope(xml: string): {
  success: boolean;
  code: string | null;
  referenceCode: string | null;
  url: string | null;
} {
  return {
    success: tagText(xml, "Status") === "Success",
    code: tagText(xml, "ErrorCode"),
    referenceCode: tagText(xml, "ReferenceCode"),
    url: tagText(xml, "Url"),
  };
}

/**
 * Downloads the report a reader's saved Flex query produces.
 *
 * At most one SendRequest and six GetStatement polls — well inside IBKR's ten
 * requests a minute per token.
 */
export async function downloadFlexReport(
  token: string,
  queryId: string,
  deps: FlexDeps = {},
): Promise<string> {
  const fetchImpl = deps.fetch ?? fetch;
  const sleep = deps.sleep ?? realSleep;

  const request = new URL(SEND_REQUEST_URL);
  request.search = new URLSearchParams({ t: token.trim(), q: queryId.trim(), v: "3" }).toString();

  const sent = readEnvelope(await flexGet(request, fetchImpl));
  if (!sent.success || !sent.referenceCode) {
    if (sent.code) throw new FlexError(categoryForCode(sent.code), sent.code);
    throw new FlexError("INVALID_RESPONSE");
  }

  const collect = statementUrl(sent.url);
  collect.search = new URLSearchParams({ t: token.trim(), q: sent.referenceCode, v: "3" }).toString();

  let wait = FIRST_POLL_DELAY_MS;
  for (let poll = 0; poll < MAX_POLLS; poll++) {
    await sleep(wait);
    const body = await flexGet(collect, fetchImpl);
    if (body.includes("<FlexQueryResponse")) return body;

    const status = readEnvelope(body);
    if (!status.code) throw new FlexError("INVALID_RESPONSE");
    const category = categoryForCode(status.code);
    if (category === "NOT_READY") wait = WAIT_NOT_READY_MS;
    else if (category === "RATE_LIMITED") wait = WAIT_THROTTLED_MS;
    else throw new FlexError(category, status.code);
  }
  throw new FlexError("NOT_READY");
}

/* ------------------------------------------------------------------ parsing */

/** Who holds every account in a Flex report, for the badge beside each row. */
const INSTITUTION = "Interactive Brokers";

function number(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const n = Number(value.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * A Flex date as ISO, or null.
 *
 * Reads the default `yyyyMMdd` and ISO `yyyy-MM-dd`. A query can be set to
 * other formats, including day-first and month-first ones that cannot be told
 * apart; rather than guess between them, those are refused and the setup
 * steps ask for the default.
 */
export function flexDate(value: string | undefined): string | null {
  const raw = value?.trim() ?? "";
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})/);
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  const parts = compact ?? iso;
  if (!parts) return null;
  const [, y, m, d] = parts;
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${m}-${d}`;
}

/** A Flex date-time — `20240115;093012`, `2024-01-15, 09:30:12` and the like — as sortable ISO. */
export function flexDateTime(value: string | undefined, fallbackDate: string): string {
  const raw = value?.trim() ?? "";
  const date = flexDate(raw) ?? fallbackDate;
  const time = raw.match(/[;,T ]\s*(\d{2}):?(\d{2}):?(\d{2})/);
  return time ? `${date}T${time[1]}:${time[2]}:${time[3]}` : `${date}T00:00:00`;
}

/**
 * The rows of one level of detail, never two.
 *
 * A query can include the same fills at several levels — each execution, each
 * order, each closed lot — and the same holding as a summary and as lots.
 * Counting more than one level counts the same shares twice. The preferred
 * level wins when present; rows that name no level at all are taken to be the
 * only level the query has.
 */
function pickLevel(rows: Attributes[], preferred: string[]): Attributes[] {
  for (const level of preferred) {
    const matching = rows.filter((r) => r.levelOfDetail?.toUpperCase() === level);
    if (matching.length > 0) return matching;
  }
  return rows.filter((r) => !r.levelOfDetail);
}

/** Parses a Flex report into positions and fills in this app's terms. */
export function parseFlexReport(xml: string): BrokerReport {
  if (!xml.includes("<FlexQueryResponse")) throw new FlexError("INVALID_RESPONSE");

  const blocks = statementBlocks(xml);
  if (blocks.length === 0) throw new FlexError("QUERY");

  const skipped = skipList();
  const skip = skipped.add;

  const accounts: string[] = [];
  const reportedQuantities: Record<string, number> = {};
  const positions: ReportPosition[] = [];
  const executions: ReportExecution[] = [];
  let toDate: string | null = null;
  let hasPositions = false;
  let hasTrades = false;

  for (const block of blocks) {
    const accountId = block.attributes.accountId?.trim();
    if (!accountId) continue;
    accounts.push(accountId);

    const blockTo = flexDate(block.attributes.toDate);
    if (blockTo && (!toDate || blockTo > toDate)) toDate = blockTo;

    hasPositions ||= hasSection(block.body, "OpenPositions");
    hasTrades ||= hasSection(block.body, "Trades");

    const positionRows = pickLevel(elementAttributes(block.body, "OpenPosition"), ["SUMMARY"]);
    for (const row of positionRows) {
      if (row.assetCategory?.toUpperCase() !== "STK") {
        skip(row.symbol, "not a stock or fund");
        continue;
      }
      const quantity = number(row.position);
      const cost = number(row.costBasisPrice);
      const conid = row.conid?.trim();
      if (quantity !== null && conid) {
        const key = positionKey(accountId, conid);
        reportedQuantities[key] = (reportedQuantities[key] ?? 0) + quantity;
      }
      if (quantity === null || cost === null || cost < 0 || !conid || !row.symbol) {
        skip(row.symbol, "a position the report did not fully describe");
        continue;
      }
      if (quantity <= 0) {
        if (quantity < 0) skip(row.symbol, "a short position");
        continue;
      }
      const mapped = appSymbol({
        symbol: row.symbol,
        listingExchange: row.listingExchange,
        currency: row.currency,
      });
      if (!mapped.ok) {
        skip(row.symbol, mapped.reason);
        continue;
      }
      positions.push({
        accountId,
        conid,
        symbol: mapped.symbol,
        quantity,
        averageCost: cost,
        currency: row.currency!.trim().toUpperCase(),
        reportDate: flexDate(row.reportDate) ?? blockTo,
        label: INSTITUTION,
      });
    }

    const tradeRows = pickLevel(elementAttributes(block.body, "Trade"), ["EXECUTION", "ORDER"]);
    for (const row of tradeRows) {
      if (row.assetCategory?.toUpperCase() !== "STK") {
        skip(row.symbol, "not a stock or fund, so not added to the journal");
        continue;
      }
      const externalId = row.ibExecID?.trim() || row.tradeID?.trim();
      const conid = row.conid?.trim();
      const price = number(row.tradePrice);
      let quantity = number(row.quantity);
      const tradeDate = flexDate(row.tradeDate) ?? flexDate(row.dateTime);
      if (!externalId || !conid || price === null || price <= 0 || !quantity || !tradeDate || !row.symbol) {
        skip(row.symbol, "a fill the report did not fully describe");
        continue;
      }
      // Quantity is signed in Flex reports; the side is only a cross-check.
      const side = row.buySell?.trim().toUpperCase();
      if (side === "SELL" && quantity > 0) quantity = -quantity;
      if (side === "BUY" && quantity < 0) quantity = -quantity;

      const mapped = appSymbol({
        symbol: row.symbol,
        listingExchange: row.listingExchange,
        currency: row.currency,
      });
      if (!mapped.ok) {
        skip(row.symbol, mapped.reason);
        continue;
      }

      const commission = Math.abs(number(row.ibCommission) ?? 0);
      executions.push({
        accountId,
        conid,
        externalId,
        symbol: mapped.symbol,
        quantity,
        price,
        commission,
        commissionCurrency: row.ibCommissionCurrency?.trim().toUpperCase() || null,
        currency: row.currency!.trim().toUpperCase(),
        tradeDate,
        executedAt: flexDateTime(
          row.dateTime ?? (row.tradeTime ? `${row.tradeDate};${row.tradeTime}` : undefined),
          tradeDate,
        ),
        label: INSTITUTION,
      });
    }
  }

  if (accounts.length === 0) throw new FlexError("QUERY");

  return {
    accounts,
    toDate,
    positions,
    executions,
    skipped: skipped.list(),
    reportedQuantities,
    sections: { positions: hasPositions, trades: hasTrades },
  };
}

/* ------------------------------------------------------ trade confirmations */

/**
 * Marks a fill read from a Trade Confirmation report. Such a fill is
 * provisional: the Activity statement is the record, and once a statement
 * covers the fill's day the provisional copy gives way to the statement's.
 */
export const CONFIRMATION_PREFIX = "tc:";

export function isProvisional(externalId: string): boolean {
  return externalId.startsWith(CONFIRMATION_PREFIX);
}

/** The app's symbol for every IBKR contract a statement names, held or traded. */
export function symbolsByConid(report: BrokerReport): Map<string, string> {
  const symbols = new Map<string, string>();
  for (const p of report.positions) symbols.set(p.conid, p.symbol);
  for (const e of report.executions) symbols.set(e.conid, e.symbol);
  return symbols;
}

/**
 * The fills from a Trade Confirmation Flex report that the Activity statement
 * does not have yet: those after its last day.
 *
 * IBKR adds a day's trades to the Activity statement a few hours after the
 * close; a Trade Confirmation report has them within minutes of execution.
 * Its rows name no listing exchange, so a contract is named from the
 * statement where it appears there; one the statement has never seen is
 * named only if the row carries its listing exchange after all, and is
 * otherwise left for the statement to bring in, rather than guessed at.
 */
export function parseTradeConfirms(
  xml: string,
  { after, symbols }: { after: string | null; symbols: Map<string, string> },
): { executions: ReportExecution[]; skipped: SkippedItem[] } {
  if (!xml.includes("<FlexQueryResponse")) throw new FlexError("INVALID_RESPONSE");
  const blocks = statementBlocks(xml);
  if (!blocks.some((block) => hasSection(block.body, "TradeConfirms"))) throw new FlexError("QUERY");

  const skipped = skipList();
  const skip = skipped.add;
  const executions: ReportExecution[] = [];

  for (const block of blocks) {
    const accountId = block.attributes.accountId?.trim();
    if (!accountId) continue;

    for (const row of pickLevel(elementAttributes(block.body, "TradeConfirm"), ["EXECUTION", "ORDER"])) {
      const tradeDate = flexDate(row.tradeDate) ?? flexDate(row.dateTime);
      // The statement's own days are the statement's to report.
      if (!tradeDate || (after && tradeDate <= after)) continue;
      if (row.assetCategory?.toUpperCase() !== "STK") {
        skip(row.symbol, "not a stock or fund, so not added to the journal");
        continue;
      }

      const id = row.ibExecID?.trim() || row.execID?.trim() || row.tradeID?.trim();
      const conid = row.conid?.trim();
      const price = number(row.tradePrice) ?? number(row.price);
      let quantity = number(row.quantity);
      if (!id || !conid || price === null || price <= 0 || !quantity || !row.currency?.trim()) {
        skip(row.symbol, "a fill the report did not fully describe");
        continue;
      }
      const side = row.buySell?.trim().toUpperCase();
      if (side === "SELL" && quantity > 0) quantity = -quantity;
      if (side === "BUY" && quantity < 0) quantity = -quantity;

      let symbol = symbols.get(conid) ?? null;
      if (!symbol && row.listingExchange && row.symbol) {
        const mapped = appSymbol({ symbol: row.symbol, listingExchange: row.listingExchange, currency: row.currency });
        if (!mapped.ok) {
          skip(row.symbol, mapped.reason);
          continue;
        }
        symbol = mapped.symbol;
      }
      if (!symbol) {
        skip(row.symbol, "new today; it joins the journal once IBKR's daily statement lists it");
        continue;
      }

      executions.push({
        accountId,
        conid,
        externalId: `${CONFIRMATION_PREFIX}${id}`,
        symbol,
        quantity,
        price,
        commission: Math.abs(number(row.ibCommission) ?? number(row.commission) ?? 0),
        commissionCurrency:
          (row.ibCommissionCurrency ?? row.commissionCurrency)?.trim().toUpperCase() || null,
        currency: row.currency.trim().toUpperCase(),
        tradeDate,
        executedAt: flexDateTime(
          row.dateTime ?? (row.tradeTime ? `${row.tradeDate};${row.tradeTime}` : undefined),
          tradeDate,
        ),
        label: INSTITUTION,
      });
    }
  }

  return { executions, skipped: skipped.list() };
}
