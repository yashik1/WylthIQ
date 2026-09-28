import { createHmac } from "node:crypto";
import { readCappedText } from "./http";
import { currencyFits, formatTicker, OUTSIDE_COVERAGE, type Market, type MappedSymbol } from "./listing";
import { positionKey, skipList, type BrokerReport, type ReportExecution, type ReportPosition } from "./report";

/**
 * SnapTrade: connecting a reader's broker without this app ever holding a
 * credential for it.
 *
 * The reader connects on SnapTrade's own page — logging in to their broker
 * there, or for Interactive Brokers switching SnapTrade on under IBKR's own
 * Third-Party Reports settings. This app never sees a password, token or key
 * for the broker. What it keeps is SnapTrade's per-reader secret, which only
 * works for this app's SnapTrade account, alongside its signing key.
 *
 * READ-ONLY. Every connection is requested as `connectionType: "read"`, and
 * every connection SnapTrade reports is checked: one that is not read-only is
 * deleted rather than used (see sync.ts). On top of that, this client can only
 * make the handful of requests in ROUTES below — there is no order, trade or
 * transfer endpoint it could reach even by mistake, and
 * src/lib/brokers/read-only.test.ts holds it to that.
 *
 * Written against SnapTrade's HTTP API directly rather than its SDK, which
 * bundles every trading method alongside the few read calls used here.
 */

const BASE = "https://api.snaptrade.com";

/** Every request this client can make. Anything else is refused before it is sent. */
const ROUTES: readonly { method: "GET" | "POST" | "DELETE"; path: RegExp }[] = [
  { method: "POST", path: /^\/snapTrade\/registerUser$/ },
  { method: "POST", path: /^\/snapTrade\/login$/ },
  { method: "DELETE", path: /^\/snapTrade\/deleteUser$/ },
  { method: "GET", path: /^\/authorizations$/ },
  { method: "DELETE", path: /^\/authorizations\/[A-Za-z0-9-]+$/ },
  { method: "GET", path: /^\/accounts$/ },
  { method: "GET", path: /^\/accounts\/[A-Za-z0-9-]+\/positions\/all$/ },
  { method: "GET", path: /^\/accounts\/[A-Za-z0-9-]+\/activities$/ },
];

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_BODY_BYTES = 10 * 1024 * 1024;
/** Activities per page, SnapTrade's maximum. */
const PAGE = 1000;
/** Pages of fills per account: ten thousand fills, far past any reader's year. */
const MAX_PAGES = 10;

export type SnapTradeErrorCategory =
  | "NOT_CONFIGURED"
  | "AUTH"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "UNAVAILABLE"
  | "INVALID_RESPONSE";

/** What a reader is told. SnapTrade's own message is never shown or stored. */
export const SNAPTRADE_ERROR_WORDS: Record<SnapTradeErrorCategory, string> = {
  NOT_CONFIGURED: "Connecting a broker is not set up on this server yet.",
  AUTH: "SnapTrade did not accept this app's request. Try again later.",
  NOT_FOUND: "SnapTrade no longer has that connection. Connect the broker again.",
  RATE_LIMITED: "SnapTrade is limiting requests right now. Try again in a minute.",
  UNAVAILABLE: "SnapTrade is not answering right now. Try again later.",
  INVALID_RESPONSE: "SnapTrade sent back something unexpected.",
};

export class SnapTradeError extends Error {
  constructor(
    readonly category: SnapTradeErrorCategory,
    readonly status: number | null = null,
  ) {
    super(SNAPTRADE_ERROR_WORDS[category]);
    this.name = "SnapTradeError";
  }
}

export function snaptradeConfigured(): boolean {
  return Boolean(process.env.SNAPTRADE_CLIENT_ID?.trim() && process.env.SNAPTRADE_CONSUMER_KEY?.trim());
}

function credentials(): { clientId: string; consumerKey: string } {
  const clientId = process.env.SNAPTRADE_CLIENT_ID?.trim();
  const consumerKey = process.env.SNAPTRADE_CONSUMER_KEY?.trim();
  if (!clientId || !consumerKey) throw new SnapTradeError("NOT_CONFIGURED");
  return { clientId, consumerKey };
}

