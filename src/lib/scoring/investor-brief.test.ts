import { describe, expect, it } from "vitest";
import { buildInvestorBrief } from "./investor-brief";
import { buildBusinessSummary } from "./business";
import { buildChangeReport, type ChangeReport } from "./changes";
import { buildHealthReport, type HealthReport } from "./health";
import { buildHighlights } from "./highlights";
import { buildKeyFigures } from "./key-figures";
import { sectorFromSic } from "./applicability";
import { normalizeCompanyFacts } from "../fundamentals/normalize";
import type { SecCompanyFacts } from "../fundamentals/types";
import type { Warning } from "./warnings";
import aaplRaw from "../fundamentals/__fixtures__/aapl.json";

/**
 * The brief at the top of a company page.
 *
 * Built from Apple's real filings, so what is being checked is the assembly —
 * that each part says where it came from, that nothing is rated in colour
 * alone, and that the bottom line restates evidence without ever advising.
 */

const aapl = normalizeCompanyFacts(aaplRaw as unknown as SecCompanyFacts);
const sector = sectorFromSic(3571);
const MARKET_CAP = 3.5e12;

const inputs = (over: Partial<Parameters<typeof buildInvestorBrief>[0]> = {}) => {
  const report = buildHealthReport(aapl, sector, MARKET_CAP);
  return {
    name: "Apple",
    business: buildBusinessSummary("Apple", "3571", aapl),
    report,
    changes: buildChangeReport(aapl),
    warnings: [] as Warning[],
    highlights: buildHighlights(aapl, report, sector),
    keyFigures: buildKeyFigures(aapl, MARKET_CAP),
    latest: aapl.annual[0],
    marketCap: MARKET_CAP,
    ...over,
  };
};

const ADVICE = /\b(buy|sell|hold|should|recommend|target|undervalued|overvalued|cheap|expensive)\b/i;

describe("the investor brief", () => {
  it("names the filing everything in it came from", () => {
    const brief = buildInvestorBrief(inputs());
    expect(brief.source).toMatchObject({ fiscalYear: aapl.annual[0].fiscalYear, form: aapl.annual[0].form });
    expect(brief.source.url).not.toBeNull();
  });

  it("rates the four health areas in words, leaving valuation out of the score", () => {
    const brief = buildInvestorBrief(inputs());
    expect(brief.health.areas.map((a) => a.label)).toEqual(["Profitability", "Growth", "Debt", "Accounting"]);
    for (const area of brief.health.areas) {
      expect(["Strong", "Mixed", "Weak", "Not enough data"]).toContain(area.verdict);
    }
  });

  it("lists at most three moves each way, each labelled with the comparison it came from", () => {
    const brief = buildInvestorBrief(inputs());
    for (const moves of [brief.improving, brief.deteriorating]) {
      expect(moves.length).toBeLessThanOrEqual(3);
      for (const move of moves) expect(move.period).toMatch(/against/);
    }
  });

  it("leads with the latest quarter when one has been reported since the annual report", () => {
    const brief = buildInvestorBrief(inputs());
    const periods = [...brief.improving, ...brief.deteriorating].map((m) => m.period);
    if (buildChangeReport(aapl)!.quarterly.length > 0) {
      expect(periods.some((p) => p.startsWith("Q"))).toBe(true);
    }
  });

  it("works out the P/E from market value and the latest profit", () => {
    const brief = buildInvestorBrief(inputs());
    const profit = aapl.annual[0].facts.netIncome!.value;
    expect(brief.valuation.pe).toBeCloseTo(MARKET_CAP / profit, 6);
    expect(brief.valuation.summary).toMatch(/single-year/);
  });

  it("says plainly when there is no price to value against", () => {
    const brief = buildInvestorBrief(inputs({ marketCap: null }));
    expect(brief.valuation.pe).toBeNull();
    expect(brief.valuation.summary).toMatch(/No current share price/);
  });

  it("writes a bottom line of two or three sentences that never advises", () => {
    const brief = buildInvestorBrief(inputs());
    const sentences = brief.bottomLine.split(/(?<=\.)\s+/).filter(Boolean);
    expect(sentences.length).toBeGreaterThanOrEqual(2);
    expect(sentences.length).toBeLessThanOrEqual(3);
    expect(brief.bottomLine).not.toMatch(ADVICE);
    expect(brief.valuation.summary).not.toMatch(ADVICE);
  });
});

