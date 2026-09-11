/**
 * What a portfolio is exposed to, described in the terms the company pages use.
 *
 * Every figure is a share of the portfolio's value that meets a stated test —
 * a strong balance sheet, a P/E above 30, negative free cash flow — measured
 * only over the holdings the test can be applied to, and each says how much of
 * the portfolio that was. A holding outside the scored universe, or a bank for
 * a balance-sheet test, is "not measured", never counted as passing or failing.
 *
 * Descriptive only. Nothing here says a portfolio should hold more or less of
 * anything, and the tests are labels for what the figures show, not targets.
 */

export interface HoldingProfile {
  symbol: string;
  /** Value in the portfolio's base currency, or null when it could not be priced or converted. */
  weight: number | null;
  /** In the scored universe, with stored scores. */
  covered: boolean;
  sectorKind: string | null;
  displaySector: string | null;
  healthScore: number | null;
  peRatio: number | null;
  debtToEquity: number | null;
  currentRatio: number | null;
  /** Latest annual operating cash flow less capital spending. */
  freeCashFlow: number | null;
  mFlagged: boolean | null;
  mApplicable: boolean | null;
  zZone: string | null;
  zApplicable: boolean | null;
  /** The reader's own thesis status for this company, when there is one. */
  thesisStatus: string | null;
}

export interface Exposure {
  key: "strong-balance-sheet" | "high-valuation" | "negative-fcf" | "high-leverage";
  label: string;
  /** Share of the measured value that meets the test, or null when nothing could be measured. */
  share: number | null;
  /** Share of the whole portfolio's value the test could be applied to. */
  measured: number;
  definition: string;
}

export interface PortfolioFlag {
  symbol: string;
  label: string;
  detail: string;
}

export interface PortfolioIntelligence {
  /** Value-weighted over holdings with a health score. */
  averageHealth: number | null;
  /** Share of value with a health score. */
  healthMeasured: number;
  exposures: Exposure[];
  sectors: { sector: string; share: number }[];
  largestHolding: { symbol: string; share: number } | null;
  flags: PortfolioFlag[];
  theses: { withThesis: number; holdings: number };
}

const HIGH_PE = 30;

function share(profiles: HoldingProfile[], total: number, test: (p: HoldingProfile) => boolean | null) {
  let measured = 0;
  let meeting = 0;
  for (const profile of profiles) {
    if (profile.weight == null || profile.weight <= 0) continue;
    const result = test(profile);
    if (result == null) continue;
    measured += profile.weight;
    if (result) meeting += profile.weight;
  }
  return { share: measured > 0 ? meeting / measured : null, measured: total > 0 ? measured / total : 0 };
}

const isFinancial = (p: HoldingProfile) => p.sectorKind === "financial";

/** Debt to equity is meaningless below zero: that is negative equity, not low debt. */
const leverage = (p: HoldingProfile) =>
  p.debtToEquity != null && Number.isFinite(p.debtToEquity) && p.debtToEquity >= 0 ? p.debtToEquity : null;

export function buildIntelligence(profiles: HoldingProfile[]): PortfolioIntelligence | null {
  const weighted = profiles.filter((p) => p.weight != null && p.weight > 0);
  const total = weighted.reduce((sum, p) => sum + (p.weight ?? 0), 0);
  if (total <= 0) return null;

  let healthWeight = 0;
  let healthSum = 0;
  for (const p of weighted) {
    if (p.healthScore == null) continue;
    healthWeight += p.weight!;
    healthSum += p.weight! * p.healthScore;
  }

  const exposures: Exposure[] = [
    {
      key: "strong-balance-sheet",
      label: "Strong balance sheets",
      definition: "Liabilities no more than equity, and a current ratio of at least 1. Financial companies are not measured.",
      ...share(weighted, total, (p) => {
        if (!p.covered || isFinancial(p)) return null;
        const de = leverage(p);
        if (de == null) return null;
        return de <= 1 && (p.currentRatio == null || p.currentRatio >= 1);
      }),
    },
    {
      key: "high-valuation",
      label: "High valuation",
      definition: `A P/E above ${HIGH_PE}. A company that made a loss has no P/E and is not measured.`,
      ...share(weighted, total, (p) => (p.covered && p.peRatio != null && p.peRatio > 0 ? p.peRatio > HIGH_PE : null)),
    },
    {
      key: "negative-fcf",
      label: "Negative free cash flow",
      definition: "Operating cash flow less capital spending below zero in the latest annual report.",
      ...share(weighted, total, (p) => (p.freeCashFlow != null ? p.freeCashFlow < 0 : null)),
    },
    {
      key: "high-leverage",
      label: "High leverage",
      definition: "Liabilities more than twice equity. Financial companies are not measured.",
      ...share(weighted, total, (p) => {
        if (!p.covered || isFinancial(p)) return null;
        const de = leverage(p);
        return de == null ? null : de > 2;
      }),
    },
  ];

  const bySector = new Map<string, number>();
  for (const p of weighted) {
    const sector = p.displaySector ?? "Not classified";
    bySector.set(sector, (bySector.get(sector) ?? 0) + p.weight!);
  }

  const largest = [...weighted].sort((a, b) => (b.weight ?? 0) - (a.weight ?? 0))[0];

  const flags: PortfolioFlag[] = [];
  for (const p of profiles) {
    if (p.mApplicable && p.mFlagged) {
      flags.push({ symbol: p.symbol, label: "Accounting flag", detail: "The Beneish M-Score finds patterns seen in companies that overstated earnings. A prompt to read the filings, not evidence of a problem." });
    }
    if (p.zApplicable && p.zZone === "distress") {
      flags.push({ symbol: p.symbol, label: "Distress zone", detail: "The Altman Z-Score places the balance sheet in its distress zone. A statistical reading, not a forecast." });
    }
    if (p.thesisStatus === "at-risk" || p.thesisStatus === "invalidated") {
      flags.push({
        symbol: p.symbol,
        label: p.thesisStatus === "at-risk" ? "Your thesis: at risk" : "Your thesis: invalidated",
        detail: "The status you set on your own thesis for this company.",
      });
    }
  }

  return {
    averageHealth: healthWeight > 0 ? Math.round((healthSum / healthWeight) * 10) / 10 : null,
    healthMeasured: healthWeight / total,
    exposures,
    sectors: [...bySector]
      .map(([sector, weight]) => ({ sector, share: weight / total }))
      .sort((a, b) => b.share - a.share),
    largestHolding: largest ? { symbol: largest.symbol, share: (largest.weight ?? 0) / total } : null,
    flags,
    theses: {
      withThesis: profiles.filter((p) => p.thesisStatus != null).length,
      holdings: profiles.length,
    },
  };
}
