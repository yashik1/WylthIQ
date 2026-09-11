"use server";

import { revalidatePath } from "next/cache";
import { and, desc, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { watchlistGroups, watchlistItems } from "../db/schema";
import { auth } from "../auth";
import { cleanGroupName } from "./groups";

/**
 * The saved-companies list, kept on the account.
 *
 * Scoped to the caller's own userId in the WHERE clause rather than checked
 * after fetching, for the same reason the journal is: filtering afterwards
 * means somebody else's row is already in hand before the check runs, and
 * that is the shape of bug that leaks one reader's data to another.
 *
 * Unlike the journal, this asks only whether somebody is signed in — not
 * whether they have access to the paid features. Saving a company is how a
 * newcomer starts using the app, and gating it would be the one place a gate
 * does active harm.
 */

const MAX_SYMBOL = 20;
const MAX_NAME = 120;
/**
 * A ceiling on how many companies one account may save.
 *
 * Not a product limit anybody should hit — it is a bound on what a scripted
 * caller can insert, since these actions are reachable endpoints in their own
 * right and the merge below accepts a list from the browser.
 */
const MAX_ITEMS = 500;

export interface WatchlistResult {
  ok: boolean;
  message?: string;
}

/** A saved company, as the account holds it. */
export interface SavedCompany {
  id: number;
  symbol: string;
  name: string | null;
  addedAt: Date;
  /** The reader's group for it, or null — always null before migration 0014 has run. */
  groupName: string | null;
}

async function currentUserId(): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  // A thrown auth() — a missing or malformed AUTH_SECRET — reads as signed
  // out rather than taking the page down, which leaves the browser-backed
  // list working.
  const session = await auth().catch(() => null);
  return session?.user?.id ?? null;
}

/** Normalises a ticker the same way every route in the app does. */
function cleanSymbol(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const symbol = raw.trim().toUpperCase().slice(0, MAX_SYMBOL);
  return symbol.length > 0 ? symbol : null;
}

function cleanName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const name = raw.trim().slice(0, MAX_NAME);
  return name.length > 0 ? name : null;
}

/**
 * Each saved symbol's group.
 *
 * Its own query, allowed to fail: before migration 0014 there is no groups
 * table, and the saved list must still show.
 */
async function groupsFor(userId: string): Promise<Map<string, string>> {
  try {
    const rows = await getDb()
      .select({ symbol: watchlistGroups.symbol, groupName: watchlistGroups.groupName })
      .from(watchlistGroups)
      .where(eq(watchlistGroups.userId, userId));
    return new Map(rows.map((r) => [r.symbol, r.groupName]));
  } catch {
    return new Map();
  }
}

/** The signed-in reader's saved companies, newest first. Empty when signed out. */
export async function listWatchlist(): Promise<SavedCompany[]> {
  const userId = await currentUserId();
  if (!userId) return [];

  let rows: Omit<SavedCompany, "groupName">[];
  try {
    rows = await getDb()
      .select({
        id: watchlistItems.id,
        symbol: watchlistItems.symbol,
        name: watchlistItems.name,
        addedAt: watchlistItems.addedAt,
      })
      .from(watchlistItems)
      .where(eq(watchlistItems.userId, userId))
      .orderBy(desc(watchlistItems.addedAt))
      .limit(MAX_ITEMS);
  } catch {
    // A saved list is not worth failing a page over; the reader sees an empty
    // one and everything else still works.
    return [];
  }

  const groups = rows.length > 0 ? await groupsFor(userId) : new Map<string, string>();
  return rows.map((row) => ({ ...row, groupName: groups.get(row.symbol) ?? null }));
}

export async function saveToWatchlist(
  symbol: string,
  name?: string | null,
): Promise<WatchlistResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, message: "Sign in to save companies to your account." };

  const clean = cleanSymbol(symbol);
  if (!clean) return { ok: false, message: "That is not a symbol." };

  try {
    await getDb()
      .insert(watchlistItems)
      .values({ userId, symbol: clean, name: cleanName(name) })
      // Saving twice is a no-op rather than an error: a reader who
      // double-taps the button meant to save it once.
      .onConflictDoNothing({
        target: [watchlistItems.userId, watchlistItems.symbol],
      });
  } catch {
    return { ok: false, message: "Could not save that just now." };
  }

  revalidateWatchlist(clean);
  return { ok: true };
}

