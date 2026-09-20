import { describe, expect, it } from "vitest";
import { mergeHeadlines, pickNewsSymbols } from "./market-news";
import type { NewsItem } from "./providers/types";

/**
 * Choosing what a dashboard news column is about.
 *
 * Nothing in the free stack serves market-wide news — every source answers per
 * company — so the column has to pick its subjects. The rules here are what
 * keeps it a market column rather than five stories about whichever company
 * had a loud week.
 */

const item = (over: Partial<NewsItem> & { id: string }): NewsItem => ({
  headline: `Headline ${over.id}`,
  summary: null,
  source: "Reuters",
  url: `https://example.com/${over.id}`,
  publishedAt: "2026-09-19T12:00:00Z",
  imageUrl: null,
  ...over,
});

describe("which companies the column is about", () => {
  it("puts a reader's own watchlist first", () => {
    const picked = pickNewsSymbols({
      watchlist: ["ATZ", "RY"],
      gainers: ["NVDA"],
      losers: ["F"],
    });
    expect(picked.slice(0, 2)).toEqual(["ATZ", "RY"]);
  });

  /*
    A riser, then a faller, then the next of each. Taking all the risers first
    meant a green day filled the column with five good-news stories and a red
    day with five bad ones.
  */
  it("alternates risers and fallers", () => {
    expect(pickNewsSymbols({ gainers: ["A", "B", "C"], losers: ["X", "Y"] })).toEqual([
      "A", "X", "B", "Y", "C",
    ]);
  });

  it("falls back to the healthiest when nothing moved", () => {
    expect(pickNewsSymbols({ healthiest: ["AAPL", "MSFT"] })).toEqual(["AAPL", "MSFT"]);
  });

  it("asks about each company once, and about five at most", () => {
    const picked = pickNewsSymbols({
      watchlist: ["aapl"],
      gainers: ["AAPL", "B", "C", "D", "E", "F", "G"],
    });
    expect(picked).toEqual(["AAPL", "B", "C", "D", "E"]);
  });

  it("has nothing to ask about on a deployment with no companies", () => {
    expect(pickNewsSymbols({})).toEqual([]);
  });
});

describe("assembling the column", () => {
  const now = new Date("2026-09-20T12:00:00Z");

  it("puts the newest first, whichever company it is about", () => {
    const merged = mergeHeadlines(
      [
        { symbol: "AAPL", news: [item({ id: "old", publishedAt: "2026-09-10T12:00:00Z" })] },
        { symbol: "NVDA", news: [item({ id: "new", publishedAt: "2026-09-20T09:00:00Z" })] },
      ],
      8,
      now,
    );
    expect(merged.map((m) => m.id)).toEqual(["new", "old"]);
    expect(merged[0].symbol).toBe("NVDA");
  });

  /*
    One wire story is syndicated under every company it mentions, so the same
    piece arrives from two lookups. Printed twice it reads as a broken page.
  */
  it("prints a syndicated story once", () => {
    const shared = item({ id: "wire", url: "https://example.com/wire" });
    const merged = mergeHeadlines(
      [
        { symbol: "AAPL", news: [shared] },
        { symbol: "MSFT", news: [{ ...shared, id: "wire-copy" }] },
      ],
      8,
      now,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].symbol).toBe("AAPL");
  });

  it("lets no single company take more than two slots", () => {
    const merged = mergeHeadlines(
      [{ symbol: "NVDA", news: ["a", "b", "c", "d"].map((id) => item({ id })) }],
      8,
      now,
    );
    expect(merged).toHaveLength(2);
  });

  it("leaves out anything older than a month", () => {
    const merged = mergeHeadlines(
      [{ symbol: "KO", news: [item({ id: "ancient", publishedAt: "2026-06-01T12:00:00Z" })] }],
      8,
      now,
    );
    expect(merged).toEqual([]);
  });

  // A date the provider mangled, and one from next week. Neither is news.
  it("ignores a timestamp it cannot believe", () => {
    const merged = mergeHeadlines(
      [
        { symbol: "KO", news: [item({ id: "broken", publishedAt: "not a date" })] },
        { symbol: "F", news: [item({ id: "future", publishedAt: "2026-10-01T12:00:00Z" })] },
      ],
      8,
      now,
    );
    expect(merged).toEqual([]);
  });

  it("stops at the limit", () => {
    const merged = mergeHeadlines(
      [
        { symbol: "A", news: [item({ id: "a1" }), item({ id: "a2" })] },
        { symbol: "B", news: [item({ id: "b1" }), item({ id: "b2" })] },
      ],
      3,
      now,
    );
    expect(merged).toHaveLength(3);
  });
});