/** Throws unless `method path` is one of the requests in ROUTES. */
export function assertSnapTradeRoute(method: string, path: string): void {
  if (!ROUTES.some((route) => route.method === method && route.path.test(path))) {
    throw new SnapTradeError("INVALID_RESPONSE");
  }
}

/**
 * The request signature SnapTrade checks.
 *
 * HMAC-SHA256 of a JSON document holding the body, the path and the query
 * string exactly as sent, with every key sorted, keyed with the consumer key.
 * Mirrors the official SDK's own signer; the test beside this file checks it
 * against signatures that SDK produced.
 */
export function signRequest(
  parts: { content: unknown; path: string; query: string },
  consumerKey: string,
): string {
  const keys: string[] = [];
  JSON.stringify(parts, (key, value) => {
    if (!keys.includes(key)) keys.push(key);
    return value;
  });
  keys.sort();
  return createHmac("sha256", encodeURI(consumerKey)).update(JSON.stringify(parts, keys)).digest("base64");
}

export interface SnapTradeUser {
  userId: string;
  userSecret: string;
}

export interface SnapTradeDeps {
  fetch?: typeof fetch;
  /** Seconds since the epoch, for signing; injectable so tests are repeatable. */
  now?: () => number;
}

/**
 * The one way this module talks to SnapTrade.
 *
 * Refuses any request not in ROUTES before it is signed, refuses redirects
 * rather than following them, and turns every failure into a category so no
 * message quoting the URL — which carries the reader's secret — gets out.
 */
