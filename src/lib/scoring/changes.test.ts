import { describe, expect, it } from "vitest";
import { buildChangeReport, type Change } from "./changes";
import type {
  CanonicalField,
  FinancialPeriod,
  NormalizedFundamentals,
} from "../fundamentals/types";

/**
 * Year-on-year comparison.
 *
 * Most of these tests are about the sign of a number rather than its size,
 * because that is where a naive difference goes wrong in a way nobody notices
 * until it is on a public page. A company recovering from a $100M loss to a
 * $50M profit has not changed by "-150%", and the same expression hands a
 * company collapsing from profit into loss a cheerful positive percentage.
 * Both readings are arithmetically defensible and both are useless.
 */

const period = (
  fiscalYear: number,
  values: Partial<Record<CanonicalField, number>>,
): FinancialPeriod => ({
  fiscalYear,
  fiscalPeriod: "FY",
  end: `${fiscalYear}-12-31`,
  form: "10-K",
  filedAt: `${fiscalYear + 1}-02-15`,
  facts: Object.fromEntries(
    Object.entries(values).map(([field, value]) => [
      field,
      {
        value,
        unit: "USD",
        end: `${fiscalYear}-12-31`,
        fiscalYear,
        fiscalPeriod: "FY",
        form: "10-K",
        sourceConcept: `us-gaap:${field}`,
        sourceFilingUrl: "https://sec.gov/filing",
      },
    ]),
  ) as FinancialPeriod["facts"],
});

const company = (
  latest: Partial<Record<CanonicalField, number>>,
  prior?: Partial<Record<CanonicalField, number>>,
): NormalizedFundamentals => ({
  cik: "0000320193",
  entityName: "Test Co",
  taxonomy: "us-gaap",
  annual: prior ? [period(2025, latest), period(2024, prior)] : [period(2025, latest)],
  missingFields: [],
});

const find = (fundamentals: NormalizedFundamentals, key: string): Change | undefined =>
  buildChangeReport(fundamentals)?.changes.find((c) => c.key === key);

describe("what changed", () => {
  it("has nothing to say about a company with only one filed year", () => {
    // Not the same as "nothing changed" — there is no second period to compare
    // against, and an empty panel would be a claim about the company.
    expect(buildChangeReport(company({ revenue: 100 }))).toBeNull();
  });

  it("names the two years it compared", () => {
    const report = buildChangeReport(company({ revenue: 120 }, { revenue: 100 }))!;
    expect(report.fromYear).toBe(2024);
    expect(report.toYear).toBe(2025);
    expect(report.form).toBe("10-K");
  });

  it("reports a material move and counts a trivial one as steady", () => {
    const moved = buildChangeReport(company({ revenue: 120 }, { revenue: 100 }))!;
    expect(moved.changes.map((c) => c.key)).toContain("revenue");
    expect(find(company({ revenue: 120 }, { revenue: 100 }), "revenue")!.delta).toBe("+20.0%");

    // Under the band: counted, not listed, so "little moved" stays sayable.
    const flat = buildChangeReport(company({ revenue: 101 }, { revenue: 100 }))!;
    expect(flat.changes.map((c) => c.key)).not.toContain("revenue");
    expect(flat.steady).toBeGreaterThan(0);
  });
});

describe("figures that cross zero", () => {
  it("does not express a recovery from a loss as a percentage", () => {
    const change = find(company({ netIncome: 50 }, { netIncome: -100 }), "netIncome")!;

    expect(change.delta).toBe("turned positive");
    expect(change.direction).toBe("better");
    // The specific bug: (50 − −100) / |−100| = +150%, a number that describes
    // nothing a reader can use.
    expect(change.delta).not.toMatch(/%/);
  });

  it("does not express a collapse into loss as a gain", () => {
    const change = find(company({ netIncome: -100 }, { netIncome: 50 }), "netIncome")!;

    expect(change.delta).toBe("turned negative");
    expect(change.direction).toBe("worse");
    expect(change.delta).not.toMatch(/%/);
  });

  it("always reports a sign change, however small the amount", () => {
    // Below the materiality band in absolute terms, and still the largest thing
    // that happened to this company all year.
    const change = find(company({ netIncome: 1 }, { netIncome: -1 }), "netIncome");
    expect(change).toBeDefined();
    expect(change!.direction).toBe("better");
  });

  it("describes a loss that deepened as wider, not as a percentage", () => {
    const change = find(company({ netIncome: -300 }, { netIncome: -100 }), "netIncome")!;
    expect(change.delta).toContain("wider");
    expect(change.direction).toBe("worse");
    expect(change.delta).not.toMatch(/%/);
  });

  it("describes a loss that shrank as narrower", () => {
    const change = find(company({ netIncome: -100 }, { netIncome: -300 }), "netIncome")!;
    expect(change.delta).toContain("narrower");
    expect(change.direction).toBe("better");
  });

  it("never prints a percentage anywhere a figure crossed zero", () => {
    for (const [to, from] of [
      [50, -100],
      [-100, 50],
      [-300, -100],
      [-100, -300],
      [1, -1],
    ] as const) {
      const change = find(company({ netIncome: to }, { netIncome: from }), "netIncome");
      expect(change?.delta ?? "", `${from} → ${to}`).not.toMatch(/%/);
    }
  });
});

