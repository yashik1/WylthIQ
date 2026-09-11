import { and, asc, desc, eq, gte, isNotNull, lte, or, sql, type SQL } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "./db";
import { companies, scores } from "./db/schema";

/**
 * One-click screens, written the way someone would actually ask the question.
 *
 * These are the entry point for people who do not know which ratio to filter
 * on — the whole reason this product exists.
 */
export const PRESETS = {
  healthy: {
    label: "Financial health",
    description:
      "Strong finances across profitability, debt and accounting quality, and improving on most standard checks.",
    looksFor: [
      "A health score of 7.5 or more out of 10",
      "A Piotroski F-Score of 6 or more out of 9",
    ],
    doesNotTell:
      "Whether the share price is reasonable, or whether the business will keep improving. It reads the latest annual filing, which can be months old.",
  },
  growing: {
    label: "Growth",
    description: "Sales up sharply on last year, without obvious financial strain.",
    looksFor: [
      "Revenue up 15% or more on the previous year",
      "A health score of at least 5, so the growth is not arriving with obvious strain",
    ],
    doesNotTell:
      "Whether the growth is profitable or can last. One strong year can come from an acquisition, and growth in earnings per share and free cash flow is not screened here.",
  },
  "cheap-profitable": {
    label: "Value",
    description: "Making real money, but priced modestly against those profits.",
    looksFor: [
      "A P/E between 0 and 18",
      "A profit margin of at least 5%",
      "A health score of at least 6",
    ],
    doesNotTell:
      "Why the price is low. A low P/E can reflect a business the market expects to shrink, and price to free cash flow and EV/EBITDA are not screened here.",
  },
  dividend: {
    label: "Dividend",
    description: "Returns cash to shareholders and stays financially sound.",
    looksFor: [
      "A dividend yield of 1.5% or more",
      "A health score of at least 5.5",
    ],
    doesNotTell:
      "Whether the dividend is covered by free cash flow or will be kept. The yield is trailing, and a falling share price raises it on its own.",
  },
  quality: {
    label: "Quality",
    description: "High margins and returns, carried on a moderate balance sheet.",
    looksFor: [
      "A profit margin of 15% or more",
      "A return on assets of 8% or more",
      "Liabilities no more than 1.5 times equity",
      "A health score of at least 7",
    ],
    doesNotTell:
      "Whether that quality is already reflected in the price, or how durable the returns are. Return on invested capital and free cash flow are not screened here.",
  },
  "red-flags": {
    label: "Red flags",
    description:
      "Companies showing financial distress or unusual accounting. Shown so they are not a surprise, not as targets.",
    looksFor: [
      "An accounting flag from the Beneish M-Score",
      "Or a distress reading from the Altman Z-Score",
      "Or a health score of 4 or less",
    ],
    doesNotTell:
      "That anything is actually wrong. Each is a statistical screen or a weak score — a prompt to read the filings, not evidence of a problem.",
  },
} as const;

export type PresetKey = keyof typeof PRESETS;

/**
 * Columns each preset cannot work without.
 *
 * Several are derived from market capitalisation, which is only populated when a
 * price source was configured at ingest time. Without one, every P/E and
 * dividend yield in the table is null and those presets match nothing at all —
 * which looked identical to "no company qualifies". Declaring the dependency
 * lets the UI say which it is.
 */
const PRESET_REQUIRES: Partial<Record<PresetKey, { column: string; needs: string }>> = {
  "cheap-profitable": {
    column: "pe_ratio",
    needs: "a share price, to compare against profits",
  },
  dividend: {
    column: "dividend_yield",
    needs: "a share price, to express dividends as a yield",
  },
};

export const SORTS = {
  health: { label: "Healthiest first", column: scores.healthScore, dir: "desc" },
  "market-cap": { label: "Largest first", column: scores.marketCap, dir: "desc" },
  pe: { label: "Lowest P/E", column: scores.peRatio, dir: "asc" },
  growth: { label: "Fastest growing", column: scores.revenueGrowth, dir: "desc" },
  margin: { label: "Highest margin", column: scores.netMargin, dir: "desc" },
  movers: { label: "Biggest movers today", column: scores.changePercent, dir: "desc" },
} as const;

export type SortKey = keyof typeof SORTS;

export interface ScreenFilters {
  preset?: PresetKey;
  /**
   * A familiar market sector — Technology, Energy, Health Care.
   *
   * Matches `displaySector`, not `sectorKind`. The latter is a four-bucket
   * scoring concept (financial / real-estate / manufacturing / other) that
   * exists to gate the Altman and Beneish models, and it was what the
   * screener's visible "Sector" dropdown filtered on — which meant the sector
   * a reader picked on the dashboard heatmap had nothing on this page to
   * match it against.
   */
  sector?: string;
  country?: string;
  minHealth?: number;
  maxPe?: number;
  minFScore?: number;
  minMarketCap?: number;
  minGrowth?: number;
  sort?: SortKey;

