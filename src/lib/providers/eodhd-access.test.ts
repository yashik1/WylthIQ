import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EodhdAccess, PLAN_REFUSAL_MS, closureFor, nextUtcMidnight } from "./eodhd-access";

const NOON = Date.parse("2026-11-06T12:00:00Z");

describe("what an EODHD refusal means for the next request", () => {
  it("shuts out one endpoint the plan does not include, for twelve hours", () => {
    const access = new EodhdAccess();
    expect(access.refuse("/fundamentals", 403, NOON)?.reason).toContain("does not include fundamentals");
    expect(access.isOpen("/fundamentals", NOON + 1)).toBe(false);
    expect(access.isOpen("/real-time", NOON + 1)).toBe(true);
    expect(access.isOpen("/fundamentals", NOON + PLAN_REFUSAL_MS)).toBe(true);
  });

  it("shuts out everything for the rest of the day once the daily limit is used", () => {
    const access = new EodhdAccess();
    access.refuse("/real-time", 402, NOON);
    for (const endpoint of ["/real-time", "/fundamentals", "/eod", "/search"] as const) {
      expect(access.isOpen(endpoint, NOON + 60_000)).toBe(false);
    }
    expect(access.isOpen("/real-time", Date.parse("2026-11-06T23:59:59Z"))).toBe(false);
    expect(access.isOpen("/real-time", Date.parse("2026-11-07T00:00:00Z"))).toBe(true);
  });

  it("pauses for a minute on a rate limit, and for an hour on a rejected key", () => {
    const access = new EodhdAccess();
    access.refuse("/eod", 429, NOON);
    expect(access.isOpen("/news", NOON + 59_000)).toBe(false);
    expect(access.isOpen("/news", NOON + 60_000)).toBe(true);
    expect(closureFor("/eod", 401, NOON)).toMatchObject({ scope: "all", until: NOON + 3_600_000 });
  });

  it("never shuts anything for a refusal about the symbol", () => {
    const access = new EodhdAccess();
    expect(access.refuse("/fundamentals", 404, NOON)).toBeNull();
    expect(access.refuse("/real-time", 422, NOON)).toBeNull();
    expect(access.refuse("/real-time", 500, NOON)).toBeNull();
    expect(access.isOpen("/fundamentals", NOON)).toBe(true);
    expect(access.isOpen("/real-time", NOON)).toBe(true);
  });

  it("reports a closure once, not again while it holds", () => {
    const access = new EodhdAccess();
    expect(access.refuse("/fundamentals", 403, NOON)).not.toBeNull();
    expect(access.refuse("/fundamentals", 403, NOON + 1)).toBeNull();
    expect(access.isOpen("/fundamentals", NOON + PLAN_REFUSAL_MS)).toBe(true);
  });

  it("lets the daily limit replace a minute's rate limit", () => {
    const access = new EodhdAccess();
    access.refuse("/real-time", 429, NOON);
    expect(access.refuse("/real-time", 402, NOON + 1)).not.toBeNull();
    expect(access.isOpen("/real-time", NOON + 120_000)).toBe(false);
  });

  it("knows when midnight UTC is", () => {
    expect(new Date(nextUtcMidnight(NOON)).toISOString()).toBe("2026-11-07T00:00:00.000Z");
    expect(new Date(nextUtcMidnight(Date.parse("2026-12-31T23:30:00Z"))).toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });
});

describe("the EODHD provider behind that", () => {
  const fetchMock = vi.fn();
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

  beforeEach(() => {
    vi.resetModules();
    fetchMock.mockReset();
    warn.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("EODHD_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const reply = (status: number, body: unknown = {}) =>
    Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  const asked = (endpoint: string) => fetchMock.mock.calls.filter(([url]) => String(url).includes(endpoint)).length;

  it("stops asking for fundamentals the plan refuses, and keeps asking for prices", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("/fundamentals/") ? reply(403) : reply(200, { close: 101.5, timestamp: 1_762_430_400 }),
    );
    const { eodhd } = await import("./eodhd");

    expect(await eodhd.getProfile("AAPL")).toBeNull();
    expect(await eodhd.getProfile("MSFT")).toBeNull();
    expect(await eodhd.getAnalystView("NVDA")).toBeNull();
    expect(asked("/fundamentals/")).toBe(1);

    expect((await eodhd.getQuote("AAPL"))?.price).toBe(101.5);
    expect((await eodhd.getQuote("MSFT"))?.price).toBe(101.5);
    expect(asked("/real-time/")).toBe(2);

    // Said once, with what it means, and never with the key in it.
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("/fundamentals refused with HTTP 403");
    expect(String(warn.mock.calls[0][0])).not.toContain("test-key");
  });

  it("goes quiet for the day once the daily limit is used up", async () => {
    fetchMock.mockImplementation(() => reply(402));
    const { eodhd } = await import("./eodhd");

    expect(await eodhd.getQuote("RGBD")).toBeNull();
    expect(await eodhd.getQuote("MCIM")).toBeNull();
    expect(await eodhd.getBars("AAPL", "1Day", new Date("2026-01-01"), new Date("2026-02-01"))).toEqual([]);
    expect(await eodhd.searchSymbols("apple")).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("daily request limit");
  });

  it("keeps asking about other symbols after one it does not cover", async () => {
    fetchMock.mockImplementation((url: string) =>
      url.includes("/real-time/RB=F") ? reply(422) : reply(200, { close: 5 }),
    );
    const { eodhd } = await import("./eodhd");

    expect(await eodhd.getQuote("RB=F")).toBeNull();
    expect((await eodhd.getQuote("AAPL"))?.price).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