export async function removeFromWatchlist(symbol: string): Promise<WatchlistResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, message: "Sign in to manage your saved companies." };

  const clean = cleanSymbol(symbol);
  if (!clean) return { ok: false, message: "That is not a symbol." };

  try {
    await getDb()
      .delete(watchlistItems)
      // Both conditions, always. Deleting on symbol alone would clear the
      // same company from every account in the table. The company's group
      // goes with it, by the foreign key in migration 0014.
      .where(and(eq(watchlistItems.userId, userId), eq(watchlistItems.symbol, clean)));
  } catch {
    return { ok: false, message: "Could not remove that just now." };
  }

  revalidateWatchlist(clean);
  return { ok: true };
}

/**
 * Files a saved company under a group, or takes it out of one.
 *
 * An empty group removes the row rather than storing an empty name. Writing a
 * group for a company the reader has not saved is refused by the database —
 * the foreign key to the saved company — rather than by a check here that
 * could race with a removal.
 */
export async function setWatchlistGroup(
  symbol: string,
  group: string | null,
): Promise<WatchlistResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, message: "Sign in to organise your saved companies." };

  const clean = cleanSymbol(symbol);
  if (!clean) return { ok: false, message: "That is not a symbol." };

  const groupName = cleanGroupName(group);
  const db = getDb();

  try {
    if (groupName === null) {
      await db
        .delete(watchlistGroups)
        .where(and(eq(watchlistGroups.userId, userId), eq(watchlistGroups.symbol, clean)));
    } else {
      await db
        .insert(watchlistGroups)
        .values({ userId, symbol: clean, groupName })
        .onConflictDoUpdate({
          target: [watchlistGroups.userId, watchlistGroups.symbol],
          set: { groupName, updatedAt: new Date() },
        });
    }
  } catch {
    return {
      ok: false,
      message: "Could not change that group. Groups need the latest database migration.",
    };
  }

  revalidatePath("/watchlist");
  revalidatePath("/research");
  return { ok: true };
}

/**
 * Folds a browser-held list into the account, once, at sign-in.
 *
 * The alternative — treating the account as authoritative and dropping the
 * local list — would mean somebody who had been saving companies for weeks
 * loses all of them by finally registering, which punishes exactly the
 * behaviour the account is meant to reward.
 *
 * Idempotent by construction: the unique index on (userId, symbol) makes a
 * repeat merge a no-op, so a double-fired effect or a retried request cannot
 * duplicate anything.
 */
export async function mergeLocalWatchlist(
  entries: { symbol: string; name?: string | null }[],
): Promise<WatchlistResult> {
  const userId = await currentUserId();
  if (!userId) return { ok: false, message: "Not signed in." };
  if (!Array.isArray(entries) || entries.length === 0) return { ok: true };

  const values = entries
    .slice(0, MAX_ITEMS)
    .map((e) => ({
      userId,
      symbol: cleanSymbol(String(e?.symbol ?? "")),
      name: cleanName(e?.name),
    }))
    .filter((v): v is { userId: string; symbol: string; name: string | null } =>
      v.symbol !== null,
    );

  if (values.length === 0) return { ok: true };

  try {
    await getDb()
      .insert(watchlistItems)
      .values(values)
      .onConflictDoNothing({
        target: [watchlistItems.userId, watchlistItems.symbol],
      });
  } catch {
    return { ok: false, message: "Could not merge your saved companies." };
  }

  revalidatePath("/");
  return { ok: true };
}

function revalidateWatchlist(symbol: string) {
  revalidatePath("/");
  revalidatePath("/watchlist");
  revalidatePath("/research");
  revalidatePath(`/stock/${encodeURIComponent(symbol)}`);
}
