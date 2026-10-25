import { describe, expect, it } from "vitest";
import { normalizeCompanyFacts } from "../fundamentals/normalize";
import type { SecCompanyFacts } from "../fundamentals/types";
import { altmanZScore } from "./altman";
import { sectorFromSic } from "./applicability";
import { beneishMScore } from "./beneish";
import { buildHealthReport } from "./health";
import { div } from "./math";
import { piotroskiFScore } from "./piotroski";

import aaplRaw from "../fundamentals/__fixtures__/aapl.json";
import ryRaw from "../fundamentals/__fixtures__/ry.json";
import shopRaw from "../fundamentals/__fixtures__/shop.json";

const aapl = normalizeCompanyFacts(aaplRaw as unknown as SecCompanyFacts);
const ry = normalizeCompanyFacts(ryRaw as unknown as SecCompanyFacts);
const shop = normalizeCompanyFacts(shopRaw as unknown as SecCompanyFacts);

// Real SIC codes: Apple 3571 (computers), Royal Bank 6022 (state commercial
// banks), Shopify 7372 (prepackaged software).
const AAPL_SECTOR = sectorFromSic(3571);
const RY_SECTOR = sectorFromSic(6022);
const SHOP_SECTOR = sectorFromSic(7372);

describe("sector classification", () => {
  it("classifies by SIC range", () => {
    expect(sectorFromSic(6022)).toBe("financial"); // commercial bank
    expect(sectorFromSic(6311)).toBe("financial"); // life insurance
    expect(sectorFromSic(6798)).toBe("financial"); // REIT
    expect(sectorFromSic(3571)).toBe("manufacturing");
    expect(sectorFromSic(7372)).toBe("other"); // software
    expect(sectorFromSic(null)).toBe("other");
  });
});

describe("Altman Z-Score", () => {
  // The headline correctness requirement: no bankruptcy score for banks.
  it("is suppressed for financial companies", () => {
    const result = altmanZScore(ry.annual[0], RY_SECTOR, 2e11);
    expect(result.applicable).toBe(false);
    expect(result.value).toBeNull();
    expect(result.reason).toMatch(/not meaningful for banks/i);
  });

  it("uses the five-factor model for manufacturers", () => {
    const result = altmanZScore(aapl.annual[0], AAPL_SECTOR, 3.5e12);
    expect(result.applicable).toBe(true);
    expect(result.value?.variant).toBe("manufacturing");
    expect(Number.isFinite(result.value!.z)).toBe(true);
    // Apple is not a distressed company by any reading.
    expect(result.value!.zone).not.toBe("distress");
  });

  it("uses the four-factor Z'' model for non-manufacturers", () => {
    const result = altmanZScore(shop.annual[0], SHOP_SECTOR, 1.4e11);
    expect(result.applicable).toBe(true);
    expect(result.value?.variant).toBe("non-manufacturing");
  });

  // Without a price source there is no market cap. Altman's own 1983 Z'
  // revision exists for this, so the score stays available rather than vanishing
  // on a zero-key install.
  it("falls back to the book-value Z' model when market cap is unknown", () => {
    const result = altmanZScore(aapl.annual[0], AAPL_SECTOR, null);
    expect(result.applicable).toBe(true);
    expect(result.value?.variant).toBe("manufacturing-book");
    expect(Number.isFinite(result.value!.z)).toBe(true);
    expect(result.value!.zone).not.toBe("distress");
  });

  it("prefers the market-value model when market cap is known", () => {
    const result = altmanZScore(aapl.annual[0], AAPL_SECTOR, 3.5e12);
    expect(result.value?.variant).toBe("manufacturing");
  });

  it("reports insufficient data rather than a wrong number", () => {
    const empty = {
      fiscalYear: 2024,
      fiscalPeriod: "FY",
      end: "2024-12-31",
      form: "10-K",
      facts: {},
      filedAt: null,
    };
    const result = altmanZScore(empty, "manufacturing", 1e9);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/not reported enough/i);
  });
});

describe("Piotroski F-Score", () => {
  it("scores a healthy manufacturer out of 9", () => {
    const result = piotroskiFScore(aapl.annual[0], aapl.annual[1]);
    expect(result.maxScore).toBe(9);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(9);
  });

  // A bank cannot report a current ratio, so that signal is skipped rather than
  // counted as a failure. Scoring it out of 9 would unfairly penalise every bank.
  it("excludes signals it cannot evaluate instead of failing them", () => {
    const result = piotroskiFScore(ry.annual[0], ry.annual[1]);
    expect(result.maxScore).toBeLessThan(9);

    const liquidity = result.signals.find((s) => s.key === "liquidity");
    expect(liquidity?.passed).toBeNull();
    expect(result.score).toBeLessThanOrEqual(result.maxScore);
  });

  it("returns unknown when there is nothing to evaluate", () => {
    const result = piotroskiFScore(undefined, undefined);
    expect(result.maxScore).toBe(0);
    expect(result.rating).toBe("unknown");
  });
});