  /* ------------------------------------------------------------ advanced
   *
   * The Pro filters. Every one of them reads a column already computed by the
   * nightly pass from SEC filings, which is the whole reason this set can be
   * sold at all — nothing here touches a price feed licensed for personal use.
   * They cost no extra query either: this is the same single scan with more
   * predicates on it.
   *
   * Named for the direction a reader thinks in — "at most this expensive",
   * "at least this profitable" — rather than for the column, so the form and
   * the URL read the same way round as the question.
   */
  maxPb?: number;
  maxPs?: number;
  minDividendYield?: number;
  minNetMargin?: number;
  minRoa?: number;
  maxDebtToEquity?: number;
  minCurrentRatio?: number;
  /** Only companies Altman puts in the safe zone, where the model applies. */
  safeZoneOnly?: boolean;
  /** Drop anything Beneish flags, where the model applies. */
  excludeAccountingFlags?: boolean;
}

/** Which filters are Pro-only, so one list governs the form, the URL and the gate. */
export const ADVANCED_FILTER_KEYS = [
  "maxPb",
  "maxPs",
  "minDividendYield",
  "minNetMargin",
  "minRoa",
  "maxDebtToEquity",
  "minCurrentRatio",
  "safeZoneOnly",
  "excludeAccountingFlags",
] as const satisfies readonly (keyof ScreenFilters)[];

/** True when a filter set uses anything beyond the free dimensions. */
export function usesAdvancedFilters(filters: ScreenFilters): boolean {
  return ADVANCED_FILTER_KEYS.some((key) => filters[key] != null && filters[key] !== false);
}

/**
 * The filter set with every Pro-only dimension removed.
 *
 * Applied server-side to anyone without the entitlement, so a hand-edited URL
 * returns the free screen rather than the paid one. The alternative — refusing
 * the request — punishes somebody for a link they were sent, and this is a
 * page whose whole job is to be shareable.
 */
export function withoutAdvancedFilters(filters: ScreenFilters): ScreenFilters {
  const trimmed = { ...filters };
  for (const key of ADVANCED_FILTER_KEYS) delete trimmed[key];
  return trimmed;
}

export interface ScreenRow {
  symbol: string;
  name: string;
  sectorKind: string;
  displaySector: string;
  industry: string | null;
  country: string | null;
  healthScore: number | null;
  headline: string | null;
  /** Latest quote, refreshed by the quotes cron rather than the nightly pass. */
  price: number | null;
  changePercent: number | null;
  fScore: number | null;
  fScoreMax: number | null;
  zZone: string | null;
  mFlagged: boolean | null;
  marketCap: number | null;
  peRatio: number | null;
  revenueGrowth: number | null;
  netMargin: number | null;
  debtToEquity: number | null;

  /* The columns the advanced filters work on. Selected so an export can show
     what a screen was actually filtered by — a CSV that hides the column
     somebody screened on is a strange thing to hand them. Same query, more
     projection; no extra cost. */
  zScore: number | null;
  zApplicable: boolean;
  mScore: number | null;
  mApplicable: boolean;
  pbRatio: number | null;
  psRatio: number | null;
  dividendYield: number | null;
  returnOnAssets: number | null;
  currentRatio: number | null;
}

/**
 * Why a screen returned nothing.
 *
 * These were previously collapsed into `empty`, which meant a database with no
 * tables looked identical to one that was simply not populated yet — and sent
 * people off to re-run an ingest that could never work. Each cause now reports
 * itself.
 */
export type ScreenStatus =
  | "ok"
  /** DATABASE_URL is not set at all. */
  | "no-database"
  /** Connected, tables exist, but no companies have been ingested. */
  | "empty"
  /** Connected, but the tables do not exist — migrations never ran. */
  | "no-tables"
  /** Could not reach or authenticate against the database. */
  | "connection-error";

export interface ScreenResult {
  status: ScreenStatus;
  rows: ScreenRow[];
  total: number;
  /** Safe error detail for the UI. Never contains credentials. */
  detail?: string;
  /**
   * Set when a preset returned nothing because the data it needs was never
   * populated, rather than because no company qualified.
   */
  missingData?: { needs: string };
}

/**
 * Finds the underlying driver error.
 *
 * Drizzle wraps failures in a DrizzleQueryError whose message is the full SQL
 * text and whose `code` is undefined — the Postgres error code lives on
 * `.cause`. Reading only the outer error misclassifies every failure and dumps
 * an unreadable query at the user, so the chain is walked to the root.
 */
