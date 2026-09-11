import { eq, inArray } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { companies, financials, scores } from "../db/schema";
import { buildPointInTimeFundamentals, type FinancialsRow } from "../backtest/point-in-time";
import type { FinancialPeriod } from "../fundamentals/types";
import type { SectorKind } from "../scoring/applicability";
import { bySeverity } from "../scoring/change-thresholds";
import { comparePeriods, type Change } from "../scoring/changes";
import { buildHealthReport } from "../scoring/health";
import { ACCOUNTING_FLAG, DISTRESS_FLAG } from "../scoring/model-flags";
import type { SavedCompany } from "./actions";

/**
 * The watchlist as a dashboard: each saved company with its health, how that
 * health moved, the largest change in its figures, and anything its scores
 * say is worth a closer look.
 *
 * Read from the tables the screener already fills — never from a live API —
 * so a list of forty companies costs two queries rather than forty page loads.
 * A company outside the scored universe is still listed, marked as not scored,
 * rather than dropped: it is the reader's list, not the screener's.
 *
 * Every alert rests on a score the app already shows elsewhere. There is no
 * alert for a price move, and none that guesses at news.
 */

/** A fall of this many points in health is an alert. */
export const HEALTH_DROP = 1;

/** The scores and company details the dashboard reads for one saved company. */
export interface CompanyScores {
  id: number;
  symbol: string;
  name: string;
  cik: string | null;
  country: string | null;
  sectorKind: string;
  displaySector: string;
  healthScore: number | null;
  fScore: number | null;
  fScoreMax: number | null;
  zZone: string | null;
  zApplicable: boolean | null;
  mFlagged: boolean | null;
  mApplicable: boolean | null;
  peRatio: number | null;
  revenueGrowth: number | null;
  netMargin: number | null;
  computedAt: Date | null;
}

export type AlertKind = "accounting" | "distress" | "health-drop";

export interface WatchAlert {
  kind: AlertKind;
  label: string;
  /** What produced it, and what it does not mean. */
  detail: string;
}

export interface HealthChange {
  /** Health now minus health a year earlier, to one decimal. */
  points: number;
  /** The fiscal year it is measured against. */
  comparedWith: number;
}

export interface WatchlistRow {
  symbol: string;
  name: string | null;
  addedAt: Date;
  groupName: string | null;
  /** False for a company outside the scored universe, which has no stored figures. */
  covered: boolean;
  country: string | null;
  sector: string | null;
  healthScore: number | null;
  healthChange: HealthChange | null;
  fScore: number | null;
  fScoreMax: number | null;
  peRatio: number | null;
  revenueGrowth: number | null;
  netMargin: number | null;
  /** When the nightly pass last scored it. */
  scoredAt: Date | null;
  /** The annual filing the stored figures come from. */
  lastFiling: {
    form: string;
    fiscalYear: number;
    filedAt: string | null;
    url: string | null;
  } | null;
  /** The largest material move between the two latest fiscal years. */
  topChange: (Change & { fromYear: number; toYear: number }) | null;
  alerts: WatchAlert[];
}

const SECTOR_KINDS: ReadonlySet<string> = new Set<SectorKind>([
  "financial",
  "real-estate",
  "manufacturing",
  "other",
]);

function asSectorKind(value: string): SectorKind {
  return SECTOR_KINDS.has(value) ? (value as SectorKind) : "other";
}

/** Re-exported so the watchlist and research pages keep one import. */
export { healthRating } from "../scoring/ratings";

/**
 * The stored fiscal years as scorable periods, newest first.
 *
 * Reuses the backtest's rebuild of stored rows, but as of today — and every
 * stored year is public by today. A row from a provider that carries no filing
 * date would be dropped by that rebuild, correctly for a backtest; here its
 * period end stands in, so it is not lost.
 */
function storedYears(rows: FinancialsRow[], company: CompanyScores): FinancialPeriod[] {
  const dated = rows.map((row) => (row.filedAt ? row : { ...row, filedAt: row.endDate }));
  return (
    buildPointInTimeFundamentals(dated, company.cik ?? "", company.name, new Date("9999-12-31"))
      ?.annual ?? []
  );
}

function consecutive(later: FinancialPeriod | undefined, earlier: FinancialPeriod | undefined) {
  return Boolean(later && earlier && later.fiscalYear === earlier.fiscalYear + 1);
}

/**
 * How health moved on a year earlier.
 *
 * Both scores are computed here, from the same stored filings and both
 * without a market value, so the two are measured the same way. The stored
 * health score includes the share price in one model; comparing it against a
 * recomputed one would report a change that is only a difference in method.
 *
 * Needs three consecutive years: a score's growth and trend checks compare
 * each year with the one before it, and a year-earlier score missing that
 * comparison would not be the same measure.
 */
