import { describe, expect, it } from "vitest";
import { buildFilingTimeline, classifyFiling } from "./timeline";
import type { CanonicalField, FinancialPeriod, NormalizedFundamentals } from "../fundamentals/types";
import type { Filing } from "../providers/types";

/**
 * The filing timeline.
 *
 * What is worth pinning is restraint: an event is labelled only from its form
 * and item codes, a report's figures are compared only with a fair earlier
 * period, and every event keeps its link to the filing.
 */

const filing = (over: Partial<Filing>): Filing => ({
  form: "8-K",
  filedAt: "2026-08-21",
  periodOfReport: null,
  description: null,
  url: "https://www.sec.gov/Archives/edgar/data/1/0001/doc.htm",
  items: null,
  ...over,
});

const period = (
  fiscalYear: number,
  fiscalPeriod: string,
  end: string,
  values: Partial<Record<CanonicalField, number>>,
): FinancialPeriod => ({
  fiscalYear,
  fiscalPeriod,
  end,
  form: fiscalPeriod === "FY" ? "10-K" : "10-Q",
  filedAt: end,
  facts: Object.fromEntries(
    Object.entries(values).map(([field, value]) => [
      field,
      { value, unit: "USD", end, fiscalYear, fiscalPeriod, form: "10-Q", sourceConcept: `us-gaap:${field}`, sourceFilingUrl: null },
    ]),
  ) as FinancialPeriod["facts"],
});

const fundamentals: NormalizedFundamentals = {
  cik: "0000000001",
  entityName: "Test Co",
  taxonomy: "us-gaap",
  annual: [
    period(2025, "FY", "2025-09-27", { revenue: 400, operatingIncome: 120 }),
    period(2024, "FY", "2024-09-28", { revenue: 360, operatingIncome: 90 }),
  ],
  quarterly: [
    period(2026, "Q3", "2026-06-27", { revenue: 110, operatingIncome: 30 }),
    period(2026, "Q2", "2026-03-28", { revenue: 100, operatingIncome: 28 }),
    period(2025, "Q3", "2025-06-28", { revenue: 100, operatingIncome: 30 }),
  ],
  missingFields: [],
};

describe("classifying a filing", () => {
  it("names reports by their form", () => {
    expect(classifyFiling(filing({ form: "10-K" })).category).toBe("annual-report");
    expect(classifyFiling(filing({ form: "40-F" })).category).toBe("annual-report");
    expect(classifyFiling(filing({ form: "10-Q" })).category).toBe("quarterly-report");
  });

  it("names an 8-K from its item codes", () => {
    expect(classifyFiling(filing({ items: "2.02,9.01" }))).toMatchObject({ category: "earnings", label: "Earnings" });
    expect(classifyFiling(filing({ items: "2.01" })).category).toBe("acquisition");
    expect(classifyFiling(filing({ items: "3.02" })).category).toBe("share-issuance");
  });

  it("names a mixed 8-K after its most significant item, and lists every event in it", () => {
    // 5.02 is notable and 2.02 routine, so the departure is the news.
    const classified = classifyFiling(filing({ items: "2.02,5.02,9.01" }));
    expect(classified.category).toBe("executive-change");
    expect(classified.title).toContain("Published results");
    expect(classified.title).not.toContain("exhibits");
  });

  it("calls an 8-K nothing more specific than a material event when its items do not say", () => {
    expect(classifyFiling(filing({ items: "8.01" }))).toMatchObject({ category: "material-event", label: "Material event" });
    expect(classifyFiling(filing({ items: null })).category).toBe("material-event");
  });

  it("never invents a buyback or dividend label", () => {
    const labels = ["1.01", "2.02", "8.01", "7.01", "3.03"].map((items) => classifyFiling(filing({ items })).label);
    for (const label of labels) expect(label).not.toMatch(/buyback|repurchase|dividend/i);
  });
});

describe("building the timeline", () => {
  it("groups filings by year, newest first, keeping every link", () => {
    const years = buildFilingTimeline(
      [
        filing({ form: "8-K", filedAt: "2025-11-01", items: "2.02" }),
        filing({ form: "10-Q", filedAt: "2026-07-31", periodOfReport: "2026-06-27", url: "https://sec.gov/q3" }),
        filing({ form: "8-K", filedAt: "2026-08-21", items: "5.02" }),
      ],
      fundamentals,
    );
    expect(years.map((y) => y.year)).toEqual(["2026", "2025"]);
    expect(years[0].events.map((e) => e.date)).toEqual(["2026-08-21", "2026-07-31"]);
    expect(years[0].events[1].url).toBe("https://sec.gov/q3");
  });

  it("shows a quarterly report's moves against the same quarter a year earlier", () => {
    const [year] = buildFilingTimeline(
      [filing({ form: "10-Q", filedAt: "2026-07-31", periodOfReport: "2026-06-27" })],
      fundamentals,
    );
    expect(year.events[0]).toMatchObject({
      title: "Quarterly report for Q3 FY2026",
      period: "Q3 FY2026",
      comparedWith: "Q3 FY2025",
    });
    expect(year.events[0].highlights[0]).toBe("Revenue +10.0%");
  });

  it("shows an annual report's moves against the previous year", () => {
    const [year] = buildFilingTimeline(
      [filing({ form: "10-K", filedAt: "2025-10-31", periodOfReport: "2025-09-27" })],
      fundamentals,
    );
    expect(year.events[0]).toMatchObject({ period: "FY2025", comparedWith: "FY2024" });
    expect(year.events[0].highlights).toContain("Revenue +11.1%");
  });

  it("adds no figures for a report whose period the page does not hold", () => {
    const [year] = buildFilingTimeline(
      [filing({ form: "10-Q", filedAt: "2024-05-01", periodOfReport: "2024-03-30" })],
      fundamentals,
    );
    expect(year.events[0]).toMatchObject({ period: null, highlights: [] });
  });

  it("keeps the period each filing covers, so no separate filings table is needed", () => {
    const [year] = buildFilingTimeline(
      [filing({ form: "10-Q", filedAt: "2024-05-01", periodOfReport: "2024-03-30" })],
      fundamentals,
    );
    expect(year.events[0].periodOfReport).toBe("2024-03-30");
  });

  it("still lists every filing without any figures to hand", () => {
    const years = buildFilingTimeline([filing({ form: "10-K", periodOfReport: "2025-09-27" })], null);
    expect(years[0].events[0].highlights).toEqual([]);
  });
});
