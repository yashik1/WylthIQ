import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Finding a company the SEC's ticker file has lost, and downloading a filer's
 * submissions once rather than once per panel on a page.
 */

const universe = new Map<string, { cik: string | null; name: string }>([
  ["AVB", { cik: "0000915912", name: "AvalonBay Communities, Inc." }],
  ["NOCIK", { cik: null, name: "No CIK Recorded Inc." }],
]);

vi.mock("../db", () => ({
  isDatabaseConfigured: () => true,
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: (cond: { symbol?: string }) => ({
          limit: async () => {
            const row = universe.get(cond.symbol ?? "");
            return row ? [row] : [];
          },
        }),
      }),
    }),
  }),
}));
// The lookup's WHERE clause, reduced to the symbol it asks for.
vi.mock("drizzle-orm", async (original) => ({
  ...(await original<typeof import("drizzle-orm")>()),
  eq: (_column: unknown, value: string) => ({ symbol: value }),
}));

const fetchMock = vi.fn();

beforeEach(() => {
  vi.resetModules();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

const json = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));

describe("finding a company's CIK", () => {
  it("falls back to the site's own company list when the SEC ticker file has lost it", async () => {
    fetchMock.mockImplementation(() => json({ 0: { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }));
    const { cikForSymbol } = await import("./sec-edgar");
    expect(await cikForSymbol("AAPL")).toBe("0000320193");
    expect(await cikForSymbol("AVB")).toBe("0000915912");
    expect(await cikForSymbol("NOCIK")).toBeNull();
    expect(await cikForSymbol("ZZZZ")).toBeNull();
  });
});

describe("a filer's submissions", () => {
  it("are downloaded once for every panel that asks, and remembered", async () => {
    fetchMock.mockImplementation(() => json({ cik: "320193", name: "Apple Inc.", filings: { recent: {} } }));
    const { fetchSubmissions } = await import("./sec-edgar");
    const [a, b] = await Promise.all([fetchSubmissions("0000320193"), fetchSubmissions("0000320193")]);
    expect(a?.name).toBe("Apple Inc.");
    expect(b).toBe(a);
    await fetchSubmissions("0000320193");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    // Never through Next's data cache, which refuses files this size.
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: "no-store" });
  });

  it("does not remember a refusal, so a busy moment is not cached for hours", async () => {
    fetchMock.mockImplementationOnce(() => json({}, 429)).mockImplementation(() => json({ name: "Apple Inc." }));
    const { fetchSubmissions } = await import("./sec-edgar");
    expect(await fetchSubmissions("0000320193")).toBeNull();
    expect((await fetchSubmissions("0000320193"))?.name).toBe("Apple Inc.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