function rootCause(err: unknown): { code?: string; message: string } {
  let current: unknown = err;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const code = (current as { code?: string }).code;
    if (typeof code === "string" && code.length > 0) {
      return { code, message: (current as Error).message ?? String(current) };
    }
    current = (current as { cause?: unknown }).cause;
  }

  return { message: err instanceof Error ? err.message : String(err) };
}

/** Maps a driver error onto the specific cause, so the UI can be precise. */
function classifyDbError(err: unknown): { status: ScreenStatus; detail: string } {
  const { code, message } = rootCause(err);

  // 42P01 undefined_table — the schema was never created.
  if (code === "42P01") {
    return {
      status: "no-tables",
      detail: "The database is reachable but the tables do not exist yet.",
    };
  }
  if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "ETIMEDOUT") {
    return {
      status: "connection-error",
      detail:
        "Could not reach the database. If the host ends in .railway.internal it only " +
        "resolves inside Railway — from elsewhere use the public connection string.",
    };
  }
  if (code === "28P01") {
    return {
      status: "connection-error",
      detail: "The database rejected the password in DATABASE_URL.",
    };
  }
  if (code === "3D000") {
    return {
      status: "connection-error",
      detail: "That database name does not exist on the server.",
    };
  }
  return {
    status: "connection-error",
    detail: safeDetail(message),
  };
}

/**
 * Prepares an error message for display: strips anything resembling a
 * connection string, drops the SQL body Drizzle appends, and truncates.
 */
function safeDetail(message: string): string {
  const withoutSql = message.replace(/Failed query:[\s\S]*/i, "").trim();
  const cleaned = (withoutSql || message)
    .replace(/postgres(ql)?:\/\/\S+/gi, "[connection string]")
    .trim();
  return cleaned.length > 300 ? `${cleaned.slice(0, 300)}…` : cleaned;
}

/** Translates a preset into concrete conditions. */
function presetConditions(preset: PresetKey): SQL[] {
  switch (preset) {
    case "healthy":
      return [gte(scores.healthScore, 7.5)];
    case "cheap-profitable":
      return [
        isNotNull(scores.peRatio),
        gte(scores.peRatio, 0),
        lte(scores.peRatio, 18),
        gte(scores.netMargin, 0.05),
        gte(scores.healthScore, 6),
      ];
    case "growing":
      return [gte(scores.revenueGrowth, 0.15), gte(scores.healthScore, 5)];
    case "dividend":
      return [gte(scores.dividendYield, 0.015), gte(scores.healthScore, 5.5)];
    case "quality":
      // Non-null debt required for the reason the advanced filter requires
      // it: a null fails the comparison silently rather than visibly.
      return [
        gte(scores.netMargin, 0.15),
        gte(scores.returnOnAssets, 0.08),
        isNotNull(scores.debtToEquity),
        gte(scores.debtToEquity, 0),
        lte(scores.debtToEquity, 1.5),
        gte(scores.healthScore, 7),
      ];
    case "red-flags":
      // Any one of these is enough to warrant a closer look.
      return [
        or(
          eq(scores.mFlagged, true),
          eq(scores.zZone, "distress"),
          lte(scores.healthScore, 4),
        )!,
      ];
  }
}

/**
 * Runs a screen against the precomputed scores table.
 *
 * Reads only from the database — no external API calls — which is what lets a
 * universe-wide filter return instantly and for free.
 */
