import { and, eq, gte, isNotNull, ne, sql } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "./db";
import { companies, scores } from "./db/schema";
import type { SectorReading } from "./movement-context";

/**
 * The average daily move across one sector, from the stored quotes.
 *
 * The same stored quotes the dashboard's sector heatmap reads, so a company
 * page and the dashboard never disagree about how a sector did. Quotes older
 * than two days are left out rather than averaged in as if they were today's,
 * and a sector with fewer than three fresh quotes has no average.
 */

const MIN_COMPANIES = 3;

export async function sectorMove(
  sector: string | null | undefined,
  excludeSymbol: string,
): Promise<SectorReading | null> {
  if (!sector || sector === "Other" || !isDatabaseConfigured()) return null;

  try {
    const [row] = await getDb()
      .select({
        change: sql<number | null>`avg(${scores.changePercent})::float8`,
        companies: sql<number>`count(*)::int`,
      })
      .from(companies)
      .innerJoin(scores, eq(scores.companyId, companies.id))
      .where(
        and(
          eq(companies.isActive, true),
          eq(companies.displaySector, sector),
          ne(companies.symbol, excludeSymbol),
          isNotNull(scores.changePercent),
          gte(scores.priceUpdatedAt, sql`now() - interval '2 days'`),
        ),
      );

    if (!row || row.change == null || row.companies < MIN_COMPANIES) return null;
    return { label: sector, change: Number(row.change), companies: row.companies };
  } catch {
    return null;
  }
}
