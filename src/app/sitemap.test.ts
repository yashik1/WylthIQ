import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The sitemap.
 *
 * The failure mode this guards is not a wrong URL — it is a 500. A sitemap
 * that errors teaches a crawler the whole file is broken and costs the app
 * every page in it, so the database branch has to degrade to a shorter true
 * answer rather than take the route down with it.
 */

const dbState: {
  configured: boolean;
  rows: { symbol: string; updatedAt: Date }[];
  throws: Error | null;
} = { configured: false, rows: [], throws: null };

vi.mock("@/lib/db", () => ({
  isDatabaseConfigured: () => dbState.configured,
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => {
          if (dbState.throws) throw dbState.throws;
          return Promise.resolve(dbState.rows);
        },
      }),
    }),
  }),
}));

const ORIGIN = "https://stockfilter.example";

beforeEach(() => {
  process.env.AUTH_URL = ORIGIN;
  dbState.configured = false;
  dbState.rows = [];
  dbState.throws = null;
});

afterEach(() => {
  delete process.env.AUTH_URL;
  vi.resetModules();
});

async function build() {
  const { default: sitemap } = await import("./sitemap");
  return sitemap();
}

describe("what is always listed", () => {
  it("includes the public static pages, absolutely addressed", async () => {
    const urls = (await build()).map((e) => e.url);

    expect(urls).toContain(`${ORIGIN}/`);
    expect(urls).toContain(`${ORIGIN}/screen`);
    expect(urls).toContain(`${ORIGIN}/learn`);
    expect(urls).toContain(`${ORIGIN}/compare`);
  });

  it("lists every written guide", async () => {
    const urls = (await build()).map((e) => e.url);

    expect(urls).toContain(`${ORIGIN}/how-to-analyze-a-company`);
    expect(urls).toContain(`${ORIGIN}/what-is-free-cash-flow`);
    expect(urls).toContain(`${ORIGIN}/financial-health-stock-screener`);
  });

  /*
    A sitemap is an invitation, and these are not pages anybody should be
    invited to from a search result: one holds somebody's private notes,
    another their billing state, and the rest are sign-in forms that answer
    no query.
  */
  it("never offers the private routes", async () => {
    const urls = (await build()).map((e) => e.url);

    for (const path of ["/journal", "/account", "/signin", "/signup", "/reset-password"]) {
      expect(urls).not.toContain(`${ORIGIN}${path}`);
    }
  });

  it("lists the instrument catalogue, which needs no database", async () => {
    const urls = (await build()).map((e) => e.url);

    expect(urls).toContain(`${ORIGIN}/stock/BTC-USD`);
    // Futures notation carries an "=" that must survive as an escaped path
    // segment rather than being read as a query separator.
    expect(urls).toContain(`${ORIGIN}/stock/GC%3DF`);
  });
});

describe("the database branch", () => {
  it("adds a page per active company", async () => {
    dbState.configured = true;
    dbState.rows = [
      { symbol: "AAPL", updatedAt: new Date("2026-08-01T00:00:00Z") },
      { symbol: "BRK.B", updatedAt: new Date("2026-08-02T00:00:00Z") },
    ];

    const entries = await build();
    const urls = entries.map((e) => e.url);

    expect(urls).toContain(`${ORIGIN}/stock/AAPL`);
    // A share class carries a dot, which is legal in a path but must be the
    // same string the route actually serves.
    expect(urls).toContain(`${ORIGIN}/stock/BRK.B`);

    const apple = entries.find((e) => e.url.endsWith("/AAPL"));
    expect(apple?.lastModified).toEqual(new Date("2026-08-01T00:00:00Z"));
  });

  /*
    The case that matters. An unreachable database must cost the sitemap its
    company pages and nothing else — not the static routes, and not a 500.
  */
  it("still returns the rest when the database throws", async () => {
    dbState.configured = true;
    dbState.throws = new Error("ENOTFOUND postgres.railway.internal");

    const urls = (await build()).map((e) => e.url);

    expect(urls).toContain(`${ORIGIN}/`);
    expect(urls).toContain(`${ORIGIN}/stock/BTC-USD`);
    expect(urls.some((u) => u.endsWith("/AAPL"))).toBe(false);
  });

  it("skips the query entirely when no database is configured", async () => {
    dbState.configured = false;
    dbState.rows = [{ symbol: "AAPL", updatedAt: new Date() }];

    const urls = (await build()).map((e) => e.url);
    expect(urls.some((u) => u.endsWith("/AAPL"))).toBe(false);
  });
});

describe("every entry", () => {
  it("is an absolute URL on the configured origin", async () => {
    dbState.configured = true;
    dbState.rows = [{ symbol: "MSFT", updatedAt: new Date() }];

    for (const entry of await build()) {
      expect(entry.url.startsWith(`${ORIGIN}/`)).toBe(true);
      expect(() => new URL(entry.url)).not.toThrow();
    }
  });

  it("carries no duplicate URLs", async () => {
    dbState.configured = true;
    dbState.rows = [{ symbol: "MSFT", updatedAt: new Date() }];

    const urls = (await build()).map((e) => e.url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
