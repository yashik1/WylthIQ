"use server";

import { and, desc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, isDatabaseConfigured } from "./db";
import { savedScreenRuns, savedScreeners } from "./db/schema";
import { canAccess, getEntitlement } from "./billing/entitlement";
import { PRESETS, SORTS, type ScreenFilters } from "./screener";
import { cleanScreenName, copyName } from "./saved-screen-names";

/**
 * Screens a reader saved, and the rules for reading them back.
 *
 * Every function here re-checks the entitlement against the session rather
 * than trusting an argument. A server action is a public HTTP endpoint with a
 * generated name — the fact that the only button pointing at it is behind a
 * sign-in says nothing about who can call it. And every query is scoped by the
 * caller's user id in its own WHERE clause, never fetched first and checked
 * afterwards.
 */

/** Nobody needs a hundred saved screens, and a cap keeps one account from filling a table. */
const MAX_SAVED = 50;

export interface SavedScreen {
  id: number;
  name: string;
  filters: ScreenFilters;
  updatedAt: Date;
  /** When it was last opened, or null — including before migration 0014 has run. */
  lastRunAt: Date | null;
  /** How many companies it returned that time. */
  lastResultCount: number | null;
}

export interface SaveResult {
  ok: boolean;
  error?: string;
}

/**
 * Filters as they come back out of JSON.
 *
 * The column holds whatever was written to it, including whatever an older
 * build wrote before a filter was renamed, so this rebuilds a known-good
 * object rather than casting. An unrecognised key is dropped: a saved screen
 * that quietly stops applying one filter is a smaller failure than one that
 * passes a stale key into a query builder.
 */
