import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { InvestorBriefCard } from "./investor-brief";
import { buildInvestorBrief } from "@/lib/scoring/investor-brief";
import { buildBusinessSummary } from "@/lib/scoring/business";
import { buildChangeReport } from "@/lib/scoring/changes";
import { buildHealthReport } from "@/lib/scoring/health";
import { buildHighlights } from "@/lib/scoring/highlights";
import { buildKeyFigures } from "@/lib/scoring/key-figures";
import { sectorFromSic } from "@/lib/scoring/applicability";
import { normalizeCompanyFacts } from "@/lib/fundamentals/normalize";
import type { SecCompanyFacts } from "@/lib/fundamentals/types";
import aaplRaw from "@/lib/fundamentals/__fixtures__/aapl.json";

vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

/**
 * The brief card, rendered from Apple's real filings.
 *
 * Checks the promises the card makes on sight: every part of the brief is
 * there, ratings are words, explanations reach Learn, and the markup a
 * browser would otherwise rearrange is never produced.
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

const html = renderToStaticMarkup(<InvestorBriefCard brief={brief} companyName="Apple" />);
const text = html.replace(/<[^>]+>/g, " ");

describe("investor brief card", () => {
  it("has every part the brief promises", () => {
    for (const heading of [
      "Investor brief",
      "Business",
      "Financial health",
      "What&#x27;s improving",
      "What&#x27;s deteriorating",
      "Biggest thing to watch",
      "Valuation context",
      "Bottom line",
    ]) {
      expect(html, heading).toContain(heading);
    }
  });

  it("names the filing it came from and links to it", () => {
    expect(text).toContain(`FY${aapl.annual[0].fiscalYear} ${aapl.annual[0].form}`);
    expect(html).toContain("read the filing");
  });

  it("names health areas in a sentence that links to the breakdown, rather than repeating it", () => {
    expect(text).toContain(brief.health.summary);
    expect(brief.health.summary).toMatch(/^(Strong|Mixed|Weak) on [a-z]/);
    expect(html).toContain('href="#health"');
    // The area-by-area grid lives in the health section, not here.
    expect(text).not.toMatch(/Profitability\s+(Strong|Mixed|Weak|Not enough data)/);
  });

  it("links its explanations to Learn", () => {
    expect(html).toContain('href="/learn#pe"');
    expect(html).toContain('href="/learn#health-score"');
  });

  it("says what it is not", () => {
    expect(text).toMatch(/not a recommendation/);
    expect(text).not.toMatch(/\b(buy|sell|should|price target)\b/i);
  });

  it("never nests a disclosure inside a paragraph", () => {
    expect(html).not.toMatch(/<p\b[^>]*>(?:(?!<\/p>)[\s\S])*<details/);
  });
});
