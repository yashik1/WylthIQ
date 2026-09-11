import { describe, expect, it } from "vitest";
import { guideForChange, learnHref, METRIC_GUIDE, METRIC_GUIDES } from "./metric-guide";

/**
 * The explanations behind every figure.
 *
 * What is worth pinning is completeness and tone: every entry answers all
 * five questions, every entry can be linked to, and none of them slips from
 * describing a figure into telling a reader what to do.
 */

describe("the metric guide", () => {
  it("answers all five questions for every figure", () => {
    for (const guide of METRIC_GUIDES) {
      for (const part of ["name", "what", "how", "why", "limits", "source"] as const) {
        expect(guide[part].trim().length, `${guide.id}.${part}`).toBeGreaterThan(part === "name" ? 1 : 20);
      }
    }
  });

  it("keys every entry by its own id, so every link lands", () => {
    for (const [key, guide] of Object.entries(METRIC_GUIDE)) {
      expect(guide.id).toBe(key);
      // Used as an HTML id and a URL fragment.
      expect(key).toMatch(/^[a-z][a-z-]*$/);
    }
  });

  it("covers the figures the roadmap asks to be explained", () => {
    for (const id of [
      "revenue", "gross-margin", "operating-margin", "net-margin", "free-cash-flow",
      "net-debt", "debt-to-equity", "pe", "ps", "piotroski", "altman", "beneish",
      "roe", "dividend-yield",
    ] as const) {
      expect(METRIC_GUIDE[id]).toBeDefined();
    }
  });

  it("describes figures without advising anyone", () => {
    for (const guide of METRIC_GUIDES) {
      const prose = [guide.what, guide.how, guide.why, guide.limits].join(" ");
      expect(prose, guide.id).not.toMatch(/\b(buy|sell|should|recommend|avoid|undervalued|overvalued)\b/i);
    }
  });

  it("links each guide to its own place on /learn", () => {
    expect(learnHref("pe")).toBe("/learn#pe");
  });

  it("maps What Changed measures to their guides and leaves the rest alone", () => {
    expect(guideForChange("grossMargin")).toBe("gross-margin");
    expect(guideForChange("capex")).toBeNull();
  });
});