function parseFilters(raw: unknown): ScreenFilters {
  if (!raw || typeof raw !== "object") return {};
  const input = raw as Record<string, unknown>;
  const out: ScreenFilters = {};

  const numbers = [
    "minHealth", "maxPe", "minFScore", "minMarketCap", "minGrowth",
    "maxPb", "maxPs", "minDividendYield", "minNetMargin", "minRoa",
    "maxDebtToEquity", "minCurrentRatio",
  ] as const;

  for (const key of numbers) {
    const value = input[key];
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  for (const key of ["safeZoneOnly", "excludeAccountingFlags"] as const) {
    if (input[key] === true) out[key] = true;
  }
  for (const key of ["sector", "country"] as const) {
    const value = input[key];
    if (typeof value === "string" && value) out[key] = value;
  }
  if (typeof input.preset === "string" && input.preset in PRESETS) {
    out.preset = input.preset as ScreenFilters["preset"];
  }
  if (typeof input.sort === "string" && input.sort in SORTS) {
    out.sort = input.sort as ScreenFilters["sort"];
  }

  return out;
}

/** The signed-in reader allowed to save screens, or null. */
async function entitledUser(): Promise<string | null> {
  const entitlement = await getEntitlement();
  if (!canAccess(entitlement, "SAVED_SCREENERS") || !entitlement.userId) return null;
  if (!isDatabaseConfigured()) return null;
  return entitlement.userId;
}

function validId(id: unknown): id is number {
  return typeof id === "number" && Number.isInteger(id) && id > 0;
}

/** The Postgres error code under Drizzle's wrapper, which keeps it on `.cause`. */
function pgCode(err: unknown): string | null {
  let current: unknown = err;
  for (let depth = 0; current && typeof current === "object" && depth < 5; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/**
 * Last-run details for this account's screens.
 *
 * A query of its own, joined through `saved_screeners` so it is scoped by the
 * owner, and allowed to fail: before migration 0014 there is no runs table,
 * and the saved screens themselves must still list.
 */
async function lastRunsFor(
  userId: string,
): Promise<Map<number, { lastRunAt: Date; resultCount: number | null }>> {
  try {
    const rows = await getDb()
      .select({
        screenId: savedScreenRuns.screenId,
        lastRunAt: savedScreenRuns.lastRunAt,
        resultCount: savedScreenRuns.resultCount,
      })
      .from(savedScreenRuns)
      .innerJoin(savedScreeners, eq(savedScreeners.id, savedScreenRuns.screenId))
      .where(eq(savedScreeners.userId, userId));
    return new Map(rows.map((r) => [r.screenId, { lastRunAt: r.lastRunAt, resultCount: r.resultCount }]));
  } catch {
    return new Map();
  }
}

const SCREEN_COLUMNS = {
  id: savedScreeners.id,
  name: savedScreeners.name,
  filters: savedScreeners.filters,
  updatedAt: savedScreeners.updatedAt,
};

function revalidateScreens() {
  revalidatePath("/screen");
  revalidatePath("/research");
}

/** Saves a screen under a name, replacing any screen this account already has by it. */
export async function saveScreen(name: string, filters: ScreenFilters): Promise<SaveResult> {
  const entitlement = await getEntitlement();
  if (!canAccess(entitlement, "SAVED_SCREENERS") || !entitlement.userId) {
    return { ok: false, error: "Sign in to save screens." };
  }
  if (!isDatabaseConfigured()) {
    return { ok: false, error: "There is nowhere to save screens on this deployment." };
  }

  const trimmed = cleanScreenName(name);
  if (!trimmed) return { ok: false, error: "Give the screen a name." };

  const clean = parseFilters(filters);
  const db = getDb();

  try {
    // Counted before inserting rather than after, so the cap cannot be crossed
    // by two saves arriving together. An update to an existing name is exempt —
    // replacing a screen adds no row.
    const existing = await db
      .select({ id: savedScreeners.id, name: savedScreeners.name })
      .from(savedScreeners)
      .where(eq(savedScreeners.userId, entitlement.userId));

    const replacing = existing.some((row) => row.name === trimmed);
    if (!replacing && existing.length >= MAX_SAVED) {
      return { ok: false, error: `You can keep ${MAX_SAVED} saved screens. Delete one first.` };
    }

    await db
      .insert(savedScreeners)
      .values({ userId: entitlement.userId, name: trimmed, filters: clean })
      .onConflictDoUpdate({
        target: [savedScreeners.userId, savedScreeners.name],
        set: { filters: clean, updatedAt: new Date() },
      });
  } catch {
    return { ok: false, error: "Could not save that screen just now." };
  }

  revalidateScreens();
  return { ok: true };
}

/** This account's saved screens, most recently touched first. */
export async function listSavedScreens(): Promise<SavedScreen[]> {
  const userId = await entitledUser();
  if (!userId) return [];

  try {
    const rows = await getDb()
      .select(SCREEN_COLUMNS)
      .from(savedScreeners)
      .where(eq(savedScreeners.userId, userId))
      .orderBy(desc(savedScreeners.updatedAt))
      .limit(MAX_SAVED);

    const runs = await lastRunsFor(userId);
    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      filters: parseFilters(row.filters),
      updatedAt: row.updatedAt,
      lastRunAt: runs.get(row.id)?.lastRunAt ?? null,
      lastResultCount: runs.get(row.id)?.resultCount ?? null,
    }));
  } catch {
    // A saved list is not worth failing the screener over.
    return [];
  }
}

/** One of this account's saved screens, or null if it is not theirs or does not exist. */
export async function getSavedScreen(id: number): Promise<SavedScreen | null> {
  const userId = await entitledUser();
  if (!userId || !validId(id)) return null;

  try {
    const [row] = await getDb()
      .select(SCREEN_COLUMNS)
      .from(savedScreeners)
      .where(and(eq(savedScreeners.id, id), eq(savedScreeners.userId, userId)))
      .limit(1);
    if (!row) return null;

    const run = (await lastRunsFor(userId)).get(row.id);
    return {
      id: row.id,
      name: row.name,
      filters: parseFilters(row.filters),
      updatedAt: row.updatedAt,
      lastRunAt: run?.lastRunAt ?? null,
      lastResultCount: run?.resultCount ?? null,
    };
  } catch {
    return null;
  }
}

