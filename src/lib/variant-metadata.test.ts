import { describe, expect, it } from "vitest";
import { backtestText, compareText, screenBacktestText, screenText, withVariant } from "./variant-metadata";

const rendered = (title: string) => `${title} · WylthIQ`.length;

describe("a comparison's own title", () => {
  it("names what is compared, within a result list's width", () => {
    const text = compareText(["AAPL", "MSFT", "GOOGL", "NVDA"])!;
    expect(text.title).toBe("AAPL vs MSFT vs GOOGL vs NVDA — side by side");
    expect(rendered(text.title)).toBeLessThanOrEqual(60);
    expect(text.description).toContain("AAPL, MSFT, GOOGL and NVDA compared");
    expect(text.description.length).toBeLessThanOrEqual(160);
  });

  it("shortens a long list, and leaves a single symbol to the page's own title", () => {
    const long = compareText(["BRK.B", "JPM", "BAC", "WFC", "C", "GS", "MS", "SCHW"])!;
    expect(rendered(long.title)).toBeLessThanOrEqual(60);
    expect(compareText(["AAPL"])).toBeNull();
    expect(compareText([])).toBeNull();
  });
});

describe("a backtest's own title", () => {
  it("asks the question the run answers", () => {
    const text = backtestText({ symbol: "aapl", start: "2015-01-01", amount: 10_000 })!;
    expect(text.title).toBe("What if you had invested $10,000 in AAPL in 2015?");
    expect(rendered(text.title)).toBeLessThanOrEqual(60);
    expect(text.description).toContain("on January 1, 2015");
    expect(text.description.length).toBeLessThanOrEqual(160);
  });

  it("uses an instrument's name, and needs a symbol and a real date", () => {
    expect(backtestText({ symbol: "BTC-USD", start: "2017-01-01", amount: 5_000, name: "Bitcoin" })!.description).toContain(
      "Bitcoin (BTC-USD)",
    );
    expect(backtestText({ symbol: "", start: "2015-01-01", amount: 10_000 })).toBeNull();
    expect(backtestText({ symbol: "AAPL", start: "soon", amount: 10_000 })).toBeNull();
  });
});

describe("a screen's own title", () => {
  it("names the preset, the sort and the page", () => {
    const text = screenText({ preset: "healthy", sort: "market-cap" }, 3)!;
    expect(text.title).toContain("Financial health");
    expect(text.title).toContain("page 3");
    expect(rendered(text.title)).toBeLessThanOrEqual(60);
    expect(text.description.length).toBeLessThanOrEqual(160);
  });

  it("names a sector screen, and leaves the plain screener alone", () => {
    expect(screenText({ sector: "Real Estate" })!.title).toContain("Real Estate");
    expect(screenText({ sort: "health" }, 1)).toBeNull();
    expect(screenText({}, 1)).toBeNull();
  });

  it("titles a screener backtest by its start and size", () => {
    const text = screenBacktestText({ start: "2020-01-01", topN: 10 })!;
    expect(text.title).toBe("How the screener's top 10 did since 2020");
    expect(screenBacktestText({ start: "", topN: 10 })).toBeNull();
  });
});

describe("merging into a page's metadata", () => {
  it("keeps the canonical and restates the site in the share preview", () => {
    const base = { title: "Compare", alternates: { canonical: "/compare" } };
    const merged = withVariant(base, { title: "A vs B", description: "A and B." });
    expect(merged.alternates).toEqual({ canonical: "/compare" });
    expect(merged.title).toBe("A vs B");
    expect(merged.openGraph).toMatchObject({ siteName: "WylthIQ", title: "A vs B" });
    expect(withVariant(base, null)).toBe(base);
  });
});