export async function runScreen(filters: ScreenFilters, limit = 100): Promise<ScreenResult> {
  if (!isDatabaseConfigured()) {
    return { status: "no-database", rows: [], total: 0 };
  }

  const db = getDb();
  const conditions: SQL[] = [eq(companies.isActive, true)];

  if (filters.preset) conditions.push(...presetConditions(filters.preset));
  if (filters.sector) conditions.push(eq(companies.displaySector, filters.sector));
  if (filters.country) conditions.push(eq(companies.country, filters.country));
  if (filters.minHealth != null) conditions.push(gte(scores.healthScore, filters.minHealth));
  if (filters.maxPe != null) {
    conditions.push(isNotNull(scores.peRatio), gte(scores.peRatio, 0), lte(scores.peRatio, filters.maxPe));
  }
  if (filters.minFScore != null) conditions.push(gte(scores.fScore, filters.minFScore));
  if (filters.minMarketCap != null) conditions.push(gte(scores.marketCap, filters.minMarketCap));
  if (filters.minGrowth != null) conditions.push(gte(scores.revenueGrowth, filters.minGrowth));

  /*
    The advanced set. Each ratio filter also requires the column to be
    non-null, for the reason the P/E filter above already does: in SQL a null
    fails a comparison rather than passing it, so "P/B under 3" would silently
    drop every company that never reported a book value — which reads to a
    user as those companies not existing rather than as data being absent.
    Requiring non-null makes that explicit rather than accidental.
  */
  if (filters.maxPb != null) {
    conditions.push(isNotNull(scores.pbRatio), gte(scores.pbRatio, 0), lte(scores.pbRatio, filters.maxPb));
  }
  if (filters.maxPs != null) {
    conditions.push(isNotNull(scores.psRatio), gte(scores.psRatio, 0), lte(scores.psRatio, filters.maxPs));
  }
  if (filters.minDividendYield != null) {
    conditions.push(gte(scores.dividendYield, filters.minDividendYield));
  }
  if (filters.minNetMargin != null) conditions.push(gte(scores.netMargin, filters.minNetMargin));
  if (filters.minRoa != null) conditions.push(gte(scores.returnOnAssets, filters.minRoa));
  if (filters.maxDebtToEquity != null) {
    conditions.push(
      isNotNull(scores.debtToEquity),
      gte(scores.debtToEquity, 0),
      lte(scores.debtToEquity, filters.maxDebtToEquity),
    );
  }
  if (filters.minCurrentRatio != null) {
    conditions.push(gte(scores.currentRatio, filters.minCurrentRatio));
  }

  /*
    The two model filters both require the model to apply before reading its
    verdict. Altman's Z is not meaningful for a bank and Beneish's M is not
    meaningful for a financial either, which is why those rows carry an
    `applicable` flag at all — and a filter that ignored it would quietly
    treat "the model does not apply here" as "the model says this is fine".
  */
  if (filters.safeZoneOnly) {
    conditions.push(eq(scores.zApplicable, true), eq(scores.zZone, "safe"));
  }
  if (filters.excludeAccountingFlags) {
    conditions.push(
      or(eq(scores.mApplicable, false), eq(scores.mFlagged, false)) as SQL,
    );
  }

  const sort = SORTS[filters.sort ?? "health"];
  // NULLS LAST everywhere: a company with no data should never top a ranking.
  const orderBy =
    sort.dir === "desc"
      ? sql`${sort.column} DESC NULLS LAST`
      : sql`${sort.column} ASC NULLS LAST`;

  try {
    const rows = await db
      .select({
        symbol: companies.symbol,
        name: companies.name,
        sectorKind: companies.sectorKind,
        displaySector: companies.displaySector,
        industry: companies.industry,
        country: companies.country,
        healthScore: scores.healthScore,
        headline: scores.headline,
        price: scores.price,
        changePercent: scores.changePercent,
        fScore: scores.fScore,
        fScoreMax: scores.fScoreMax,
        zZone: scores.zZone,
        mFlagged: scores.mFlagged,
        marketCap: scores.marketCap,
        peRatio: scores.peRatio,
        revenueGrowth: scores.revenueGrowth,
        netMargin: scores.netMargin,
        debtToEquity: scores.debtToEquity,
        zScore: scores.zScore,
        zApplicable: scores.zApplicable,
        mScore: scores.mScore,
        mApplicable: scores.mApplicable,
        pbRatio: scores.pbRatio,
        psRatio: scores.psRatio,
        dividendYield: scores.dividendYield,
        returnOnAssets: scores.returnOnAssets,
        currentRatio: scores.currentRatio,
      })
      .from(companies)
      .innerJoin(scores, eq(scores.companyId, companies.id))
      .where(and(...conditions))
      .orderBy(orderBy)
      .limit(limit);

    if (rows.length > 0) {
      return { status: "ok", rows, total: rows.length };
    }

    // Distinguish "nothing qualifies" from "this preset can never match,
    // because the column it filters on is empty for every company".
    const requirement = filters.preset ? PRESET_REQUIRES[filters.preset] : undefined;
    if (requirement) {
      const [populated] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(scores)
        .where(sql`${sql.identifier(requirement.column)} IS NOT NULL`);

      if ((populated?.count ?? 0) === 0) {
        return { status: "ok", rows: [], total: 0, missingData: { needs: requirement.needs } };
      }
    }

    return { status: "empty", rows: [], total: 0 };
  } catch (err) {
    const { status, detail } = classifyDbError(err);
    return { status, rows: [], total: 0, detail };
  }
}

/** Top companies by health score, for the dashboard. */
export async function getHealthiest(limit = 8): Promise<ScreenResult> {
  return runScreen({ minHealth: 7, sort: "health" }, limit);
}

/** How many companies have been ingested, for setup messaging. */
export async function getUniverseCount(): Promise<number | null> {
  if (!isDatabaseConfigured()) return null;
  try {
    const db = getDb();
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(companies);
    return row?.count ?? 0;
  } catch {
    // Null means "could not determine", distinct from a genuine zero.
    return null;
  }
}

export { asc, desc };

/** Exposed for tests only. */
export const __testing = { classifyDbError, rootCause, safeDetail };
