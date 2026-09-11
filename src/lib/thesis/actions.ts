"use server";

import { and, desc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, isDatabaseConfigured } from "../db";
import { investmentTheses } from "../db/schema";
import { getEntitlement, hasAccess } from "../billing/entitlement";
import {
  cleanHorizon,
  cleanStatus,
  cleanThesisText,
  parseConditions,
  type ThesisCondition,
  type ThesisStatus,
  type TimeHorizon,
} from "./metrics";

/**
 * A reader's theses.
 *
 * Every function re-checks the session and scopes each statement to the
 * caller's user id in its own WHERE clause, as the journal does: an action is
 * a callable endpoint, and a check that lives only in the page protects
 * nothing.
 *
 * Every read is allowed to fail quietly — before the migration that creates
 * the table, a company page must still render — and every write says so when
 * it cannot land.
 */

const MAX_THESES = 200;
const MAX_SYMBOL = 20;

export interface SavedThesis {
  id: number;
  symbol: string;
  thesis: string;
  mustGoRight: string;
  couldBreak: string;
  horizon: TimeHorizon | null;
  status: ThesisStatus;
  conditions: ThesisCondition[];
  createdAt: Date;
  updatedAt: Date;
}

export interface ThesisInput {
  thesis: string;
  mustGoRight: string;
  couldBreak: string;
  horizon: string | null;
  status: string;
  conditions: unknown;
}

export interface ThesisResult {
  ok: boolean;
  message: string;
}

async function currentUser(): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  const entitlement = await getEntitlement();
  return hasAccess(entitlement) && entitlement.userId ? entitlement.userId : null;
}

function cleanSymbol(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const symbol = raw.trim().toUpperCase().slice(0, MAX_SYMBOL);
  return /^[A-Z0-9.\-=^]+$/.test(symbol) ? symbol : null;
}

const COLUMNS = {
  id: investmentTheses.id,
  symbol: investmentTheses.symbol,
  thesis: investmentTheses.thesis,
  mustGoRight: investmentTheses.mustGoRight,
  couldBreak: investmentTheses.couldBreak,
  horizon: investmentTheses.horizon,
  status: investmentTheses.status,
  conditions: investmentTheses.conditions,
  createdAt: investmentTheses.createdAt,
  updatedAt: investmentTheses.updatedAt,
};

type Row = {
  [K in keyof typeof COLUMNS]: (typeof COLUMNS)[K]["_"]["notNull"] extends true
    ? (typeof COLUMNS)[K]["_"]["data"]
    : (typeof COLUMNS)[K]["_"]["data"] | null;
};

function toThesis(row: Row): SavedThesis {
  return {
    id: row.id,
    symbol: row.symbol,
    thesis: row.thesis,
    mustGoRight: row.mustGoRight,
    couldBreak: row.couldBreak,
    horizon: cleanHorizon(row.horizon),
    status: cleanStatus(row.status),
    conditions: parseConditions(row.conditions),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The caller's thesis for one company, or null. */
export async function getThesis(symbol: string): Promise<SavedThesis | null> {
  const userId = await currentUser();
  const clean = cleanSymbol(symbol);
  if (!userId || !clean) return null;

  try {
    const [row] = await getDb()
      .select(COLUMNS)
      .from(investmentTheses)
      .where(and(eq(investmentTheses.userId, userId), eq(investmentTheses.symbol, clean)))
      .limit(1);
    return row ? toThesis(row) : null;
  } catch {
    return null;
  }
}

/** Every thesis the caller has written, most recently edited first. */
export async function listTheses(): Promise<SavedThesis[]> {
  const userId = await currentUser();
  if (!userId) return [];

  try {
    const rows = await getDb()
      .select(COLUMNS)
      .from(investmentTheses)
      .where(eq(investmentTheses.userId, userId))
      .orderBy(desc(investmentTheses.updatedAt))
      .limit(MAX_THESES);
    return rows.map(toThesis);
  } catch {
    return [];
  }
}

/** Writes or replaces the caller's thesis for a company. */
export async function saveThesis(symbol: string, input: ThesisInput): Promise<ThesisResult> {
  const userId = await currentUser();
  if (!userId) return { ok: false, message: "Sign in to record a thesis." };

  const clean = cleanSymbol(symbol);
  if (!clean) return { ok: false, message: "That is not a symbol." };

  const values = {
    thesis: cleanThesisText(input?.thesis),
    mustGoRight: cleanThesisText(input?.mustGoRight),
    couldBreak: cleanThesisText(input?.couldBreak),
    horizon: cleanHorizon(input?.horizon),
    status: cleanStatus(input?.status),
    conditions: parseConditions(input?.conditions),
  };

  if (!values.thesis && !values.mustGoRight && !values.couldBreak && values.conditions.length === 0) {
    return { ok: false, message: "Write the thesis, or add a condition to track." };
  }

  try {
    const db = getDb();
    // Counted before writing, so the cap cannot be crossed by two saves at once.
    // Replacing an existing thesis adds no row.
    const existing = await db
      .select({ symbol: investmentTheses.symbol })
      .from(investmentTheses)
      .where(eq(investmentTheses.userId, userId));

    if (!existing.some((row) => row.symbol === clean) && existing.length >= MAX_THESES) {
      return { ok: false, message: `You can keep ${MAX_THESES} theses. Delete one first.` };
    }

    await db
      .insert(investmentTheses)
      .values({ userId, symbol: clean, ...values })
      .onConflictDoUpdate({
        target: [investmentTheses.userId, investmentTheses.symbol],
        set: { ...values, updatedAt: new Date() },
      });
  } catch {
    return {
      ok: false,
      message: "Could not save the thesis just now. Theses need the latest database migration.",
    };
  }

  revalidateThesis(clean);
  return { ok: true, message: "Thesis saved." };
}

/** Deletes the caller's thesis for a company. */
export async function deleteThesis(symbol: string): Promise<ThesisResult> {
  const userId = await currentUser();
  if (!userId) return { ok: false, message: "Sign in to manage your theses." };

  const clean = cleanSymbol(symbol);
  if (!clean) return { ok: false, message: "That is not a symbol." };

  try {
    await getDb()
      .delete(investmentTheses)
      .where(and(eq(investmentTheses.userId, userId), eq(investmentTheses.symbol, clean)));
  } catch {
    return { ok: false, message: "Could not delete the thesis just now." };
  }

  revalidateThesis(clean);
  return { ok: true, message: "Thesis deleted." };
}

function revalidateThesis(symbol: string) {
  revalidatePath(`/stock/${encodeURIComponent(symbol)}`);
  revalidatePath("/research");
}
