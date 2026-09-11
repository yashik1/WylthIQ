import { describe, expect, it } from "vitest";
import { snapshotFundamentals } from "../fundamentals/as-reported";
import type { CanonicalField } from "../fundamentals/types";
import { buildChangeReport } from "../scoring/changes";
import { buildHealthReport } from "../scoring/health";
import { buildKeyFigures } from "../scoring/key-figures";
import { buildGrounding, buildUserMessage, screenAnswer, SYSTEM_PROMPT } from "./grounding";
import { AI_QUESTION_OPTIONS, isAiQuestion } from "./questions";

/**
 * Grounded explanations. What matters: the model is only handed figures the
 * page shows, each tied to a citable source, under rules that forbid advice —
 * and an answer that gives advice anyway is withheld.
 */

type Values = Partial<Record<CanonicalField, number>>;

const year = (values: Values): Values => values;
const fundamentals = snapshotFundamentals(
  {
    asOf: "2025-10-31",
    fiscalYear: 2025,
    form: "10-K",
    sourceFilingUrl: "https://www.sec.gov/filing",
    periods: [
      { fiscalYear: 2025, end: "2025-09-27", currency: "USD", values: year({ revenue: 1100, grossProfit: 480, operatingIncome: 300, netIncome: 240, assets: 2000, liabilities: 1200, equity: 800, operatingCashFlow: 320, capex: 40, sharesOutstanding: 100, currentAssets: 600, currentLiabilities: 500, cash: 200, longTermDebt: 300 }) },
      { fiscalYear: 2024, end: "2024-09-28", currency: "USD", values: year({ revenue: 1000, grossProfit: 430, operatingIncome: 260, netIncome: 200, assets: 1900, liabilities: 1150, equity: 750, operatingCashFlow: 300, capex: 45, sharesOutstanding: 104, currentAssets: 560, currentLiabilities: 480, cash: 180, longTermDebt: 320 }) },
    ],
  },
  { cik: "1", entityName: "Test Co", taxonomy: "us-gaap" },
);

const report = buildHealthReport(fundamentals, "other", 5000);

const grounding = buildGrounding({
  symbol: "TEST",
  name: "Test Co",
  currency: "USD",
  latest: { fiscalYear: 2025, form: "10-K", filedAt: "2025-10-31", url: "https://www.sec.gov/filing" },
  report,
  changes: buildChangeReport(fundamentals, "USD"),
  keyFigures: buildKeyFigures(fundamentals, 5000),
  history: null,
  price: { freshness: "delayed-15min", marketCap: 5000 },
});

describe("grounding an explanation", () => {
  it("numbers each source and cites it on the facts drawn from it", () => {
    expect(grounding.sources.map((s) => s.id)).toEqual(["S1", "S2", "S3", "S4", "S5"]);
    expect(grounding.sources[0]).toEqual({ id: "S1", label: "Test Co's FY2025 10-K", url: "https://www.sec.gov/filing" });
    for (const line of grounding.facts.split("\n").slice(1)) {
      expect(line).toMatch(/^\[S\d\] /);
    }
  });

  it("carries the figures the page shows, with their period", () => {
    expect(grounding.facts).toContain("fiscal year 2025, Form 10-K, filed 2025-10-31");
    expect(grounding.facts).toMatch(/Health score for FY2025: \d+\.\d out of 10/);
    expect(grounding.facts).toContain("Between FY2024 and FY2025:");
    expect(grounding.facts).toMatch(/Revenue \$1(\.\d+)?K → \$1\.10K|Revenue .* → .*\(\+10\.0%/);
  });

  it("leaves out anything the page does not have", () => {
    const bare = buildGrounding({
      symbol: "TEST", name: "Test Co", currency: "USD", latest: null, report,
      changes: null, keyFigures: null, history: null, price: null,
    });
    expect(bare.sources.map((s) => s.label)).toEqual(["Health score and the questions behind it", "Valuation and share price"]);
  });

  it("asks a fixed question under rules that forbid advice and outside knowledge", () => {
    const message = buildUserMessage("what-changed", grounding);
    expect(message).toMatch(/^Question: What changed in the latest figures\?/);
    expect(message).toContain("FACTS (the only information you may use):");
    expect(SYSTEM_PROMPT).toMatch(/Use only the facts/);
    expect(SYSTEM_PROMPT).toMatch(/Never recommend buying, selling or holding/);
    expect(SYSTEM_PROMPT).toMatch(/cite its source id/);
  });

  it("offers only the fixed questions", () => {
    expect(AI_QUESTION_OPTIONS.map((q) => q.key)).toEqual(["health-change", "what-changed", "closer-look", "valuation"]);
    expect(isAiQuestion("valuation")).toBe(true);
    expect(isAiQuestion("should I buy it?")).toBe(false);
    expect(isAiQuestion("toString")).toBe(false);
  });
});

describe("screening an answer", () => {
  it("keeps a description", () => {
    expect(screenAnswer(" Revenue rose 10% in FY2025 [S3]. ")).toEqual({ ok: true, text: "Revenue rose 10% in FY2025 [S3]." });
  });

  it("withholds anything that reads as advice, or nothing at all", () => {
    for (const text of [
      "Given this, you should consider the shares.",
      "The stock looks undervalued [S5].",
      "Analysts would call it a buy.",
      "It is a buy at this price.",
      "Our price target is $200.",
      "",
    ]) {
      expect(screenAnswer(text).ok, text).toBe(false);
    }
  });
});