/** Renames one of this account's screens. */
export async function renameSavedScreen(id: number, name: string): Promise<SaveResult> {
  const userId = await entitledUser();
  if (!userId) return { ok: false, error: "Sign in to manage saved screens." };
  if (!validId(id)) return { ok: false, error: "That screen was not found." };

  const trimmed = cleanScreenName(name);
  if (!trimmed) return { ok: false, error: "Give the screen a name." };

  try {
    await getDb()
      .update(savedScreeners)
      .set({ name: trimmed, updatedAt: new Date() })
      .where(and(eq(savedScreeners.id, id), eq(savedScreeners.userId, userId)));
  } catch (err) {
    // The (user, name) unique index is the real guarantee two screens never
    // share a name; this only turns its refusal into something readable.
    if (pgCode(err) === "23505") {
      return { ok: false, error: `You already have a screen called “${trimmed}”.` };
    }
    return { ok: false, error: "Could not rename that screen just now." };
  }

  revalidateScreens();
  return { ok: true };
}

/** Copies one of this account's screens under a new name. */
export async function duplicateSavedScreen(id: number): Promise<SaveResult> {
  const userId = await entitledUser();
  if (!userId) return { ok: false, error: "Sign in to manage saved screens." };
  if (!validId(id)) return { ok: false, error: "That screen was not found." };

  const db = getDb();
  try {
    // Only this account's own rows are ever read, so the screen being copied
    // is found among them rather than fetched by id and checked afterwards.
    const own = await db
      .select({ id: savedScreeners.id, name: savedScreeners.name, filters: savedScreeners.filters })
      .from(savedScreeners)
      .where(eq(savedScreeners.userId, userId));

    const source = own.find((row) => row.id === id);
    if (!source) return { ok: false, error: "That screen was not found." };
    if (own.length >= MAX_SAVED) {
      return { ok: false, error: `You can keep ${MAX_SAVED} saved screens. Delete one first.` };
    }

    await db.insert(savedScreeners).values({
      userId,
      name: copyName(source.name, own.map((row) => row.name)),
      filters: parseFilters(source.filters),
    });
  } catch {
    return { ok: false, error: "Could not copy that screen just now." };
  }

  revalidateScreens();
  return { ok: true };
}

/**
 * Records that a saved screen was run, and what it returned.
 *
 * One statement, scoped: the run is written only if the screen belongs to the
 * caller, because the SELECT feeding the insert finds nothing otherwise. Fails
 * silently — a missing runs table, before migration 0014, must never stop a
 * screen from opening.
 */
export async function recordScreenRun(id: number, resultCount: number): Promise<void> {
  const userId = await entitledUser();
  if (!userId || !validId(id)) return;

  const count = Number.isFinite(resultCount) ? Math.max(0, Math.round(resultCount)) : null;

  try {
    await getDb().execute(sql`
      INSERT INTO saved_screen_runs (screen_id, last_run_at, result_count)
      SELECT id, now(), ${count} FROM saved_screeners
      WHERE id = ${id} AND user_id = ${userId}
      ON CONFLICT (screen_id) DO UPDATE
        SET last_run_at = EXCLUDED.last_run_at, result_count = EXCLUDED.result_count
    `);
  } catch {
    // Nothing to do: the screen still ran.
  }
}

/** Removes one saved screen, if it belongs to the caller. */
export async function deleteSavedScreen(id: number): Promise<SaveResult> {
  const userId = await entitledUser();
  if (!userId) return { ok: false, error: "Sign in to manage saved screens." };
  if (!validId(id)) return { ok: false, error: "That screen was not found." };

  try {
    /*
      Scoped by user id in the WHERE clause rather than checked after loading.
      A delete that fetches, compares and then deletes has a window between the
      check and the write; this cannot delete somebody else's row at all,
      because the statement never matches one.
    */
    await getDb()
      .delete(savedScreeners)
      .where(and(eq(savedScreeners.id, id), eq(savedScreeners.userId, userId)));
  } catch {
    return { ok: false, error: "Could not delete that screen just now." };
  }

  revalidateScreens();
  return { ok: true };
}
