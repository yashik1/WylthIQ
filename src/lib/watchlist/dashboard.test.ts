import { describe, expect, it } from "vitest";
import type { FinancialsRow } from "../backtest/point-in-time";
import {
  alertsFor,
  buildWatchlistRow,
  filterByGroup,
  sortWatchlist,
  UNGROUPED,
  watchlistSummary,
  type CompanyScores,
  type WatchlistRow,
} from "./dashboard";
import type { SavedCompany } from "./actions";

/**
 * The watchlist dashboard.
 *
 * Pinned here: health change is only reported when it is a like-for-like
 * comparison, alerts come only from models that apply, and a company outside
 * the scored universe stays on the reader's list.
 */

const MONEY_FIELDS = [
  "assets", "liabilities", "equity", "currentAssets", "currentLiabilities", "cash",
  "receivables", "inventory", "ppe", "longTermDebt", "shortTermDebt", "retainedEarnings",
  "revenue", "costOfRevenue", "grossProfit", "operatingIncome", "netIncome",
  "incomeBeforeTax", "interestExpense", "sga", "depreciation", "operatingCashFlow",
  "capex", "dividendsPaid", "sharesOutstanding",
] as const;

function stored(fiscalYear: number, values: Partial<FinancialsRow>): FinancialsRow {
  return {
    id: fiscalYear,
    companyId: 1,
    fiscalYear,
    endDate: `${fiscalYear}-12-31`,
    form: "10-K",
    currency: "USD",
    filedAt: `${fiscalYear + 1}-02-15`,
    sourceFilingUrl: `https://www.sec.gov/filing/${fiscalYear}`,
    createdAt: new Date("2026-03-01T00:00:00Z"),
    ...Object.fromEntries(MONEY_FIELDS.map((field) => [field, null])),
    ...values,
  } as FinancialsRow;
}

const sound = {
  assets: 1000, liabilities: 400, equity: 600, currentAssets: 500, currentLiabilities: 200,
  cash: 150, receivables: 100, inventory: 80, ppe: 300, longTermDebt: 150,
  retainedEarnings: 400, revenue: 1000, costOfRevenue: 550, grossProfit: 450,
  operatingIncome: 200, netIncome: 150, incomeBeforeTax: 190, interestExpense: 10, sga: 150,
  depreciation: 40, operatingCashFlow: 220, capex: 60, sharesOutstanding: 100,
};

const struggling = {
  ...sound,
  liabilities: 900, equity: 250, currentLiabilities: 520, cash: 40, longTermDebt: 600,
  retainedEarnings: 100, revenue: 800, costOfRevenue: 550, grossProfit: 250,
  operatingIncome: -80, netIncome: -120, incomeBeforeTax: -110, operatingCashFlow: -50,
  sharesOutstanding: 130,
};

const company = (over: Partial<CompanyScores> = {}): CompanyScores => ({
  id: 1,
  symbol: "TEST",
  name: "Test Co",
  cik: "0000000001",
  country: "US",
  sectorKind: "manufacturing",
  displaySector: "Industrials",
  healthScore: 6.5,
  fScore: 5,
  fScoreMax: 9,
  zZone: "grey",
  zApplicable: true,
  mFlagged: false,
  mApplicable: true,
  peRatio: 14,
  revenueGrowth: 0.04,
  netMargin: 0.1,
  computedAt: new Date("2026-09-09T02:00:00Z"),
  ...over,
});

const saved = (symbol = "TEST", over: Partial<SavedCompany> = {}): SavedCompany => ({
  id: 1,
  symbol,
  name: null,
  addedAt: new Date("2026-06-01T00:00:00Z"),
  groupName: null,
  ...over,
});

