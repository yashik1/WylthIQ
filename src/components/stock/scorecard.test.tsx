import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Scorecard } from "./scorecard";
import { ALTMAN_ZONES } from "@/lib/scoring/altman";
import { MANIPULATION_THRESHOLD } from "@/lib/scoring/beneish";
import type { HealthReport } from "@/lib/scoring/health";
import type { PiotroskiResult, Signal } from "@/lib/scoring/types";

/**
 * The card that shows the working behind the headline score.
 *
 * The nine Piotroski components were computed on every stock page and rendered
 * nowhere — `PiotroskiResult.signals` had no consumer outside its own unit
 * test. These tests exist mostly to keep them attached to the page: a
 * refactor that quietly drops the list again would pass a typecheck and a
 * build, and look identical to a screenshot of the summary card above it.
 */

const signal = (over: Partial<Signal> = {}): Signal => ({
  key: "roa",
  label: "Profitable",
  passed: true,
  detail: "The company earned a profit on the assets it owns.",
  ...over,
});

const piotroski = (over: Partial<PiotroskiResult> = {}): PiotroskiResult => {
  const signals = over.signals ?? [
    signal({ key: "roa", label: "Profitable", passed: true }),
    signal({ key: "cfo", label: "Positive cash flow", passed: true }),
    signal({ key: "leverage", label: "Debt not rising", passed: false }),
  ];
  const evaluated = signals.filter((s) => s.passed !== null);
  return {
    score: evaluated.filter((s) => s.passed).length,
    maxScore: evaluated.length,
    signals,
    rating: "fair",
    ...over,
  };
};

const report = (over: Partial<HealthReport> = {}): HealthReport => ({
  score: 6.4,
  headline: "Generally healthy, with a few things to watch.",
  questions: [],
  piotroski: piotroski(),
  altman: {
    value: { z: 3.42, variant: "manufacturing", zone: "safe", rating: "good" },
    applicable: true,
  },
  beneish: {
    value: { m: -2.61, flagged: false, rating: "good" },
    applicable: true,
  },
  sourceFilingUrl: "https://www.sec.gov/Archives/edgar/data/320193/aapl-20250927.htm",
  fiscalYear: 2025,
  ...over,
});

const render = (r: HealthReport) => renderToStaticMarkup(<Scorecard report={r} />);

describe("score transparency", () => {
  it("shows every component check, not just the total", () => {
    const html = render(report());

    expect(html).toContain("Profitable");
    expect(html).toContain("Positive cash flow");
    expect(html).toContain("Debt not rising");
    // The point of the card: each check arrives with a sentence saying what it
    // tests, and that sentence is what makes the score auditable.
    expect(html).toContain("The company earned a profit on the assets it owns.");
    // The count is split across markup by the emphasis on the score itself.
    expect(html).toContain(">2</span> of 3 checks passed");
  });

  it("separates a check that failed from one that was never reported", () => {
    const html = render(
      report({
        piotroski: piotroski({
          signals: [
            signal({ key: "roa", label: "Profitable", passed: true }),
            signal({ key: "liquidity", label: "Bills easier to pay", passed: null }),
          ],
        }),
      }),
    );

    // Scored out of the checks that could be evaluated, and says so — a bank
    // with no current ratio has not failed a test it was never given.
    expect(html).toContain(">1</span> of 1 checks passed");
    expect(html).toContain("not reported");
    // Singular, because exactly one check went unevaluated here.
    expect(html).toContain("One could not be evaluated and is excluded");
  });

  it("prints the thresholds the scoring engine actually used", () => {
    // Guards the one real risk in showing thresholds in the UI: a second copy
    // of the numbers drifting away from the ones the model branches on.
    for (const variant of ["manufacturing", "manufacturing-book", "non-manufacturing"] as const) {
      const html = render(
        report({
          altman: {
            value: { z: 3.42, variant, zone: "safe", rating: "good" },
            applicable: true,
          },
        }),
      );
      expect(html).toContain(String(ALTMAN_ZONES[variant].safeAbove));
      expect(html).toContain(String(ALTMAN_ZONES[variant].distressBelow));
    }

    expect(render(report())).toContain(String(MANIPULATION_THRESHOLD));
  });

  it("names the book-value model when no share price was available", () => {
    const html = render(
      report({
        altman: {
          value: { z: 2.1, variant: "manufacturing-book", zone: "grey", rating: "fair" },
          applicable: true,
        },
      }),
    );
    expect(html).toContain("Altman Z′");
    expect(html).toMatch(/bought back a lot of stock/);
  });

  it("gives the reason when a model does not apply, rather than a bare dash", () => {
    const html = render(
      report({
        altman: {
          value: null,
          applicable: false,
          reason: "Not meaningful for financial companies.",
        },
      }),
    );
    expect(html).toContain("Not meaningful for financial companies.");
  });

  it("links every figure back to the filing it came from", () => {
    const html = render(report());
    expect(html).toContain("https://www.sec.gov/Archives/edgar/data/320193/aapl-20250927.htm");
    expect(html).toContain("FY2025");
  });

  it("renders nothing when no model produced a figure", () => {
    const html = render(
      report({
        piotroski: piotroski({ signals: [], score: 0, maxScore: 0 }),
        altman: { value: null, applicable: false, reason: "no data" },
        beneish: { value: null, applicable: false, reason: "no data" },
      }),
    );
    expect(html).toBe("");
  });

  it("never states the accounting screen as a finding of wrongdoing", () => {
    const html = render(
      report({
        beneish: { value: { m: -1.2, flagged: true, rating: "poor" }, applicable: true },
      }),
    );
    expect(html).toMatch(/never evidence of wrongdoing/);
    expect(html).not.toMatch(/is manipulating|has manipulated|fraud/i);
  });
});

describe("markup validity", () => {
  // See the note in what-changed.test.tsx: a <details> inside a <p> is closed
  // early by the parser and fails hydration.
  it("never nests a disclosure inside a paragraph", () => {
    expect(render(report())).not.toMatch(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*<details/);
  });
});
