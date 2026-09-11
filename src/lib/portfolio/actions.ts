"use server";

import { and, asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, isDatabaseConfigured } from "../db";
import { portfolioHoldings } from "../db/schema";
import { getEntitlement, hasAccess } from "../billing/entitlement";
import { MAX_HOLDINGS, parseHoldingInput } from "./input";

/**
 * A reader's holdings.
 *
 * Scoped to the caller's user id in every statement, as the journal and
 * theses are. Reads fail quietly — before the migration that creates the
 * table, the page must still render — and writes say when they cannot land.
 */

export interface SavedHolding {
  id: number;
  symbol: string;
  quantity: number;
  averageCost: number;
  purchaseDate: string | null;
  updatedAt: Date;
}

export interface HoldingResult {
  ok: boolean;
  message: string;
}

async function currentUser(): Promise<string | null> {
  if (!isDatabaseConfigured()) return null;
  const entitlement = await getEntitlement();
  return hasAccess(entitlement) && entitlement.userId ? entitlement.userId : null;
}

export async function listHoldings(): Promise<SavedHolding[]> {
  const userId = await currentUser();
  if (!userId) return [];

  try {
    return await getDb()
      .select({
        id: portfolioHoldings.id,
        symbol: portfolioHoldings.symbol,
        quantity: portfolioHoldings.quantity,
        averageCost: portfolioHoldings.averageCost,
        purchaseDate: portfolioHoldings.purchaseDate,
        updatedAt: portfolioHoldings.updatedAt,
      })
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.userId, userId))
      .orderBy(asc(portfolioHoldings.symbol))
      .limit(MAX_HOLDINGS);
  } catch {
    return [];
  }
}

/** Adds a holding, or replaces the caller's existing holding in the same company. */
export async function saveHolding(input: {
  symbol: unknown;
  quantity: unknown;
  averageCost: unknown;
  purchaseDate: unknown;
}): Promise<HoldingResult> {
  const userId = await currentUser();
  if (!userId) return { ok: false, message: "Sign in to keep a portfolio." };

  const parsed = parseHoldingInput(input ?? {});
  if (!parsed.ok) return parsed;
  const { symbol, quantity, averageCost, purchaseDate } = parsed.holding;

  try {
    const db = getDb();
    const existing = await db
      .select({ symbol: portfolioHoldings.symbol })
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.userId, userId));

    if (!existing.some((row) => row.symbol === symbol) && existing.length >= MAX_HOLDINGS) {
      return { ok: false, message: `A portfolio can hold ${MAX_HOLDINGS} companies. Remove one first.` };
    }

    await db
      .insert(portfolioHoldings)
      .values({ userId, symbol, quantity, averageCost, purchaseDate })
      .onConflictDoUpdate({
        target: [portfolioHoldings.userId, portfolioHoldings.symbol],
        set: { quantity, averageCost, purchaseDate, updatedAt: new Date() },
      });
  } catch {
    return {
      ok: false,
      message: "Could not save that holding just now. The portfolio needs the latest database migration.",
    };
  }

  revalidatePath("/portfolio");
  return { ok: true, message: `${symbol} saved.` };
}

export async function deleteHolding(symbol: unknown): Promise<HoldingResult> {
  const userId = await currentUser();
  if (!userId) return { ok: false, message: "Sign in to manage your portfolio." };

  const clean = typeof symbol === "string" ? symbol.trim().toUpperCase().slice(0, 20) : "";
  if (!clean) return { ok: false, message: "That is not a symbol." };

  try {
    await getDb()
      .delete(portfolioHoldings)
      .where(and(eq(portfolioHoldings.userId, userId), eq(portfolioHoldings.symbol, clean)));
  } catch {
    return { ok: false, message: "Could not remove that holding just now." };
  }

  revalidatePath("/portfolio");
  return { ok: true, message: `${clean} removed.` };
}
