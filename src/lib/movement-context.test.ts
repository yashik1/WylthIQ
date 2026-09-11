import { describe, expect, it } from "vitest";
import { buildMovementContext, describeRelativeMove } from "./movement-context";
import type { Filing, NewsItem } from "./providers/types";

/**
 * A move in context. What matters most here is what the text never does:
 * say why the price moved.
 */

const NOW = new Date("2026-09-10T15:00:00Z");

const filing = (over: Partial<Filing>): Filing => ({
  form: "8-K",
  filedAt: "2026-09-09",
  periodOfReport: null,
  description: null,
  url: "https://www.sec.gov/doc",
  items: "2.02",
  ...over,
});

const news = (over: Partial<NewsItem>): NewsItem => ({
  id: "1",
  headline: "Company holds annual event",
  summary: null,
  source: "Newswire",
  url: "https://news.example/1",
  publishedAt: "2026-09-10T12:00:00Z",
  imageUrl: null,
  ...over,
});

describe("describing a move", () => {
  it("sets the move beside its sector and the market in numbers", () => {
    expect(
      describeRelativeMove(
        "AAPL",
        -0.028,
        { label: "Technology", change: -0.011, companies: 42 },
        { label: "S&P 500", change: -0.006 },
      ),
    ).toBe(
      "AAPL fell 2.80% on the latest quote. The average Technology company tracked here moved −1.10%, and the S&P 500 −0.60%. That is 1.7 points below its sector and 2.2 points below the market.",
    );
  });

  it("calls a move within half a point in line", () => {
    expect(describeRelativeMove("MSFT", 0.004, null, { label: "S&P 500", change: 0.002 })).toBe(
      "MSFT rose 0.40% on the latest quote. The S&P 500 moved +0.20%. That is in line with the market.",
    );
  });

  it("describes the move alone when there is nothing to compare it with", () => {
    expect(describeRelativeMove("XYZ", 0, null, null)).toBe("XYZ was unchanged on the latest quote.");
  });

  it("never gives a reason for the move", () => {
    const text = describeRelativeMove(
      "AAPL",
      -0.09,
      { label: "Technology", change: 0.01, companies: 40 },
      { label: "S&P 500", change: 0.012 },
    );
    expect(text).not.toMatch(/\b(because|due to|caused|driven|after|on news|reaction|sell-off|investors)\b/i);
  });
});

describe("the evidence around a move", () => {
  const context = buildMovementContext({
    symbol: "AAPL",
    stockChange: -0.028,
    sector: null,
    market: null,
    filings: [
      filing({ filedAt: "2026-09-09", items: "2.02" }),
      filing({ filedAt: "2026-09-08", form: "4", items: null, url: "https://www.sec.gov/form4" }),
      filing({ filedAt: "2026-08-01", items: "5.02" }),
    ],
    news: [
      news({ id: "a", publishedAt: "2026-09-10T12:00:00Z" }),
      news({ id: "b", publishedAt: "2026-09-01T12:00:00Z", headline: "Old story" }),
    ],
    now: NOW,
  })!;

  it("lists only what was published in the window, newest first", () => {
    expect(context.evidence.map((e) => e.date)).toEqual([
      "2026-09-10T12:00:00Z",
      "2026-09-09",
      "2026-09-08",
    ]);
    expect(context.evidence.map((e) => e.title)).not.toContain("Old story");
  });

  it("labels an earnings filing from its item code, and links every item", () => {
    const earnings = context.evidence.find((e) => e.kind === "earnings")!;
    expect(earnings).toMatchObject({ label: "Earnings", source: "Form 8-K" });
    for (const item of context.evidence) expect(item.url).toMatch(/^https:\/\//);
  });

  it("says plainly when nothing was published", () => {
    const quiet = buildMovementContext({ symbol: "AAPL", stockChange: 0.01, sector: null, market: null, filings: [], news: [], now: NOW })!;
    expect(quiet.evidence).toEqual([]);
    expect(quiet.quietNote).toBe("No filing from AAPL and no news item about it appeared in the last 3 days.");
  });

  it("has nothing to say without a price change", () => {
    expect(buildMovementContext({ symbol: "AAPL", stockChange: null, sector: null, market: null, filings: [], news: [], now: NOW })).toBeNull();
  });
});