describe("what it points at first", () => {
  const change = (over: Partial<ChangeReport["changes"][number]>) => ({
    key: "grossMargin",
    label: "Gross margin",
    from: "40.0%",
    to: "35.0%",
    delta: "−5.0 pts",
    direction: "worse" as const,
    severity: "significant" as const,
    meaning: "…",
    ...over,
  });

  const changes = (list: ChangeReport["changes"]): ChangeReport => ({
    fromYear: 2024,
    toYear: 2025,
    form: "10-K",
    filedAt: "2025-10-31",
    sourceFilingUrl: null,
    changes: list,
    steady: 0,
    quarterly: [],
  });

  it("puts a severe filing ahead of everything, pointing to the warning signs rather than repeating one", () => {
    const warnings: Warning[] = [
      { text: "Non-reliance on previously issued financial statements, in a filing on 2026-08-01.", evidence: "Form 8-K, item 4.02", level: "severe", url: "https://sec.gov/8k" },
    ];
    const brief = buildInvestorBrief(
      inputs({ warnings, changes: changes([change({ key: "netIncome", label: "Profit", delta: "turned negative", severity: "critical" })]) }),
    );
    expect(brief.watch).toMatchObject({ url: "#warning-signs", evidence: "Includes one rated severe" });
    expect(brief.watch?.text).toMatch(/^One warning sign/);
    expect(brief.watch?.text).not.toContain(warnings[0].text);
  });

  it("counts the warning signs it points to", () => {
    const warning = (text: string): Warning => ({ text, evidence: "…", level: "notable" });
    const brief = buildInvestorBrief(inputs({ warnings: [warning("First."), warning("Second.")] }));
    expect(brief.watch).toMatchObject({ url: "#warning-signs", evidence: "None rated severe" });
    expect(brief.watch?.text).toMatch(/^2 warning signs/);
  });

  it("then a critical deterioration in the figures", () => {
    const brief = buildInvestorBrief(
      inputs({ changes: changes([change({ key: "netIncome", label: "Profit", delta: "turned negative", severity: "critical" })]) }),
    );
    expect(brief.watch?.text).toBe("Profit: turned negative, FY2025 against FY2024.");
  });

  it("says when areas could not be rated, rather than counting them as weak", () => {
    const report = buildHealthReport(aapl, sector, MARKET_CAP);
    const thin: HealthReport = {
      ...report,
      questions: report.questions.map((q) => (q.key === "accounting" ? { ...q, rating: "unknown" } : q)),
    };
    const brief = buildInvestorBrief(inputs({ report: thin }));
    expect(brief.health.unassessed).toEqual(["Accounting"]);
    expect(brief.health.assessed).toBe(3);
    expect(brief.health.summary).toMatch(/accounting could not be rated\.$/);
    expect(brief.health.summary).not.toMatch(/weak on [^;]*accounting/);
  });

  it("names the areas in one sentence, in the same words as every other panel", () => {
    const report = buildHealthReport(aapl, sector, MARKET_CAP);
    const rated: HealthReport = {
      ...report,
      questions: report.questions.map((q) =>
        q.key === "growing" ? { ...q, rating: "fair" } : q.key === "valuation" ? q : { ...q, rating: "good" },
      ),
    };
    const brief = buildInvestorBrief(inputs({ report: rated }));
    expect(brief.health.summary).toBe("Strong on profitability, debt and accounting; mixed on growth.");
  });

  it("has nothing to compare for a company with a single filing", () => {
    const brief = buildInvestorBrief(inputs({ changes: null }));
    expect(brief.compared).toBe(false);
    expect(brief.improving).toEqual([]);
  });
});
