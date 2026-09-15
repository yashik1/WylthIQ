import { and, desc, eq, gt, isNotNull, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "./db";
import { companies, scores } from "./db/schema";
import { isPriceStale } from "./quote-session";

/**
 * Market-wide views for the dashboard.
 *
 * Everything here reads the stored quote written by `refreshQuotes`, never a
 * price API directly. Fetching a live quote per company would need hundreds of
 * requests per page view, which no free plan sustains — and the whole point of
 * precomputing is that the dashboard stays instant and free.
 */

export interface Mover {
  symbol: string;
  name: string;
  displaySector: string;
  price: number | null;
  changePercent: number | null;
  healthScore: number | null;
  marketCap: number | null;
}

export interface SectorPerformance {
  sector: string;
  /** Mean daily change across companies in the sector. */
  averageChange: number;
  companyCount: number;
  /** Largest company in the sector, as a recognisable example. */
  leader: string | null;
}

export interface MarketSnapshot {
  gainers: Mover[];
  losers: Mover[];
  sectors: SectorPerformance[];
  /** When the newest stored price is from — the price's own date, not a refresh time. */
  asOf: Date | null;
  /** How many companies have a price from that same trading session. */
  covered: number;
  /**
   * Companies whose stored price is from an earlier session, left out.
   *
   * Movers and sectors rank one day's moves against each other. Mixing in a
   * company whose latest price is weeks old ranks that old day's move beside
   * today's — which is how a month-old stock split sat at the top of "biggest
   * fallers" as a 48% fall.
   */
  behind: number;
  /**
   * How many days old the stored quotes are, or null when unknown.
   *
   * Computed here rather than in the component. Freshness is a property of
   * the data that was fetched, not of the moment it happens to be rendered —
   * and reading the clock during render is both impure and, on a cached page,
   * frozen at whenever that page was built.
   */
  ageDays: number | null;
  /** True when the newest price is more than two trading days old. */
  stale: boolean;
}

/** Days between a stored timestamp and now, or null when it is unusable. */
function ageInDays(asOf: Date | null): number | null {
  if (!asOf) return null;
  const ms = asOf.getTime();
  if (!Number.isFinite(ms)) return null;
  return (Date.now() - ms) / 86_400_000;
}

const EMPTY: MarketSnapshot = {
  gainers: [],
  losers: [],
  sectors: [],
  asOf: null,
  covered: 0,
  behind: 0,
  ageDays: null,
  stale: false,
};

/**
 * Ignore microcap noise in the movers list.
 *
 * Without a floor the biggest movers are almost always tiny illiquid names,
 * which is true but useless — a reader looking at "today's movers" means
 * companies they might recognise.
 */
const MIN_MARKET_CAP = 2e9;

/** Companies needed in a sector before its average means anything. */
const MIN_SECTOR_MEMBERS = 3;

/**
 * How close to the newest price a stored price must be to share its session.
 *
 * Providers date the same close differently — a bare day read as the 4pm
 * close, a last-trade time a few hours into the evening — so an exact match
 * would split one session in two. Consecutive closes are twenty-four hours
 * apart, so eighteen keeps a session together without reaching the day before.
 */
const SESSION_WINDOW_MS = 18 * 60 * 60 * 1000;

export async function getMarketSnapshot(limit = 5): Promise<MarketSnapshot> {
  if (!isDatabaseConfigured()) return EMPTY;

  try {
    const db = getDb();

    const priced = and(
      eq(companies.isActive, true),
      isNotNull(scores.changePercent),
      isNotNull(scores.price),
    );

    const [meta] = await db
      .select({
        asOf: sql<Date | string | null>`max(${scores.priceUpdatedAt})`,
        priced: sql<number>`count(*)::int`,
      })
      .from(companies)
      .innerJoin(scores, eq(scores.companyId, companies.id))
      .where(priced);

    const asOf = meta?.asOf ? new Date(meta.asOf) : null;
    if (!asOf || !Number.isFinite(asOf.getTime())) return EMPTY;

    // Only prices from the newest session — see `behind` for why.
    const base = and(priced, gt(scores.priceUpdatedAt, new Date(asOf.getTime() - SESSION_WINDOW_MS)));

    const select = {
      symbol: companies.symbol,
      name: companies.name,
      displaySector: companies.displaySector,
      price: scores.price,
      changePercent: scores.changePercent,
      healthScore: scores.healthScore,
      marketCap: scores.marketCap,
    };

    const [gainers, losers, sectorRows, counted] = await Promise.all([
      db
        .select(select)
        .from(companies)
        .innerJoin(scores, eq(scores.companyId, companies.id))
        .where(and(base, sql`(${scores.marketCap} IS NULL OR ${scores.marketCap} >= ${MIN_MARKET_CAP})`))
        .orderBy(desc(scores.changePercent))
        .limit(limit),

      db
        .select(select)
        .from(companies)
        .innerJoin(scores, eq(scores.companyId, companies.id))
        .where(and(base, sql`(${scores.marketCap} IS NULL OR ${scores.marketCap} >= ${MIN_MARKET_CAP})`))
        .orderBy(sql`${scores.changePercent} ASC`)
        .limit(limit),

      db
        .select({
          sector: companies.displaySector,
          averageChange: sql<number>`avg(${scores.changePercent})::float8`,
          companyCount: sql<number>`count(*)::int`,
          leader: sql<string>`(array_agg(${companies.symbol} ORDER BY ${scores.marketCap} DESC NULLS LAST))[1]`,
        })
        .from(companies)
        .innerJoin(scores, eq(scores.companyId, companies.id))
        .where(base)
        .groupBy(companies.displaySector)
        .having(sql`count(*) >= ${MIN_SECTOR_MEMBERS}`),

      db
        .select({ covered: sql<number>`count(*)::int` })
        .from(companies)
        .innerJoin(scores, eq(scores.companyId, companies.id))
        .where(base),
    ]);

    const covered = counted[0]?.covered ?? 0;

    return {
      gainers,
      // A "loser" that actually rose means everything moved up today; the UI
      // filters those out rather than mislabelling them.
      losers: losers.filter((l) => (l.changePercent ?? 0) < 0),
      sectors: sectorRows
        .map((s) => ({ ...s, averageChange: Number(s.averageChange) }))
        .sort((a, b) => b.averageChange - a.averageChange),
      asOf,
      covered,
      behind: Math.max(0, (meta?.priced ?? 0) - covered),
      ageDays: ageInDays(asOf),
      stale: isPriceStale(asOf),
    };
  } catch {
    // Missing tables or an unreachable database: the dashboard hides these
    // sections rather than breaking the whole page.
    return EMPTY;
  }
}

/** True when there is enough stored quote data for the market views. */
export function hasMarketData(snapshot: MarketSnapshot): boolean {
  return snapshot.covered > 0 && (snapshot.gainers.length > 0 || snapshot.sectors.length > 0);
}
