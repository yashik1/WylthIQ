import { eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { fundProfileCache } from "../db/schema";
import type { EtfProfile } from "../providers/alphavantage";

/**
 * A fund's commercial facts, kept so they are fetched once rather than daily.
 *
 * The facts on a fund card — the fee, the launch date, the turnover, the
 * sector split — move about as often as a fund changes its prospectus. The
 * source that carries them for a US fund is Alpha Vantage, and its free
 * allowance is 25 calls a day for the whole application, shared with every
 * company lookup EDGAR cannot answer. The practical result was that most funds
 * never got any: on 2026-09-17 the live site showed an expense ratio for four
 * of thirteen funds checked, and for none of VOO, VTI, SPY, SCHD, BND or XLE.
 *
 * Keeping the answer turns a daily cost into a one-off. Every failure here is
 * a miss rather than an error: a deployment whose migration has not been run
 * behaves exactly as it did before this file existed.
 */

/**
 * How long a stored profile stands.
 *
 * Thirty days is long against how often a fee changes and short against how
 * long a wrong one would sit there. A fund that has just cut its fee is the
 * case this trades against, and a month is the most it can be stale by.
 */
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** A deadline, so a slow database delays a page rather than holding it. */
const READ_DEADLINE_MS = 1_500;

export function isFresh(fetchedAt: Date, now: Date = new Date()): boolean {
  const age = now.getTime() - fetchedAt.getTime();
  return age >= 0 && age < MAX_AGE_MS;
}

/**
 * A stored row, believed only if it still has the shape of a profile.
 *
 * JSON from a database is data, not a type. A row written by an older version
 * of this app could be missing anything, and a missing `holdings` array is a
 * crash on a page rather than a blank field.
 */
export function parseProfile(value: unknown): EtfProfile | null {
  if (!value || typeof value !== "object") return null;
  const p = value as Partial<EtfProfile>;

  const numberOrNull = (v: unknown) => v === null || typeof v === "number";
  if (!numberOrNull(p.expenseRatio) || !numberOrNull(p.turnover)) return null;
  if (!Array.isArray(p.holdings) || !Array.isArray(p.sectors)) return null;
  if (typeof p.leveraged !== "boolean") return null;

  return p as EtfProfile;
}

/** The stored profile for a fund, or null when there is nothing usable. */
export async function readFundProfile(symbol: string): Promise<EtfProfile | null> {
  if (!isDatabaseConfigured()) return null;

  try {
    const rows = await Promise.race([
      getDb()
        .select({ profile: fundProfileCache.profile, fetchedAt: fundProfileCache.fetchedAt })
        .from(fundProfileCache)
        .where(eq(fundProfileCache.symbol, symbol.toUpperCase()))
        .limit(1),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("fund profile cache read timed out")), READ_DEADLINE_MS),
      ),
    ]);

    const row = rows[0];
    if (!row || !isFresh(new Date(row.fetchedAt))) return null;
    return parseProfile(row.profile);
  } catch {
    // A missing table, an unreachable database, a slow query: all of them mean
    // "ask the provider", which is what the caller was going to do anyway.
    return null;
  }
}

/** Stores a profile, replacing whatever was there. Never throws. */
export async function writeFundProfile(
  symbol: string,
  source: string,
  profile: EtfProfile,
): Promise<void> {
  if (!isDatabaseConfigured()) return;

  try {
    await getDb()
      .insert(fundProfileCache)
      .values({ symbol: symbol.toUpperCase(), source, profile, fetchedAt: new Date() })
      .onConflictDoUpdate({
        target: fundProfileCache.symbol,
        set: { source, profile, fetchedAt: new Date() },
      });
  } catch {
    // Writing is an optimisation. A page that could not store its answer has
    // still answered.
  }
}
