import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AlpacaProvider } from "./alpaca";
import { classifyProviderError } from "./errors";

/**
 * Alpaca, the chart source with the most headroom.
 *
 * Pinned here: it asks for the bars the rest of the chain would give — split
 * adjusted, every exchange, never the withheld last fifteen minutes — follows
 * pages, reports a rate limit as one, and spends no request on a listing it
 * cannot chart.
 */

const json = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

const from = new Date("2026-01-02T00:00:00Z");
const to = new Date("2026-01-10T00:00:00Z");

const BAR = { t: "2026-01-05T05:00:00Z", o: 1, h: 2, l: 0.5, c: 1.5, v: 10 };

beforeEach(() => {
  vi.stubEnv("ALPACA_API_KEY_ID", "key-id");
  vi.stubEnv("ALPACA_API_SECRET_KEY", "key-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("Alpaca bars", () => {
  it("asks for split-adjusted consolidated bars and maps them", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: RequestInit) => {
        calls.push({ url: String(url), headers: init.headers as Record<string, string> });
        return json({ bars: { AAPL: [BAR] }, next_page_token: null });
      }),
    );

    const bars = await new AlpacaProvider().getBars("aapl", "1Day", from, to);

    expect(bars).toEqual([
      { time: Date.parse(BAR.t) / 1000, open: 1, high: 2, low: 0.5, close: 1.5, volume: 10 },
    ]);
    const params = new URL(calls[0].url).searchParams;
    expect(params.get("symbols")).toBe("AAPL");
    expect(params.get("timeframe")).toBe("1Day");
    expect(params.get("adjustment")).toBe("split");
    expect(params.get("feed")).toBe("sip");
    expect(calls[0].headers["APCA-API-KEY-ID"]).toBe("key-id");
  });

  it("never asks for the fifteen minutes the free plan withholds", async () => {
    let end = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        end = new URL(String(url)).searchParams.get("end") ?? "";
        return json({ bars: { AAPL: [BAR] }, next_page_token: null });
      }),
    );

    await new AlpacaProvider().getBars("AAPL", "5Min", new Date(Date.now() - 86_400_000), new Date());

    expect(Date.parse(end)).toBeLessThanOrEqual(Date.now() - 15 * 60 * 1000);
  });

  it("follows pages until there are none left", async () => {
    const tokens: (string | null)[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const token = new URL(String(url)).searchParams.get("page_token");
        tokens.push(token);
        return token
          ? json({ bars: { AAPL: [{ ...BAR, t: "2026-01-06T05:00:00Z" }] }, next_page_token: null })
          : json({ bars: { AAPL: [BAR] }, next_page_token: "page-2" });
      }),
    );

    const bars = await new AlpacaProvider().getBars("AAPL", "1Day", from, to);

    expect(tokens).toEqual([null, "page-2"]);
    expect(bars).toHaveLength(2);
  });

  it("reports a rate limit as one, so the chain says so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 429)));

    const error = await new AlpacaProvider().getBars("AAPL", "1Day", from, to).catch((e) => e);

    expect(classifyProviderError(error)).toBe("RATE_LIMITED");
  });

  it("names the settings when the keys are refused, and never their values", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 403)));

    const error = (await new AlpacaProvider().getBars("AAPL", "1Day", from, to).catch((e) => e)) as Error;

    expect(error.message).toContain("ALPACA_API_KEY_ID");
    expect(error.message).not.toContain("key-id");
    expect(error.message).not.toContain("key-secret");
  });

  it("hands a symbol it does not know to the next provider", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({ message: "invalid symbol" }, 422)));
    expect(await new AlpacaProvider().getBars("ZZZZZ", "1Day", from, to)).toEqual([]);
  });
});

describe("what Alpaca is asked about at all", () => {
  it("charts US listings, share classes included", () => {
    const alpaca = new AlpacaProvider();
    expect(alpaca.covers("AAPL")).toBe(true);
    expect(alpaca.covers("BRK.B")).toBe(true);
  });

  it("spends no request on a Toronto listing, an index or a coin", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const alpaca = new AlpacaProvider();

    for (const symbol of ["RY.TO", "^GSPC", "BTC-USD"]) {
      expect(alpaca.covers(symbol)).toBe(false);
      expect(await alpaca.getBars(symbol, "1Day", from, to)).toEqual([]);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("stays out of the way without both keys", async () => {
    vi.stubEnv("ALPACA_API_SECRET_KEY", "");
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const alpaca = new AlpacaProvider();
    expect(alpaca.isConfigured()).toBe(false);
    expect(await alpaca.getBars("AAPL", "1Day", from, to)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is never a quote source", async () => {
    expect(await new AlpacaProvider().getQuote()).toBeNull();
  });
});