async function snaptradeRequest<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  options: { user?: SnapTradeUser; query?: Record<string, string>; body?: Record<string, unknown> },
  deps: SnapTradeDeps = {},
): Promise<T> {
  assertSnapTradeRoute(method, path);
  const { clientId, consumerKey } = credentials();

  const params = new URLSearchParams({ clientId });
  if (options.user) {
    params.set("userId", options.user.userId);
    params.set("userSecret", options.user.userSecret);
  }
  for (const [key, value] of Object.entries(options.query ?? {})) params.set(key, value);
  params.set("timestamp", String(Math.round(deps.now?.() ?? Date.now() / 1000)));
  const query = params.toString();

  const body = options.body ? JSON.stringify(options.body) : undefined;
  const signature = signRequest({ content: options.body ?? null, path, query }, consumerKey);

  let res: Response;
  try {
    res = await (deps.fetch ?? fetch)(`${BASE}${path}?${query}`, {
      method,
      body,
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      cache: "no-store",
      headers: {
        Signature: signature,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch {
    throw new SnapTradeError("UNAVAILABLE");
  }

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new SnapTradeError("AUTH", res.status);
    if (res.status === 404) throw new SnapTradeError("NOT_FOUND", res.status);
    if (res.status === 429) throw new SnapTradeError("RATE_LIMITED", res.status);
    throw new SnapTradeError("UNAVAILABLE", res.status);
  }

  const text = await readCappedText(res, MAX_BODY_BYTES);
  if (text === null) throw new SnapTradeError("INVALID_RESPONSE");
  if (!text.trim()) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new SnapTradeError("INVALID_RESPONSE");
  }
}

/* ------------------------------------------------------------------- calls */

/** Registers a reader with this app's SnapTrade account. Our user id is immutable, as SnapTrade asks. */
export async function registerUser(userId: string, deps?: SnapTradeDeps): Promise<SnapTradeUser> {
  const result = await snaptradeRequest<{ userId?: string; userSecret?: string }>(
    "POST",
    "/snapTrade/registerUser",
    { body: { userId } },
    deps,
  );
  if (!result.userSecret) throw new SnapTradeError("INVALID_RESPONSE");
  return { userId, userSecret: result.userSecret };
}

/**
 * The address of SnapTrade's connection page for this reader, read-only.
 *
 * `connectionType` is always "read": this app never asks for a connection
 * that could trade. The address is checked to be SnapTrade's own before it
 * is handed to a browser, so a bad response cannot send a reader elsewhere.
 *
 * With `reconnect`, the page repairs that existing connection — one the
 * broker has disabled — instead of adding a second one beside it, as
 * SnapTrade asks partners to do.
 */
export async function connectionPortalUrl(
  user: SnapTradeUser,
  returnTo: string,
  reconnect: string | null,
  deps?: SnapTradeDeps,
): Promise<string> {
  const result = await snaptradeRequest<{ redirectURI?: string }>(
    "POST",
    "/snapTrade/login",
    {
      user,
      body: {
        connectionType: "read",
        immediateRedirect: true,
        customRedirect: returnTo,
        ...(reconnect ? { reconnect } : {}),
      },
    },
    deps,
  );
  let url: URL;
  try {
    url = new URL(result.redirectURI ?? "");
  } catch {
    throw new SnapTradeError("INVALID_RESPONSE");
  }
  const snaptradeHost = url.hostname === "snaptrade.com" || url.hostname.endsWith(".snaptrade.com");
  if (url.protocol !== "https:" || !snaptradeHost) throw new SnapTradeError("INVALID_RESPONSE");
  return url.toString();
}

/** Deletes the reader at SnapTrade, and every connection and all data it holds for them. */
export async function deleteUser(userId: string, deps?: SnapTradeDeps): Promise<void> {
  await snaptradeRequest("DELETE", "/snapTrade/deleteUser", { query: { userId } }, deps);
}

export interface SnapAuthorization {
  id: string;
  /** "read" or "trade". Anything but "read" is deleted, never used. */
  type: string | null;
  disabled: boolean;
  institution: string;
}

export async function listAuthorizations(user: SnapTradeUser, deps?: SnapTradeDeps): Promise<SnapAuthorization[]> {
  const rows = await snaptradeRequest<unknown>("GET", "/authorizations", { user }, deps);
  if (!Array.isArray(rows)) throw new SnapTradeError("INVALID_RESPONSE");
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .filter((row) => typeof row.id === "string")
    .map((row) => {
      const brokerage = (row.brokerage ?? {}) as Record<string, unknown>;
      return {
        id: row.id as string,
        type: typeof row.type === "string" ? row.type : null,
        disabled: row.disabled === true,
        institution: String(brokerage.display_name ?? brokerage.name ?? row.name ?? "Broker"),
      };
    });
}

/** Removes one brokerage connection at SnapTrade. */
export async function deleteAuthorization(user: SnapTradeUser, id: string, deps?: SnapTradeDeps): Promise<void> {
  await snaptradeRequest("DELETE", `/authorizations/${encodeURIComponent(id)}`, { user }, deps);
}

export interface SnapAccount {
  id: string;
  authorizationId: string;
  institution: string;
  name: string | null;
  number: string;
}

export async function listAccounts(user: SnapTradeUser, deps?: SnapTradeDeps): Promise<SnapAccount[]> {
  const rows = await snaptradeRequest<unknown>("GET", "/accounts", { user }, deps);
  if (!Array.isArray(rows)) throw new SnapTradeError("INVALID_RESPONSE");
  return rows
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .filter((row) => typeof row.id === "string" && /^[A-Za-z0-9-]+$/.test(row.id as string))
    .map((row) => ({
      id: row.id as string,
      authorizationId: String(row.brokerage_authorization ?? ""),
      institution: String(row.institution_name ?? "Broker"),
      name: typeof row.name === "string" ? row.name : null,
      number: String(row.number ?? ""),
    }));
}

export interface SnapPosition {
  kind: string | null;
  ticker: string;
  currency: string | null;
  exchange: string | null;
  units: number | null;
  costBasis: number | null;
}

const num = (value: unknown): number | null => {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(n) ? n : null;
};

export async function accountPositions(
  user: SnapTradeUser,
  accountId: string,
  deps?: SnapTradeDeps,
): Promise<{ positions: SnapPosition[]; asOf: string | null }> {
  const result = await snaptradeRequest<{ results?: unknown; data_freshness?: { as_of?: string } }>(
    "GET",
    `/accounts/${encodeURIComponent(accountId)}/positions/all`,
    { user },
    deps,
  );
  if (!Array.isArray(result.results)) throw new SnapTradeError("INVALID_RESPONSE");
  const positions = result.results
    .filter((row): row is Record<string, unknown> => typeof row === "object" && row !== null)
    .map((row) => {
      const instrument = (row.instrument ?? {}) as Record<string, unknown>;
      return {
        kind: typeof instrument.kind === "string" ? instrument.kind : null,
        ticker: String(instrument.raw_symbol ?? instrument.symbol ?? ""),
        currency: (instrument.currency ?? row.currency ?? null) as string | null,
        exchange: typeof instrument.exchange === "string" ? instrument.exchange : null,
        units: num(row.units),
        costBasis: num(row.cost_basis),
      };
    });
  return { positions, asOf: result.data_freshness?.as_of ?? null };
}

export interface SnapActivity {
  id: string;
  type: string;
  ticker: string;
  exchange: string | null;
  currency: string | null;
  units: number | null;
  price: number | null;
  fee: number | null;
  tradeDate: string | null;
}

/** Every buy and sell on record for an account, following SnapTrade's pages. */
export async function accountActivities(
  user: SnapTradeUser,
  accountId: string,
  deps?: SnapTradeDeps,
): Promise<SnapActivity[]> {
  const all: SnapActivity[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const result = await snaptradeRequest<{ data?: unknown; pagination?: { total?: number } }>(
      "GET",
      `/accounts/${encodeURIComponent(accountId)}/activities`,
      { user, query: { offset: String(page * PAGE), limit: String(PAGE), type: "BUY,SELL,REI" } },
      deps,
    );
    if (!Array.isArray(result.data)) throw new SnapTradeError("INVALID_RESPONSE");

    for (const row of result.data) {
      if (typeof row !== "object" || row === null) continue;
      const r = row as Record<string, unknown>;
      const symbol = (r.symbol ?? {}) as Record<string, unknown>;
      const exchange = (symbol.exchange ?? {}) as Record<string, unknown>;
      const currency = ((symbol.currency ?? r.currency ?? {}) as Record<string, unknown>).code;
      all.push({
        id: String(r.id ?? ""),
        type: String(r.type ?? "").toUpperCase(),
        ticker: String(symbol.raw_symbol ?? symbol.symbol ?? ""),
        exchange: (exchange.mic_code ?? exchange.code ?? null) as string | null,
        currency: typeof currency === "string" ? currency : null,
        units: num(r.units),
        price: num(r.price),
        fee: num(r.fee),
        tradeDate: typeof r.trade_date === "string" ? r.trade_date : null,
      });
    }

    const total = result.pagination?.total;
    if (result.data.length < PAGE || (typeof total === "number" && (page + 1) * PAGE >= total)) break;
  }
  return all;
}

/* ----------------------------------------------------------------- mapping */

/** US markets by ISO market identifier code, and the older exchange codes some rows carry instead. */
const US_EXCHANGES = new Set([
  "XNAS", "XNGS", "XNMS", "XNCM", "XNYS", "ARCX", "BATS", "BATY", "EDGX", "EDGA", "XASE", "IEXG", "XCBO", "OOTC", "PINX", "OTCM",
  "NASDAQ", "NYSE", "ARCA", "NYSEARCA", "AMEX", "NYSEAMERICAN", "BATS", "IEX", "OTC", "PINK", "CBOE",
]);
const CANADIAN_EXCHANGES: Record<string, Market> = {
  XTSE: "TO", TSX: "TO", TSE: "TO",
  XTSX: "V", TSXV: "V", CVE: "V", VENTURE: "V",
};

export function snapSymbol(ticker: string, exchange: string | null, currency: string | null): MappedSymbol {
  const code = exchange?.trim().toUpperCase().replace(/\s+/g, "") ?? "";
  const market: Market | null = US_EXCHANGES.has(code) ? "US" : (CANADIAN_EXCHANGES[code] ?? null);
  if (!market || !currencyFits(market, currency)) return { ok: false, reason: OUTSIDE_COVERAGE };
  // A raw symbol sometimes still carries its suffix; the market decides that here.
  const bare = ticker.trim().toUpperCase().replace(/\.(TO|V|CN|NE)$/, "");
  return formatTicker(bare, market);
}

/** Kinds that are shares of one company or fund. Options, futures, crypto and the rest are not shown. */
const HELD_KINDS = new Set(["stock", "etf", "adr"]);

export interface SnapAccountData {
  account: SnapAccount;
  positions: SnapPosition[];
  asOf: string | null;
  activities: SnapActivity[];
}

function isoDay(value: string | null | undefined): string | null {
  const match = value?.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : null;
}

/**
 * SnapTrade's answer in the shape every broker source shares.
 *
 * Instruments are keyed by the mapped ticker rather than by SnapTrade's own
 * ids: positions and activities come from different endpoints, and the
 * ticker is what both are sure to agree on — which is what pairing fills
 * against the holding depends on.
 */
export function toBrokerReport(data: SnapAccountData[], today = new Date().toISOString().slice(0, 10)): BrokerReport {
  const skipped = skipList();
  const positions: ReportPosition[] = [];
  const executions: ReportExecution[] = [];
  const reportedQuantities: Record<string, number> = {};
  let toDate: string | null = null;

  for (const { account, positions: held, asOf, activities } of data) {
    const reportDate = isoDay(asOf) ?? today;
    if (!toDate || reportDate > toDate) toDate = reportDate;

    for (const position of held) {
      if (!position.kind || !HELD_KINDS.has(position.kind)) {
        skipped.add(position.ticker, "not a stock or fund");
        continue;
      }
      const mapped = snapSymbol(position.ticker, position.exchange, position.currency);
      if (!mapped.ok) {
        skipped.add(position.ticker, mapped.reason);
        continue;
      }
      if (position.units === null) {
        skipped.add(position.ticker, "a position the broker did not fully describe");
        continue;
      }
      const key = positionKey(account.id, mapped.symbol);
      reportedQuantities[key] = (reportedQuantities[key] ?? 0) + position.units;

      if (position.units < 0) {
        skipped.add(mapped.symbol, "a short position");
        continue;
      }
      if (position.units === 0) continue;
      if (position.costBasis === null || position.costBasis < 0) {
        skipped.add(mapped.symbol, "a position the broker did not fully describe");
        continue;
      }
      positions.push({
        accountId: account.id,
        conid: mapped.symbol,
        symbol: mapped.symbol,
        quantity: position.units,
        averageCost: position.costBasis,
        currency: position.currency!.trim().toUpperCase(),
        reportDate,
        label: account.institution,
      });
    }

    for (const activity of activities) {
      const tradeDate = isoDay(activity.tradeDate);
      if (!activity.id || !activity.ticker || !tradeDate) continue;
      const mapped = snapSymbol(activity.ticker, activity.exchange, activity.currency);
      if (!mapped.ok) {
        skipped.add(activity.ticker, mapped.reason);
        continue;
      }
      if (activity.units === null || activity.units === 0 || activity.price === null || activity.price <= 0) {
        skipped.add(mapped.symbol, "a fill the broker did not fully describe");
        continue;
      }
      // A reinvested dividend is a purchase too: leaving it out would put the
      // fills out of step with the holding, and the trade would go unrecorded.
      const size = Math.abs(activity.units);
      const quantity = activity.type === "SELL" ? -size : size;
      const time = activity.tradeDate?.match(/T(\d{2}:\d{2}:\d{2})/)?.[1] ?? "00:00:00";
      executions.push({
        accountId: account.id,
        conid: mapped.symbol,
        externalId: activity.id,
        symbol: mapped.symbol,
        quantity,
        price: activity.price,
        commission: Math.abs(activity.fee ?? 0),
        commissionCurrency: activity.currency?.toUpperCase() ?? null,
        currency: activity.currency!.toUpperCase(),
        tradeDate,
        executedAt: `${tradeDate}T${time}`,
        label: account.institution,
      });
    }
  }

  return {
    accounts: data.map((d) => d.account.id),
    toDate,
    positions,
    executions,
    skipped: skipped.list(),
    reportedQuantities,
    sections: { positions: true, trades: true },
  };
}

/** "Individual TFSA ···1234": enough to recognise an account, not enough to be its number. */
export function describeAccount(account: SnapAccount): string {
  const tail = account.number.replace(/\s/g, "").slice(-4);
  return [account.name?.trim(), tail ? `···${tail}` : null].filter(Boolean).join(" ") || "Account";
}
