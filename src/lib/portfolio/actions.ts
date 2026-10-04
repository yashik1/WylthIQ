"use server";

import { and, asc, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { getDb, isDatabaseConfigured } from "../db";
import { portfolioHoldings } from "../db/schema";
import { getEntitlement, hasAccess } from "../billing/entitlement";
import { accountTypeLabel, isAccountType, type AccountType } from "./account-types";
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
  /** The kind of account it sits in, or null when not set. */
  accountType: AccountType | null;
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
    const rows = await getDb()
      .select({
        id: portfolioHoldings.id,
        symbol: portfolioHoldings.symbol,
        quantity: portfolioHoldings.quantity,
        averageCost: portfolioHoldings.averageCost,
        purchaseDate: portfolioHoldings.purchaseDate,
        accountType: portfolioHoldings.accountType,
        updatedAt: portfolioHoldings.updatedAt,
      })
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.userId, userId))
      .orderBy(asc(portfolioHoldings.symbol), asc(portfolioHoldings.id))
      .limit(MAX_HOLDINGS);
    return rows.map((row) => ({ ...row, accountType: isAccountType(row.accountType) ? row.accountType : null }));
  } catch {
    return [];
  }
}

/** One holding is one company in one kind of account; no kind set counts as a kind. */
const sameKind = (type: AccountType | null) => (row: { symbol: string; accountType: string | null }) =>
  (row.accountType ?? null) === type;

/**
 * Adds a holding, or replaces the caller's existing holding in the same
 * company and the same kind of account. The same company in another kind of
 * account — an ETF held in a TFSA and in an RRSP — is a second holding.
 */
export async function saveHolding(input: {
  symbol: unknown;
  quantity: unknown;
  averageCost: unknown;
  purchaseDate: unknown;
  accountType?: unknown;
}): Promise<HoldingResult> {
  const userId = await currentUser();
  if (!userId) return { ok: false, message: "Sign in to keep a portfolio." };

  const parsed = parseHoldingInput(input ?? {});
  if (!parsed.ok) return parsed;
  const { symbol, quantity, averageCost, purchaseDate, accountType } = parsed.holding;

  try {
    const db = getDb();
    const existing = await db
      .select({ symbol: portfolioHoldings.symbol, accountType: portfolioHoldings.accountType })
      .from(portfolioHoldings)
      .where(eq(portfolioHoldings.userId, userId));

    const replacing = existing.some((row) => row.symbol === symbol && sameKind(accountType)(row));
    if (!replacing && existing.length >= MAX_HOLDINGS) {
      return { ok: false, message: `A portfolio can hold ${MAX_HOLDINGS} holdings. Remove one first.` };
    }

    // Inserted, or — when the unique index says this company is already held
    // in this kind of account (0020_account_types.sql) — that row replaced.
    const inserted = await db
      .insert(portfolioHoldings)
      .values({ userId, symbol, quantity, averageCost, purchaseDate, accountType })
      .onConflictDoNothing()
      .returning({ id: portfolioHoldings.id });
    if (inserted.length === 0) {
      await db
        .update(portfolioHoldings)
        .set({ quantity, averageCost, purchaseDate, updatedAt: new Date() })
        .where(
          and(
            eq(portfolioHoldings.userId, userId),
            eq(portfolioHoldings.symbol, symbol),
            accountType ? eq(portfolioHoldings.accountType, accountType) : isNull(portfolioHoldings.accountType),
          ),
        );
    }
  } catch {
    return {
      ok: false,
      message: "Could not save that holding just now. The portfolio needs the latest database migration.",
    };
  }

  revalidatePath("/portfolio");
  return { ok: true, message: accountType ? `${symbol} in your ${accountTypeLabel(accountType)} saved.` : `${symbol} saved.` };
}

/** Removes one of the caller's holdings, by its id: one company can be held in several kinds of account. */
export async function deleteHolding(id: unknown): Promise<HoldingResult> {
  const userId = await currentUser();
  if (!userId) return { ok: false, message: "Sign in to manage your portfolio." };

  if (typeof id !== "number" || !Number.isSafeInteger(id) || id <= 0) {
    return { ok: false, message: "That holding could not be found. Reload the page." };
  }

  let removed: { symbol: string }[];
  try {
    removed = await getDb()
      .delete(portfolioHoldings)
      .where(and(eq(portfolioHoldings.userId, userId), eq(portfolioHoldings.id, id)))
      .returning({ symbol: portfolioHoldings.symbol });
  } catch {
    return { ok: false, message: "Could not remove that holding just now." };
  }

  revalidatePath("/portfolio");
  return removed.length > 0
    ? { ok: true, message: `${removed[0].symbol} removed.` }
    : { ok: false, message: "That holding was already removed. Reload the page." };
}
