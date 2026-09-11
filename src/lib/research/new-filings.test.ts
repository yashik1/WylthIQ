import { describe, expect, it } from "vitest";
import { orderNewFilings, recentFilings } from "./new-filings";
import type { Filing } from "../providers/types";

const NOW = Date.parse("2026-09-10T12:00:00Z");

const filing = (over: Partial<Filing>): Filing => ({
  form: "8-K",
  filedAt: "2026-09-08",
  periodOfReport: null,
  description: null,
  url: "https://sec.gov/doc",
  items: "2.02",
  ...over,
});

const apple = { symbol: "AAPL", name: "Apple Inc." };

describe("recent filings", () => {
  it("keeps only filings inside the window", () => {
    const items = recentFilings(
      apple,
      [filing({ filedAt: "2026-09-08" }), filing({ filedAt: "2026-08-01" })],
      14,
      NOW,
    );
    expect(items.map((i) => i.filedAt)).toEqual(["2026-09-08"]);
  });

  it("classifies each one with the timeline's own rules, and keeps its link", () => {
    const [item] = recentFilings(apple, [filing({ items: "5.02" })], 14, NOW);
    expect(item).toMatchObject({ symbol: "AAPL", category: "executive-change", url: "https://sec.gov/doc" });
  });

  it("ignores a date it cannot read", () => {
    expect(recentFilings(apple, [filing({ filedAt: "soon" })], 14, NOW)).toEqual([]);
  });
});

describe("ordering", () => {
  it("puts the strongest filings first, then the newest", () => {
    const items = [
      ...recentFilings(apple, [filing({ filedAt: "2026-09-09", items: "2.02" })], 14, NOW),
      ...recentFilings(apple, [filing({ filedAt: "2026-09-01", items: "4.02" })], 14, NOW),
      ...recentFilings(apple, [filing({ filedAt: "2026-09-05", items: "5.02" })], 14, NOW),
    ];
    expect(orderNewFilings(items).map((i) => i.severity)).toEqual(["red-flag", "notable", "routine"]);
  });
});