describe("a saved company on the dashboard", () => {
  it("reports a fall in health measured on the same stored filings", () => {
    const row = buildWatchlistRow(saved(), company(), [
      stored(2025, struggling),
      stored(2024, sound),
      stored(2023, { ...sound, revenue: 900, grossProfit: 400, netIncome: 130 }),
    ]);

    expect(row.healthChange).not.toBeNull();
    expect(row.healthChange!.comparedWith).toBe(2024);
    expect(row.healthChange!.points).toBeLessThanOrEqual(-1);
    expect(row.alerts.map((a) => a.kind)).toContain("health-drop");
  });

  it("reports no health change without three consecutive years", () => {
    const twoYears = buildWatchlistRow(saved(), company(), [stored(2025, struggling), stored(2024, sound)]);
    expect(twoYears.healthChange).toBeNull();

    const gap = buildWatchlistRow(saved(), company(), [
      stored(2025, struggling),
      stored(2024, sound),
      stored(2022, sound),
    ]);
    expect(gap.healthChange).toBeNull();
  });

  it("names the largest graded move between the two latest years", () => {
    const row = buildWatchlistRow(saved(), company(), [stored(2025, struggling), stored(2024, sound)]);
    expect(row.topChange).toMatchObject({ severity: "critical", fromYear: 2024, toYear: 2025 });
    expect(row.topChange!.direction).not.toBe("neutral");
  });

  it("links the latest annual filing the figures come from", () => {
    const row = buildWatchlistRow(saved(), company(), [stored(2024, sound), stored(2025, sound)]);
    expect(row.lastFiling).toEqual({
      form: "10-K",
      fiscalYear: 2025,
      filedAt: "2026-02-15",
      url: "https://www.sec.gov/filing/2025",
    });
  });

  it("keeps a company outside the scored universe on the list, marked as not scored", () => {
    const row = buildWatchlistRow(saved("BTC-USD", { name: "Bitcoin" }), null, []);
    expect(row).toMatchObject({ symbol: "BTC-USD", name: "Bitcoin", covered: false, alerts: [] });
  });
});

describe("alerts", () => {
  it("raises accounting and distress alerts only where the model applies", () => {
    expect(alertsFor({ mApplicable: true, mFlagged: true, zApplicable: true, zZone: "distress" }, null)
      .map((a) => a.kind)).toEqual(["accounting", "distress"]);
    expect(alertsFor({ mApplicable: false, mFlagged: true, zApplicable: false, zZone: "distress" }, null))
      .toEqual([]);
  });

  it("treats a fall of less than a point as no alert", () => {
    expect(alertsFor(null, { points: -0.9, comparedWith: 2024 })).toEqual([]);
  });

  it("never advises", () => {
    const all = alertsFor(
      { mApplicable: true, mFlagged: true, zApplicable: true, zZone: "distress" },
      { points: -2, comparedWith: 2024 },
    );
    for (const alert of all) {
      expect(`${alert.label} ${alert.detail}`).not.toMatch(/\b(buy|sell|should|avoid)\b/i);
    }
  });
});

describe("sorting and grouping", () => {
  const row = (symbol: string, over: Partial<WatchlistRow>): WatchlistRow => ({
    ...buildWatchlistRow(saved(symbol), null, []),
    covered: true,
    ...over,
  });

  const rows = [
    row("AAA", { healthScore: 6, healthChange: { points: 0.5, comparedWith: 2024 }, groupName: "Dividend" }),
    row("BBB", { healthScore: null, healthChange: null }),
    row("CCC", { healthScore: 8, healthChange: { points: -1.5, comparedWith: 2024 }, groupName: "Dividend" }),
  ];

  it("puts missing health last, and the largest fall first", () => {
    expect(sortWatchlist(rows, "health").map((r) => r.symbol)).toEqual(["CCC", "AAA", "BBB"]);
    expect(sortWatchlist(rows, "health-change").map((r) => r.symbol)).toEqual(["CCC", "AAA", "BBB"]);
  });

  it("filters to a group, or to companies in no group", () => {
    expect(filterByGroup(rows, "Dividend").map((r) => r.symbol)).toEqual(["AAA", "CCC"]);
    expect(filterByGroup(rows, UNGROUPED).map((r) => r.symbol)).toEqual(["BBB"]);
    expect(filterByGroup(rows, null)).toHaveLength(3);
  });

  it("counts rises and falls separately", () => {
    expect(watchlistSummary(rows)).toMatchObject({ total: 3, healthDown: 1, healthUp: 1 });
  });
});
