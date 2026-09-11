/**
 * What a holding has to look like before it is stored.
 *
 * Plain rules, shared by the form and the server action, so the form can say
 * what is wrong before anything is sent and the action refuses the same
 * things regardless of what reached it.
 */

export const MAX_HOLDINGS = 100;

export interface HoldingInput {
  symbol: string;
  quantity: number;
  /** Per share. */
  averageCost: number;
  /** ISO date, or null when not given. */
  purchaseDate: string | null;
}

export type ParsedHolding = { ok: true; holding: HoldingInput } | { ok: false; message: string };

function toNumber(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/[,$\s]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

export function parseHoldingInput(
  raw: { symbol?: unknown; quantity?: unknown; averageCost?: unknown; purchaseDate?: unknown },
  today: Date = new Date(),
): ParsedHolding {
  const symbol = typeof raw.symbol === "string" ? raw.symbol.trim().toUpperCase() : "";
  if (!symbol || symbol.length > 20 || !/^[A-Z0-9.\-=^]+$/.test(symbol)) {
    return { ok: false, message: "Enter a ticker, such as AAPL or RY.TO." };
  }

  const quantity = toNumber(raw.quantity);
  if (quantity == null || quantity <= 0 || quantity > 1e12) {
    return { ok: false, message: "Enter how many shares you hold, as a number above zero." };
  }

  const averageCost = toNumber(raw.averageCost);
  if (averageCost == null || averageCost < 0 || averageCost > 1e9) {
    return { ok: false, message: "Enter the average price you paid per share." };
  }

  let purchaseDate: string | null = null;
  if (typeof raw.purchaseDate === "string" && raw.purchaseDate.trim() !== "") {
    const text = raw.purchaseDate.trim();
    const at = Date.parse(`${text}T00:00:00Z`);
    const latest = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isFinite(at) || at > latest || text < "1900-01-01") {
      return { ok: false, message: "Enter the purchase date as YYYY-MM-DD, and not in the future." };
    }
    purchaseDate = text;
  }

  return { ok: true, holding: { symbol, quantity, averageCost, purchaseDate } };
}