describe("Beneish M-Score", () => {
  it("is suppressed for financial companies", () => {
    const result = beneishMScore(ry.annual[0], ry.annual[1], RY_SECTOR);
    expect(result.applicable).toBe(false);
    expect(result.reason).toMatch(/not meaningful for banks/i);
  });

  it("produces a score in a plausible range for a normal company", () => {
    const result = beneishMScore(aapl.annual[0], aapl.annual[1], AAPL_SECTOR);
    if (result.applicable) {
      expect(result.value!.m).toBeGreaterThan(-10);
      expect(result.value!.m).toBeLessThan(5);
      expect(result.value!.flagged).toBe(result.value!.m > -1.78);
    }
  });
});

describe("safe arithmetic", () => {
  it("never divides by zero or propagates nulls", () => {
    expect(div(1, 0)).toBeNull();
    expect(div(null, 5)).toBeNull();
    expect(div(5, null)).toBeNull();
    expect(div(10, 4)).toBe(2.5);
  });
});

describe("health report", () => {
  it("answers all five questions for a manufacturer", () => {
    const report = buildHealthReport(aapl, AAPL_SECTOR, 3.5e12);
    expect(report.questions).toHaveLength(5);
    expect(report.score).not.toBeNull();
    expect(report.score!).toBeGreaterThanOrEqual(0);
    expect(report.score!).toBeLessThanOrEqual(10);
    for (const q of report.questions) {
      expect(q.answer.length).toBeGreaterThan(10);
      expect(q.question).toMatch(/\?$/);
    }
  });

  it("produces the plain-English debt sentence", () => {
    const report = buildHealthReport(aapl, AAPL_SECTOR, 3.5e12);
    const debt = report.questions.find((q) => q.key === "debt")!;
    expect(debt.answer).toMatch(/for every \$1 it owes/i);
  });

  // Apple's total liabilities are large relative to assets (1.26x cover), but it
  // clears its borrowings in well under a year of cash flow. Rating on total
  // liabilities alone wrongly called this distress.
  it("rates a cash-rich company on net debt, not total liabilities", () => {
    const report = buildHealthReport(aapl, AAPL_SECTOR, 3.5e12);
    const debt = report.questions.find((q) => q.key === "debt")!;
    expect(debt.rating).toBe("good");
  });

  it("does not report net debt for banks", () => {
    const report = buildHealthReport(ry, RY_SECTOR, 1.6e11);
    const debt = report.questions.find((q) => q.key === "debt")!;
    const netDebt = debt.metrics.find((m) => m.label === "Net debt")!;
    expect(netDebt.value).toBe("n/a for banks");
  });

  // Valuation is scored but excluded from the health composite, so an expensive
  // price cannot make a sound business look financially weak.
  it("excludes valuation from the health score", () => {
    // A $10T price: rich enough for a poor P/E on trailing twelve-month earnings.
    const report = buildHealthReport(aapl, AAPL_SECTOR, 1e13);
    expect(report.questions.find((q) => q.key === "valuation")!.rating).toBe("poor");
    expect(report.score!).toBeGreaterThanOrEqual(8);
  });

  // Banks must still get a usable report even though two models are suppressed.
  it("still reports on a bank, with the industry caveat", () => {
    const report = buildHealthReport(ry, RY_SECTOR, 2e11);
    expect(report.score).not.toBeNull();
    const debt = report.questions.find((q) => q.key === "debt")!;
    expect(debt.answer).toMatch(/banks and insurers/i);
    expect(report.altman.applicable).toBe(false);
  });

  it("never uses recommendation language", () => {
    const forbidden = /\b(buy|sell|hold|invest in|recommend|should own|target price)\b/i;
    for (const [f, sector, cap] of [
      [aapl, AAPL_SECTOR, 3.5e12],
      [ry, RY_SECTOR, 2e11],
      [shop, SHOP_SECTOR, 1.4e11],
    ] as const) {
      const report = buildHealthReport(f, sector, cap);
      expect(report.headline).not.toMatch(forbidden);
      for (const q of report.questions) {
        expect(q.answer, `${f.entityName} / ${q.key}`).not.toMatch(forbidden);
      }
    }
  });

  // A Canadian filer reports CAD. Labelling those amounts with a bare "$" reads
  // as US dollars, which is wrong by roughly a third.
  it("labels amounts in the currency the statements were filed in", () => {
    const cad = {
      ...aapl,
      annual: aapl.annual.map((period) => ({
        ...period,
        facts: Object.fromEntries(
          Object.entries(period.facts).map(([k, f]) => [k, { ...f!, unit: "CAD" }]),
        ) as typeof period.facts,
      })),
    };

    const report = buildHealthReport(cad, AAPL_SECTOR, null);
    const profitable = report.questions.find((q) => q.key === "profitable")!;
    expect(profitable.answer).toContain("C$");
    expect(profitable.answer).not.toMatch(/(?<!C)\$\d/);
  });

  it("uses a plain dollar sign for US filers", () => {
    const report = buildHealthReport(aapl, AAPL_SECTOR, null);
    const profitable = report.questions.find((q) => q.key === "profitable")!;
    expect(profitable.answer).toMatch(/\$\d/);
    expect(profitable.answer).not.toContain("C$");
  });

  it("degrades honestly when nothing was reported", () => {
    const empty = { cik: "0", entityName: "Empty Co", taxonomy: "us-gaap" as const, annual: [], missingFields: [] };
    const report = buildHealthReport(empty, "other", null);
    expect(report.score).toBeNull();
    expect(report.headline).toMatch(/not reported enough/i);
  });
});
