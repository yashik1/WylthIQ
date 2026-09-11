import { describe, expect, it } from "vitest";
import { normalizeCompanyFacts } from "./normalize";
import type { SecCompanyFacts } from "./types";
import aaplRaw from "./__fixtures__/aapl.json";
import ryRaw from "./__fixtures__/ry.json";

/**
 * Quarters, read out of the same companyfacts payload as the years.
 *
 * A 10-Q reports every flow twice — for the quarter and for the year to date
 * — and repeats last year's quarter as a comparative. Both are traps: the
 * first would turn a six-month figure into a "quarter", and the second would
 * label last year's quarter with this year's filing. These tests pin both,
 * against Apple's real filings.
 */

const aapl = normalizeCompanyFacts(aaplRaw as unknown as SecCompanyFacts);
const ry = normalizeCompanyFacts(ryRaw as unknown as SecCompanyFacts);

const days = (start: string, end: string) => (Date.parse(end) - Date.parse(start)) / 86_400_000;

describe("Apple's quarters", () => {
  it("builds the latest reported quarter from its 10-Q", () => {
    const latest = aapl.quarterly![0];
    expect(latest.end).toBe("2026-06-27");
    expect(latest.fiscalPeriod).toBe("Q3");
    expect(latest.fiscalYear).toBe(2026);
    expect(latest.form).toMatch(/^10-Q/);
    expect(latest.facts.revenue).toBeDefined();
  });

  it("never builds a quarter from a year-to-date figure", () => {
    for (const q of aapl.quarterly!) {
      for (const fact of Object.values(q.facts)) {
        if (!fact?.start) continue;
        const span = days(fact.start, fact.end);
        expect(span, `${q.end} ${fact.sourceConcept}`).toBeGreaterThanOrEqual(80);
        expect(span, `${q.end} ${fact.sourceConcept}`).toBeLessThanOrEqual(100);
      }
    }
  });

  it("labels a quarter by the filing that was about it, not a later comparative", () => {
    // Q3 FY2025 is repeated as a comparative in the Q3 FY2026 10-Q, which
    // would label it FY2026 if the latest filing's label were used.
    const yearEarlier = aapl.quarterly!.find((q) => q.end === "2025-06-28");
    expect(yearEarlier).toBeDefined();
    expect(yearEarlier!.fiscalPeriod).toBe("Q3");
    expect(yearEarlier!.fiscalYear).toBe(2025);
  });

  it("invents no fourth quarter, which no company files on its own", () => {
    for (const q of aapl.quarterly!) {
      expect(q.fiscalPeriod, q.end).toMatch(/^Q[1-3]$/);
    }
  });

  it("keeps at most eight quarters, newest first", () => {
    const ends = aapl.quarterly!.map((q) => q.end);
    expect(ends.length).toBeLessThanOrEqual(8);
    expect([...ends].sort().reverse()).toEqual(ends);
  });

  it("dates each quarter by when it became public", () => {
    const latest = aapl.quarterly![0];
    expect(latest.filedAt).not.toBeNull();
    expect(latest.filedAt! >= latest.end).toBe(true);
  });

  it("leaves the annual periods as annual periods", () => {
    for (const year of aapl.annual) {
      expect(year.fiscalPeriod).toBe("FY");
    }
  });
});

describe("filers without quarters", () => {
  it("gives a Canadian 40-F filer no quarters rather than inventing them", () => {
    // Royal Bank's interim results come on 6-Ks, which carry no XBRL statements.
    expect(ry.quarterly).toEqual([]);
  });
});

describe("what a quarter is built from", () => {
  const entry = (over: Record<string, unknown>) => ({
    val: 100,
    accn: "0000320193-26-000001",
    fy: 2026,
    fp: "Q2",
    form: "10-Q",
    filed: "2026-05-01",
    ...over,
  });

  const payload = (revenue: Record<string, unknown>[]): SecCompanyFacts => ({
    cik: 1,
    entityName: "Test Co",
    facts: {
      "us-gaap": {
        Revenues: { units: { USD: revenue as never } },
      },
    },
  });

  it("ignores a six-month figure inside a quarterly filing", () => {
    const result = normalizeCompanyFacts(
      payload([entry({ start: "2025-10-01", end: "2026-03-31", val: 200 })]),
    );
    expect(result.quarterly).toEqual([]);
  });

  it("ignores a three-month figure inside an annual filing", () => {
    // Some 10-Ks include a quarterly note; its fourth quarter is not a filed
    // quarter, and the fiscal label on it would be the year's.
    const result = normalizeCompanyFacts(
      payload([entry({ start: "2025-10-01", end: "2025-12-31", form: "10-K", fp: "FY" })]),
    );
    expect(result.quarterly).toEqual([]);
  });

  it("builds a quarter from a three-month figure in a 10-Q", () => {
    const result = normalizeCompanyFacts(
      payload([entry({ start: "2026-01-01", end: "2026-03-31" })]),
    );
    expect(result.quarterly).toHaveLength(1);
    expect(result.quarterly![0]).toMatchObject({ end: "2026-03-31", fiscalPeriod: "Q2", fiscalYear: 2026 });
  });
});