export function healthChangeFrom(
  years: FinancialPeriod[],
  sector: SectorKind,
  identity: { cik: string; entityName: string },
): HealthChange | null {
  if (!consecutive(years[0], years[1]) || !consecutive(years[1], years[2])) return null;

  try {
    const base = { ...identity, taxonomy: "us-gaap" as const, missingFields: [] };
    const now = buildHealthReport({ ...base, annual: years }, sector, null).score;
    const before = buildHealthReport({ ...base, annual: years.slice(1) }, sector, null).score;
    if (now == null || before == null) return null;
    const points = Math.round((now - before) * 10) / 10;
    return { points: points === 0 ? 0 : points, comparedWith: years[1].fiscalYear };
  } catch {
    return null;
  }
}

/**
 * The largest move between the two latest years that the What Changed rules
 * grade significant or critical. A rated measure is preferred over an unrated
 * one of the same grade, since "dividends paid rose" says less than "profit
 * fell" at the same size.
 */
function largestChange(years: FinancialPeriod[]): WatchlistRow["topChange"] {
  const [latest, prior] = years;
  if (!consecutive(latest, prior)) return null;

  const currency = latest.facts.revenue?.unit ?? latest.facts.assets?.unit ?? "USD";
  const large = comparePeriods(latest, prior, currency)
    .changes.filter((c) => c.severity === "critical" || c.severity === "significant")
    .sort(bySeverity);
  const top = large.find((c) => c.direction !== "neutral") ?? large[0];

  return top ? { ...top, fromYear: prior.fiscalYear, toYear: latest.fiscalYear } : null;
}

/** Alerts from the scores, and from a fall in health. */
export function alertsFor(
  company: Pick<CompanyScores, "mApplicable" | "mFlagged" | "zApplicable" | "zZone"> | null,
  healthChange: HealthChange | null,
): WatchAlert[] {
  const alerts: WatchAlert[] = [];

  // Both models first ask whether they apply. A flag from a model that does
  // not apply to a bank is not a flag.
  if (company?.mApplicable && company.mFlagged) {
    alerts.push({
      kind: "accounting",
      label: ACCOUNTING_FLAG.label,
      detail: ACCOUNTING_FLAG.text,
    });
  }
  if (company?.zApplicable && company.zZone === "distress") {
    alerts.push({
      kind: "distress",
      label: DISTRESS_FLAG.label,
      detail: DISTRESS_FLAG.text,
    });
  }
  if (healthChange && healthChange.points <= -HEALTH_DROP) {
    alerts.push({
      kind: "health-drop",
      label: "Health down",
      detail: `Its health score is ${Math.abs(healthChange.points).toFixed(1)} points lower than for FY${healthChange.comparedWith}, on the same stored filings.`,
    });
  }

  return alerts;
}

/** One saved company as the dashboard shows it. */
export function buildWatchlistRow(
  saved: SavedCompany,
  company: CompanyScores | null,
  rows: FinancialsRow[],
): WatchlistRow {
  const base = {
    symbol: saved.symbol,
    name: saved.name ?? company?.name ?? null,
    addedAt: saved.addedAt,
    groupName: saved.groupName,
  };

  if (!company) {
    return {
      ...base,
      covered: false,
      country: null,
      sector: null,
      healthScore: null,
      healthChange: null,
      fScore: null,
      fScoreMax: null,
      peRatio: null,
      revenueGrowth: null,
      netMargin: null,
      scoredAt: null,
      lastFiling: null,
      topChange: null,
      alerts: [],
    };
  }

  const years = storedYears(rows, company);
  const healthChange = healthChangeFrom(years, asSectorKind(company.sectorKind), {
    cik: company.cik ?? "",
    entityName: company.name,
  });
  const latestRow = [...rows].sort((a, b) => b.fiscalYear - a.fiscalYear)[0];

  return {
    ...base,
    covered: true,
    country: company.country,
    sector: company.displaySector,
    healthScore: company.healthScore,
    healthChange,
    fScore: company.fScore,
    fScoreMax: company.fScoreMax,
    peRatio: company.peRatio,
    revenueGrowth: company.revenueGrowth,
    netMargin: company.netMargin,
    scoredAt: company.computedAt,
    lastFiling: latestRow
      ? {
          form: latestRow.form ?? "Annual report",
          fiscalYear: latestRow.fiscalYear,
          filedAt: latestRow.filedAt,
          url: latestRow.sourceFilingUrl,
        }
      : null,
    topChange: largestChange(years),
    alerts: alertsFor(company, healthChange),
  };
}

