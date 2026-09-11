import { describe, expect, it } from "vitest";
import { describeAgainstPeers, median, type PeerFigures } from "./peer-context";

const company = (symbol: string, over: Partial<PeerFigures> = {}): PeerFigures => ({
  symbol,
  healthScore: 7,
  revenueGrowth: 0.05,
  operatingMargin: 0.2,
  netMargin: 0.15,
  peRatio: 20,
  debtToEquity: 1,
  ...over,
});

describe("median", () => {
  it("takes the middle value, averaging the middle two, and ignores missing ones", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([null, 5, undefined])).toBe(5);
    expect(median([])).toBeNull();
  });
});

describe("describing a company against its peers", () => {
  const peers = [
    company("MSFT", { operatingMargin: 0.18, peRatio: 25 }),
    company("GOOGL", { operatingMargin: 0.16, peRatio: 22 }),
    company("META", { operatingMargin: 0.2, peRatio: 24 }),
  ];

  it("says the margin is higher and the P/E higher than the peer median, with both figures", () => {
    const sentences = describeAgainstPeers(company("AAPL", { operatingMargin: 0.3, peRatio: 33 }), peers);
    expect(sentences[0]).toBe(
      "AAPL's operating margin of 30.0% is higher than the median of the other companies selected (18.0%).",
    );
    expect(sentences).toContain(
      "It trades at a higher P/E than the median of the other companies selected: 33.0x against 24.0x.",
    );
  });

  it("calls small differences in line rather than higher or lower", () => {
    const sentences = describeAgainstPeers(company("AAPL", { operatingMargin: 0.185, peRatio: 25 }), peers);
    expect(sentences[0]).toMatch(/is in line with/);
    expect(sentences.find((s) => s.includes("P/E"))).toMatch(/in line with/);
  });

  it("falls back to profit margin when peers have no operating margin", () => {
    const sentences = describeAgainstPeers(company("AAPL"), [company("X", { operatingMargin: null, netMargin: 0.05 })]);
    expect(sentences[0]).toMatch(/^AAPL's profit margin of 15\.0% is higher than the other company selected \(5\.0%\)\.$/);
  });

  it("says why there is no P/E for a loss-making company", () => {
    const sentences = describeAgainstPeers(company("LOSS", { peRatio: null, netMargin: -0.1 }), peers);
    expect(sentences).toContain("It has no P/E to set against theirs, because it did not make a profit.");
  });

  it("says nothing without other companies, and never ranks or advises", () => {
    expect(describeAgainstPeers(company("AAPL"), [])).toEqual([]);
    expect(describeAgainstPeers(company("AAPL"), [company("AAPL")])).toEqual([]);

    const sentences = describeAgainstPeers(company("AAPL", { operatingMargin: 0.5, peRatio: 60, debtToEquity: 3, revenueGrowth: 0.4 }), peers);
    for (const sentence of sentences) {
      expect(sentence).not.toMatch(/\b(buy|sell|better|worse|best|worst|should|undervalued|overvalued|cheap)\b/i);
    }
  });
});