describe("margins", () => {
  it("reports margins in points rather than as a relative change", () => {
    // 2% to 3% is "up 50%" relatively, which sounds enormous and is one point.
    const change = find(
      company(
        { revenue: 100, netIncome: 3 },
        { revenue: 100, netIncome: 2 },
      ),
      "netMargin",
    )!;

    expect(change.delta).toBe("+1.0 pts");
    expect(change.delta).not.toContain("50");
    expect(change.from).toBe("2.0%");
    expect(change.to).toBe("3.0%");
  });

  it("marks a falling margin as worse", () => {
    const change = find(
      company({ revenue: 100, grossProfit: 30 }, { revenue: 100, grossProfit: 40 }),
      "grossMargin",
    )!;
    expect(change.direction).toBe("worse");
    expect(change.delta).toBe("−10.0 pts");
  });
});

describe("direction", () => {
  it("treats more shares as worse and fewer as better", () => {
    // The one line on the page where up is bad, because the company is divided
    // into them.
    const diluted = find(
      company({ sharesOutstanding: 110 }, { sharesOutstanding: 100 }),
      "sharesOutstanding",
    )!;
    expect(diluted.direction).toBe("worse");

    const boughtBack = find(
      company({ sharesOutstanding: 90 }, { sharesOutstanding: 100 }),
      "sharesOutstanding",
    )!;
    expect(boughtBack.direction).toBe("better");
  });

  it("treats rising debt as worse, while saying it need not be", () => {
    const change = find(company({ longTermDebt: 200 }, { longTermDebt: 100 }), "longTermDebt")!;
    expect(change.direction).toBe("worse");
    expect(change.meaning).toMatch(/not automatically bad/i);
  });

  it("refuses to rate capital spending in either direction", () => {
    // Building capacity and struggling to stand still produce the same figure.
    for (const [to, from] of [[200, 100], [100, 200]] as const) {
      const change = find(company({ capex: to }, { capex: from }), "capex")!;
      expect(change.direction).toBe("neutral");
    }
  });

  it("reads capex as a magnitude whichever sign the filer tagged it with", () => {
    const positive = find(company({ capex: 200 }, { capex: 100 }), "capex")!;
    const negative = find(company({ capex: -200 }, { capex: -100 }), "capex")!;
    expect(negative.delta).toBe(positive.delta);
  });
});

describe("missing data", () => {
  it("says nothing about a figure only one side reported", () => {
    // A figure absent from one year is not a change to zero.
    expect(find(company({ revenue: 120 }, {}), "revenue")).toBeUndefined();
    expect(find(company({}, { revenue: 100 }), "revenue")).toBeUndefined();
  });

  it("still reports the figures that are present", () => {
    const report = buildChangeReport(
      company({ revenue: 120, cash: 50 }, { revenue: 100 }),
    )!;
    expect(report.changes.map((c) => c.key)).toEqual(["revenue"]);
  });

  it("computes free cash flow from operating cash flow and capital spending", () => {
    const change = find(
      company(
        { operatingCashFlow: 200, capex: 50 },
        { operatingCashFlow: 150, capex: 50 },
      ),
      "freeCashFlow",
    )!;
    // 150 against 100 — a 50% improvement.
    expect(change.delta).toBe("+50.0%");
    expect(change.direction).toBe("better");
  });
});

describe("what it will not claim", () => {
  it("never tells the reader what to do", () => {
    const report = buildChangeReport(
      company(
        { revenue: 120, netIncome: -50, longTermDebt: 300, sharesOutstanding: 110 },
        { revenue: 100, netIncome: 20, longTermDebt: 100, sharesOutstanding: 100 },
      ),
    )!;

    for (const change of report.changes) {
      const prose = `${change.label} ${change.meaning}`;
      expect(prose, change.key).not.toMatch(/\b(buy|sell|hold|should|recommend|avoid)\b/i);
    }
  });

  it("gives every reported change a reason it might not matter", () => {
    const report = buildChangeReport(
      company(
        { revenue: 120, netIncome: 30, cash: 500, longTermDebt: 300 },
        { revenue: 100, netIncome: 20, cash: 900, longTermDebt: 100 },
      ),
    )!;

    expect(report.changes.length).toBeGreaterThan(0);
    for (const change of report.changes) {
      expect(change.meaning.length, change.key).toBeGreaterThan(40);
    }
  });
});
