import { eq, inArray } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "./db";
import { companies, scores } from "./db/schema";
import type { PeerFigures } from "./peer-context";

/**
 * Peers' figures from the nightly scores.
 *
 * Read from the database rather than fetched live: a company page fanning out
 * to a provider for every peer would multiply its cost by the number of
 * peers. The scores table holds no operating margin, so that field is null
 * here and comparisons fall back to profit margin.
 */

export interface PeerRow extends PeerFigures {
  name: string;
  fScore: number | null;
  fScoreMax: number | null;
  scoredAt: Date | null;
}

/** At most this many peers are read for one page. */
const MAX_PEERS = 12;

/** Stored scores for a set of symbols, in the order asked for. Empty without a database. */
export async function loadPeerScores(symbols: string[]): Promise<PeerRow[]> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, MAX_PEERS);
  if (wanted.length === 0 || !isDatabaseConfigured()) return [];

  try {
    const rows = await getDb()
      .select({
        symbol: companies.symbol,
        name: companies.name,
        healthScore: scores.healthScore,
        fScore: scores.fScore,
        fScoreMax: scores.fScoreMax,
        revenueGrowth: scores.revenueGrowth,
        netMargin: scores.netMargin,
        peRatio: scores.peRatio,
        debtToEquity: scores.debtToEquity,
        scoredAt: scores.computedAt,
      })
      .from(companies)
      .innerJoin(scores, eq(scores.companyId, companies.id))
      .where(inArray(companies.symbol, wanted));

    const bySymbol = new Map(rows.map((row) => [row.symbol, row]));
    return wanted
      .map((symbol) => bySymbol.get(symbol))
      .filter((row): row is (typeof rows)[number] => row !== undefined)
      .map((row) => ({ ...row, operatingMargin: null }));
  } catch {
    return [];
  }
}
