import { parseExchangeSuffix } from "../exchange-suffix";
import { classify } from "../instruments";
import type { PriceSource } from "./failover";
import type { Bar, Quote, Timeframe } from "./types";

const BASE = "https://data.alpaca.markets/v2/stocks/bars";

/**
 * The consolidated feed: every US exchange, not only IEX.
 *
 * A daily bar built from IEX trades alone is a small slice of the day's volume
 * and can print a different high or low from the one a reader sees anywhere
 * else. Alpaca's free plan serves the consolidated feed too, except for the
 * most recent fifteen minutes — which a chart of history never needs.
 */
const FEED = "sip";

/** The free plan withholds the latest 15 minutes of consolidated data; a minute of margin. */
const SIP_DELAY_MS = 16 * 60 * 1000;

/** Alpaca's largest page. */
const PAGE_LIMIT = 10_000;

/**
 * Pages to follow before stopping.
 *
 * The bars route caps every window, so the largest request — a week of minute
 * bars, extended hours included — fits in one page. The bound exists so a
 * provider that keeps handing back tokens cannot hold a chart open forever.
 */
const MAX_PAGES = 5;

interface AlpacaBar {
  t: string;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

/**
 * Alpaca — chart history with room to breathe.
 *
 * Twelve Data's free plan allows 8 requests a minute and Tiingo's 50 an hour,
 * so a reader clicking through a handful of charts used the whole chain up and
 * met an error. Alpaca's free market data allows 200 a minute, with split-
 * adjusted daily and intraday bars for US listings back to 2016. It needs a
 * free account (paper trading is enough, no money) and two keys.
 *
 * Bars only. It is never asked for a quote: the quote chain already works, and
 * a provider that answers there would change which price every page shows.
 *
 * US listings only. A suffixed ticker (RY.TO), an index (^GSPC), a coin or a
 * contract is left to the providers that cover it, without spending a request.
 */
export class AlpacaProvider implements PriceSource {
  readonly name = "Alpaca";

  /**
   * Bars are requested with `adjustment=split`: continuous across splits,
   * dividends not reinvested — the same basis as Twelve Data and Yahoo. If that
   * parameter ever changes to `all`, this has to flip with it.
   */
  readonly barsIncludeDividends = false;

  private get keyId() {
    return process.env.ALPACA_API_KEY_ID;
  }

  private get secret() {
    return process.env.ALPACA_API_SECRET_KEY;
  }

  isConfigured(): boolean {
    return Boolean(this.keyId && this.secret);
  }

  /** Whether this is a US listing Alpaca can chart. */
  covers(symbol: string): boolean {
    const upper = symbol.trim().toUpperCase();
    if (!upper || upper.startsWith("^")) return false;
    if (parseExchangeSuffix(upper)) return false;
    if (classify(upper) !== null) return false;
    // Share classes keep their dot, as Alpaca writes them: BRK.B, BF.B.
    return /^[A-Z][A-Z0-9]{0,5}(\.[A-Z])?$/.test(upper);
  }

  async getBars(symbol: string, timeframe: Timeframe, from: Date, to: Date): Promise<Bar[]> {
    const upper = symbol.trim().toUpperCase();
    if (!this.isConfigured() || !this.covers(upper)) return [];

    const end = new Date(Math.min(to.getTime(), Date.now() - SIP_DELAY_MS));
    if (end.getTime() <= from.getTime()) return [];

    const bars: Bar[] = [];
    let pageToken: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const params = new URLSearchParams({
        symbols: upper,
        // The app's timeframe names are Alpaca's own: 1Min, 5Min, 15Min, 1Hour, 1Day, 1Week.
        timeframe,
        start: from.toISOString(),
        end: end.toISOString(),
        limit: String(PAGE_LIMIT),
        adjustment: "split",
        feed: FEED,
        sort: "asc",
      });
      if (pageToken) params.set("page_token", pageToken);

      const res = await fetch(`${BASE}?${params}`, {
        headers: {
          "APCA-API-KEY-ID": this.keyId!,
          "APCA-API-SECRET-KEY": this.secret!,
        },
        next: { revalidate: revalidateFor(timeframe) },
      });

      if (!res.ok) {
        if (res.status === 429) throw new Error("Alpaca rate limit reached.");
        if (res.status === 401 || res.status === 403) {
          // Names the settings, never their values.
          throw new Error(
            `Alpaca refused the request (HTTP ${res.status}); check ALPACA_API_KEY_ID and ALPACA_API_SECRET_KEY.`,
          );
        }
        // An unknown or malformed symbol is a statement about Alpaca's
        // coverage, so the chain moves on rather than reporting a failure.
        if (res.status === 400 || res.status === 404 || res.status === 422) return [];
        throw new Error(`Alpaca bars ${upper}: HTTP ${res.status}`);
      }

      const json = (await res.json()) as {
        bars?: Record<string, AlpacaBar[] | undefined> | null;
        next_page_token?: string | null;
      };

      for (const b of json.bars?.[upper] ?? []) {
        const bar = {
          time: Math.floor(Date.parse(b.t) / 1000),
          open: b.o,
          high: b.h,
          low: b.l,
          close: b.c,
          volume: b.v ?? 0,
        };
        if (Number.isFinite(bar.time) && Number.isFinite(bar.open) && Number.isFinite(bar.close)) {
          bars.push(bar);
        }
      }

      pageToken = json.next_page_token ?? null;
      if (!pageToken) break;
    }

    return bars;
  }

  /** Not a quote source — see the class comment. */
  async getQuote(): Promise<Quote | null> {
    return null;
  }
}

function revalidateFor(timeframe: Timeframe): number {
  if (timeframe === "1Min") return 60;
  if (timeframe === "1Day" || timeframe === "1Week") return 3600;
  return 300;
}

export const alpaca = new AlpacaProvider();
