import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InvestorBriefCard } from "./investor-brief";
import { buildInvestorBrief, type BriefArea, type InvestorBrief } from "@/lib/scoring/investor-brief";
import { buildBusinessSummary } from "@/lib/scoring/business";
import { buildChangeReport } from "@/lib/scoring/changes";
import { buildHealthReport } from "@/lib/scoring/health";
import { buildHighlights } from "@/lib/scoring/highlights";
import { buildKeyFigures } from "@/lib/scoring/key-figures";
import { sectorFromSic } from "@/lib/scoring/applicability";
import { normalizeCompanyFacts } from "@/lib/fundamentals/normalize";
import type { SecCompanyFacts } from "@/lib/fundamentals/types";
import aaplRaw from "@/lib/fundamentals/__fixtures__/aapl.json";

/**
 * The brief card, rendered from Apple's real filings.
 *
 * Checks the promises the card makes on sight: it names its filing, says what
 * the business does, draws a conclusion without advising, sends the reader to
 * the sections below for the evidence, and never produces markup a browser
 * would otherwise rearrange.
 */

const aapl = normalizeCompanyFacts(aaplRaw as unknown as SecCompanyFacts);
const sector = sectorFromSic(3571);
const report = buildHealthReport(aapl, sector, 3.5e12);
const brief = buildInvestorBrief({
  name: "Apple",
  business: buildBusinessSummary("Apple", "3571", aapl),
  report,
  changes: buildChangeReport(aapl),
  warnings: [],
  highlights: buildHighlights(aapl, report, sector),
  keyFigures: buildKeyFigures(aapl, 3.5e12),
  latest: aapl.annual[0],
  marketCap: 3.5e12,
});

const render = (b: InvestorBrief) => renderToStaticMarkup(<InvestorBriefCard brief={b} companyName="Apple" />);
const html = render(brief);
const text = html.replace(/<[^>]+>/g, " ");

/** Text as React writes it into markup. */
const escaped = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");

const conclusionOf = (b: InvestorBrief) =>
  render(b).match(/>Conclusion<\/h3>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/)?.[1] ?? "";

const area = (key: BriefArea["key"], label: string, rating: BriefArea["rating"]): BriefArea => ({
  key,
  label,
  rating,
  verdict: "",
  answer: "",
});

const withAreas = (areas: BriefArea[]): InvestorBrief => ({
  ...brief,
  health: { ...brief.health, areas },
});

const ADVICE = /\b(buy|sell|should|price target)\b/i;

describe("investor brief card", () => {
  it("has the parts the card promises", () => {
    for (const heading of ["Investor brief", "Business", "Conclusion", "Research path"]) {
      expect(html, heading).toContain(`${heading}</h`);
    }
  });

  it("names the filing it came from and links to it", () => {
    expect(text).toContain(`FY${aapl.annual[0].fiscalYear} ${aapl.annual[0].form}`);
    expect(brief.source.url).toBeTruthy();
    expect(html).toContain(`href="${escaped(brief.source.url!)}"`);
    expect(html).toContain("read the filing");
  });

  it("says what the business does", () => {
    expect(brief.business).toBeTruthy();
    expect(html).toContain(escaped(brief.business!));
  });

  it("draws a conclusion from the rated areas", () => {
    const conclusion = conclusionOf(brief);
    expect(conclusion).toMatch(/^The (financial picture|filing) .+\.$/);
    for (const a of brief.health.areas.filter((a) => a.rating === "good")) {
      expect(conclusion).toContain(a.label.toLowerCase());
    }
  });

  it("describes strong, mixed and unrateable pictures without advising", () => {
    const strong = conclusionOf(
      withAreas([
        area("profitable", "Profitability", "good"),
        area("accounting", "Accounting", "good"),
        area("growing", "Growth", "fair"),
        area("debt", "Debt", "poor"),
      ]),
    );
    expect(strong).toMatch(/^The financial picture is led by profitability and accounting, with growth .*, while debt /);

    const mixed = conclusionOf(
      withAreas([area("growing", "Growth", "fair"), area("debt", "Debt", "poor")]),
    );
    expect(mixed).toMatch(/^The financial picture is mixed, with growth .* and debt /);

    const unrated = conclusionOf(withAreas([area("profitable", "Profitability", "unknown")]));
    expect(unrated).toBe("The filing does not provide enough evidence for a clear financial conclusion.");

    for (const conclusion of [strong, mixed, unrated]) expect(conclusion).not.toMatch(ADVICE);
  });

  it("points to the sections below for the evidence, rather than repeating it", () => {
    expect(text).toMatch(/Use the sections below for the evidence/);
    // Health ratings, valuation multiples and the watch item live in their own sections.
    expect(text).not.toMatch(/Profitability\s+(Strong|Mixed|Weak|Not enough data)/);
    expect(html).not.toContain(escaped(brief.health.summary));
    expect(html).not.toContain(escaped(brief.valuation.summary));
    if (brief.watch) expect(html).not.toContain(escaped(brief.watch.text));
  });

  it("says what it is not", () => {
    expect(text).toMatch(/not a recommendation/);
    expect(text).not.toMatch(ADVICE);
  });

  it("never nests a disclosure inside a paragraph", () => {
    expect(html).not.toMatch(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*<details/);
  });
});
