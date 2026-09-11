import { describe, expect, it } from "vitest";
import { buildIntelligence, type HoldingProfile } from "./intelligence";

const profile = (symbol: string, over: Partial<HoldingProfile>): HoldingProfile => ({
  symbol,
  weight: 100,
  covered: true,
  sectorKind: "other",
  displaySector: "Technology",
  healthScore: 8,
  peRatio: 20,
  debtToEquity: 0.5,
  currentRatio: 1.5,
  freeCashFlow: 1000,
  mFlagged: false,
  mApplicable: true,
  zZone: "safe",
  zApplicable: true,
  thesisStatus: null,
  ...over,
});

describe("portfolio intelligence", () => {
  const intelligence = buildIntelligence([
    profile("AAPL", { weight: 600, healthScore: 9, peRatio: 35 }),
    profile("XOM", { weight: 300, healthScore: 6, displaySector: "Energy", debtToEquity: 2.5, freeCashFlow: -50 }),
    profile("JPM", { weight: 100, healthScore: 7, sectorKind: "financial", displaySector: "Financials", debtToEquity: 10 }),
  ])!;

  it("weights health by value", () => {
    // (600×9 + 300×6 + 100×7) ÷ 1000 = 7.9
    expect(intelligence.averageHealth).toBe(7.9);
    expect(intelligence.healthMeasured).toBe(1);
  });

  it("measures each exposure only where its test applies, and says how much that was", () => {
    const byKey = Object.fromEntries(intelligence.exposures.map((e) => [e.key, e]));
    // Banks are not measured for balance-sheet tests: 900 of 1000 measured.
    expect(byKey["strong-balance-sheet"]).toMatchObject({ share: 600 / 900, measured: 0.9 });
    expect(byKey["high-leverage"]).toMatchObject({ share: 300 / 900, measured: 0.9 });
    expect(byKey["high-valuation"]).toMatchObject({ share: 0.6, measured: 1 });
    expect(byKey["negative-fcf"]).toMatchObject({ share: 0.3, measured: 1 });
  });

  it("shows sector weights and the largest holding", () => {
    expect(intelligence.sectors).toEqual([
      { sector: "Technology", share: 0.6 },
      { sector: "Energy", share: 0.3 },
      { sector: "Financials", share: 0.1 },
    ]);
    expect(intelligence.largestHolding).toEqual({ symbol: "AAPL", share: 0.6 });
  });

  it("treats an unscored or unpriced holding as not measured, never as passing", () => {
    const partial = buildIntelligence([
      profile("AAPL", { weight: 500 }),
      profile("PRIV", { weight: 500, covered: false, healthScore: null, peRatio: null, debtToEquity: null, freeCashFlow: null }),
      profile("NOPRICE", { weight: null }),
    ])!;
    expect(partial.healthMeasured).toBe(0.5);
    expect(partial.exposures.find((e) => e.key === "strong-balance-sheet")).toMatchObject({ share: 1, measured: 0.5 });
  });

  it("does not read negative equity as low leverage", () => {
    const negative = buildIntelligence([profile("BUYBACK", { debtToEquity: -4 })])!;
    expect(negative.exposures.find((e) => e.key === "strong-balance-sheet")).toMatchObject({ share: null, measured: 0 });
  });

  it("raises flags from the models and from the reader's own thesis status", () => {
    const flagged = buildIntelligence([
      profile("A", { mFlagged: true }),
      profile("B", { zZone: "distress" }),
      profile("C", { thesisStatus: "at-risk" }),
      profile("D", { mFlagged: true, mApplicable: false }),
    ])!;
    expect(flagged.flags.map((f) => `${f.symbol}:${f.label}`)).toEqual([
      "A:Accounting flag",
      "B:Distress zone",
      "C:Your thesis: at risk",
    ]);
    expect(flagged.theses).toEqual({ withThesis: 1, holdings: 4 });
  });

  it("has nothing to say about a portfolio with no priced value", () => {
    expect(buildIntelligence([profile("X", { weight: null })])).toBeNull();
    expect(buildIntelligence([])).toBeNull();
  });

  it("never advises", () => {
    const text = JSON.stringify(intelligence);
    expect(text).not.toMatch(/\b(buy|sell|should|rebalance|overweight|underweight|recommend)\b/i);
  });
});