export const WATCHLIST_SORTS = {
  added: "Newest saved",
  symbol: "Symbol",
  health: "Health",
  "health-change": "Largest health fall",
  alerts: "Alerts first",
  filed: "Latest filing",
} as const;

export type WatchlistSort = keyof typeof WATCHLIST_SORTS;

/** Missing values always sort last, whichever way the column runs. */
function nullsLast(a: number | null, b: number | null, direction: 1 | -1): number {
  if (a == null) return b == null ? 0 : 1;
  if (b == null) return -1;
  return (a - b) * direction;
}

export function sortWatchlist(rows: WatchlistRow[], sort: WatchlistSort): WatchlistRow[] {
  const out = [...rows];
  switch (sort) {
    case "symbol":
      return out.sort((a, b) => a.symbol.localeCompare(b.symbol));
    case "health":
      return out.sort((a, b) => nullsLast(a.healthScore, b.healthScore, -1));
    case "health-change":
      return out.sort((a, b) =>
        nullsLast(a.healthChange?.points ?? null, b.healthChange?.points ?? null, 1),
      );
    case "alerts":
      return out.sort(
        (a, b) => b.alerts.length - a.alerts.length || nullsLast(a.healthScore, b.healthScore, 1),
      );
    case "filed":
      return out.sort((a, b) =>
        (b.lastFiling?.filedAt ?? "").localeCompare(a.lastFiling?.filedAt ?? ""),
      );
    case "added":
      return out.sort((a, b) => b.addedAt.getTime() - a.addedAt.getTime());
  }
}

/** The group filter's value for companies filed under no group. */
export const UNGROUPED = "__ungrouped";

export function filterByGroup(rows: WatchlistRow[], group: string | null): WatchlistRow[] {
  if (!group) return rows;
  if (group === UNGROUPED) return rows.filter((row) => !row.groupName);
  return rows.filter((row) => row.groupName === group);
}

export function watchlistSummary(rows: WatchlistRow[]) {
  return {
    total: rows.length,
    withAlerts: rows.filter((row) => row.alerts.length > 0).length,
    healthDown: rows.filter((row) => (row.healthChange?.points ?? 0) < 0).length,
    healthUp: rows.filter((row) => (row.healthChange?.points ?? 0) > 0).length,
  };
}

/**
 * Loads the dashboard for a reader's saved companies.
 *
 * Two queries whatever the list's length: the companies with their scores,
 * then every stored year for those companies. A failure lists every company as
 * not scored rather than failing the page.
 */
export async function loadWatchlist(saved: SavedCompany[]): Promise<WatchlistRow[]> {
  if (saved.length === 0) return [];
  const unscored = () => saved.map((entry) => buildWatchlistRow(entry, null, []));
  if (!isDatabaseConfigured()) return unscored();

  try {
    const db = getDb();
    const found: CompanyScores[] = await db
      .select({
        id: companies.id,
        symbol: companies.symbol,
        name: companies.name,
        cik: companies.cik,
        country: companies.country,
        sectorKind: companies.sectorKind,
        displaySector: companies.displaySector,
        healthScore: scores.healthScore,
        fScore: scores.fScore,
        fScoreMax: scores.fScoreMax,
        zZone: scores.zZone,
        zApplicable: scores.zApplicable,
        mFlagged: scores.mFlagged,
        mApplicable: scores.mApplicable,
        peRatio: scores.peRatio,
        revenueGrowth: scores.revenueGrowth,
        netMargin: scores.netMargin,
        computedAt: scores.computedAt,
      })
      .from(companies)
      .leftJoin(scores, eq(scores.companyId, companies.id))
      .where(inArray(companies.symbol, saved.map((entry) => entry.symbol)));

    const ids = found.map((company) => company.id);
    const stored = ids.length > 0
      ? await db.select().from(financials).where(inArray(financials.companyId, ids))
      : [];

    const rowsByCompany = new Map<number, FinancialsRow[]>();
    for (const row of stored) {
      const list = rowsByCompany.get(row.companyId);
      if (list) list.push(row);
      else rowsByCompany.set(row.companyId, [row]);
    }

    const bySymbol = new Map(found.map((company) => [company.symbol, company]));
    return saved.map((entry) => {
      const company = bySymbol.get(entry.symbol) ?? null;
      return buildWatchlistRow(entry, company, company ? (rowsByCompany.get(company.id) ?? []) : []);
    });
  } catch {
    return unscored();
  }
}
