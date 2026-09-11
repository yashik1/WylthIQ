import { describe, expect, it } from "vitest";
import { searchTopics } from "./topics";

describe("searching for a topic", () => {
  it("finds the guide first for a phrase it covers", () => {
    const [first, second] = searchTopics("free cash flow");
    expect(first).toMatchObject({ kind: "Guide", href: "/what-is-free-cash-flow" });
    expect(second).toMatchObject({ kind: "Learn", href: "/learn#free-cash-flow" });
  });

  it("understands the names people actually type", () => {
    expect(searchTopics("f-score")[0].href).toBe("/what-is-piotroski-f-score");
    expect(searchTopics("P/E")[0].href).toBe("/what-is-price-to-earnings");
    expect(searchTopics("balance sheet")[0].href).toBe("/how-to-read-a-balance-sheet");
    expect(searchTopics("altman")[0].href).toBe("/what-is-altman-z-score");
  });

  it("matches two-letter queries only exactly, so tickers do not pull in topics", () => {
    expect(searchTopics("pe").map((t) => t.href)).toContain("/learn#pe");
    expect(searchTopics("ms")).toEqual([]);
    expect(searchTopics("ko")).toEqual([]);
  });

  it("finds nothing for a ticker or a single character", () => {
    expect(searchTopics("AAPL")).toEqual([]);
    expect(searchTopics("a")).toEqual([]);
  });

  it("returns at most the number asked for", () => {
    expect(searchTopics("margin", 2)).toHaveLength(2);
  });
});
