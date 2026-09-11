import { describe, expect, it } from "vitest";
import { normalizeCompanyFacts } from "./normalize";
import { snapshotAsOf, snapshotPeriods } from "./as-reported";
import type { SecCompanyFacts, SecFactEntry } from "./types";

/**
 * Figures as they were first published.
 *
 * The case that matters: a later annual report restates an earlier year. The
 * live figures must carry the restatement, and the earlier year's snapshot
 * must not — or every "a year ago" on the page would be today's knowledge
 * dressed up as last year's.
 */

const flow = (year: number, val: number, filed: string, fy = year): SecFactEntry => ({
  start: `${year}-01-01`,
  end: `${year}-12-31`,
  val,
  form: "10-K",
  fy,
  fp: "FY",
  filed,
});

const instant = (year: number, val: number, filed: string, fy = year): SecFactEntry => ({
  end: `${year}-12-31`,
  val,
  form: "10-K",
  fy,
  fp: "FY",
  filed,
});

function payload(concepts: Record<string, SecFactEntry[]>): SecCompanyFacts {
  return {
    cik: 1,
    entityName: "Test Co",
    facts: {
      "us-gaap": Object.fromEntries(
        Object.entries(concepts).map(([concept, entries]) => [concept, { units: { USD: entries } }]),
      ),
    },
  };
}

// Three annual reports. The FY2024 report restates FY2023 revenue from 100 to 80.
const raw = payload({
  Revenues: [
    flow(2022, 90, "2023-02-01"),
    flow(2023, 100, "2024-02-01"),
    flow(2022, 90, "2024-02-01", 2023),
    flow(2024, 120, "2025-02-01"),
    flow(2023, 80, "2025-02-01", 2024),
  ],
  NetIncomeLoss: [
    flow(2022, 9, "2023-02-01"),
    flow(2023, 10, "2024-02-01"),
    flow(2024, 12, "2025-02-01"),
    flow(2023, 10, "2025-02-01", 2024),
  ],
  Assets: [
    instant(2022, 180, "2023-02-01"),
    instant(2023, 200, "2024-02-01"),
    instant(2024, 220, "2025-02-01"),
    instant(2023, 200, "2025-02-01", 2024),
  ],
});

describe("figures as first reported", () => {
  const live = normalizeCompanyFacts(raw);

  it("keeps the restatement in the live figures", () => {
    expect(live.annual.map((p) => p.fiscalYear)).toEqual([2024, 2023, 2022]);
    expect(live.annual[1].facts.revenue?.value).toBe(80);
  });

  it("dates each snapshot to the day that year's report was filed", () => {
    expect(live.asReported?.map((s) => [s.fiscalYear, s.asOf])).toEqual([
      [2024, "2025-02-01"],
      [2023, "2024-02-01"],
      [2022, "2023-02-01"],
    ]);
  });

  it("does not read a later restatement into an earlier report", () => {
    const fy2023 = live.asReported!.find((s) => s.fiscalYear === 2023)!;
    expect(fy2023.periods.map((p) => p.fiscalYear)).toEqual([2023, 2022]);
    expect(fy2023.periods[0].values.revenue).toBe(100);

    const fy2024 = live.asReported!.find((s) => s.fiscalYear === 2024)!;
    expect(fy2024.periods[1].values.revenue).toBe(80);
  });

  it("finds the snapshot that was public on a date, and none before the first", () => {
    expect(snapshotAsOf(live, "2024-06-30")?.fiscalYear).toBe(2023);
    expect(snapshotAsOf(live, "2025-02-01")?.fiscalYear).toBe(2024);
    expect(snapshotAsOf(live, "2023-01-15")).toBeNull();
  });

  it("marks a rebuilt period with the snapshot's own date", () => {
    const [period] = snapshotPeriods(snapshotAsOf(live, "2024-06-30")!);
    expect(period.facts.revenue).toMatchObject({ value: 100, filed: "2024-02-01", sourceConcept: "as-reported" });
  });

  it("rebuilds as of a date with only what had been filed by then", () => {
    const then = normalizeCompanyFacts(raw, { asOf: "2024-02-01" });
    expect(then.annual.map((p) => p.fiscalYear)).toEqual([2023, 2022]);
    expect(then.annual[0].facts.revenue?.value).toBe(100);
    expect(then.quarterly).toEqual([]);
    expect(then.asReported).toBeUndefined();
  });

  it("ignores an observation with no filing date when rebuilding", () => {
    const undated = payload({
      Revenues: [{ ...flow(2023, 50, "2024-02-01"), filed: undefined }],
      Assets: [instant(2023, 70, "2024-02-01")],
    });
    const then = normalizeCompanyFacts(undated, { asOf: "2030-01-01" });
    expect(then.annual[0].facts.revenue).toBeUndefined();
    expect(then.annual[0].facts.assets?.value).toBe(70);
  });
});
