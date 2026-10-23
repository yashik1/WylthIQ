import { eq } from "drizzle-orm";
import { getDb } from "./db";
import { companies, scores } from "./db/schema";
import { getBarsWithSource } from "./providers";
import { computeTechnicals, trendStates } from "./technicals";

/**
 * Works out where each company's share price stands against its history —
 * moving averages, the last 50/200-day cross, the 52-week range, RSI — and
 * stores it beside the company's scores for the screener's price-trend filter.
 *
 * Run after the quotes refresh each weekday evening, once the day's bars have
 * settled. Bars come through the same provider chain and Postgres bar cache
 * as the charts, so a chart someone opened after the close costs nothing
 * here, and this run leaves every chart warm for the next morning. Alpaca's
 * free plan covers the US listings at 200 requests a minute; the Canadian
 * ones fall to the rest of the chain.
 *
 * A company whose history cannot be read keeps yesterday's figures, which
 * carry their own date, rather than having them blanked by one failed fetch.
 */

/** A little over a trading year and a half: 200 days for the long average, plus room to see it cross. */
const HISTORY_DAYS = 400;

export interface TechnicalsRefreshResult {
  updated: number;
  /** Companies the providers had no daily history for. */
  noHistory: number;
  failed: number;
  errors: string[];
  /** Which provider supplied the bars, by count. Cached bars count under their original source. */
  answeredBy: Record<string, number>;
  /** The newest bar date seen, so a run can say how current it is. */
  newestAsOf: string | null;
}

export interface TechnicalsRefreshOptions {
  /** Most bar requests to start per minute. */
  perMinute?: number;
  now?: Date;
  getBars?: typeof getBarsWithSource;
}

export async function refreshTechnicals(
  symbols: string[],
  onProgress?: (done: number, total: number) => void,
  options: TechnicalsRefreshOptions = {},
): Promise<TechnicalsRefreshResult> {
  const db = getDb();
  const getBars = options.getBars ?? getBarsWithSource;
  const now = options.now ?? new Date();
  const from = new Date(now.getTime() - HISTORY_DAYS * 86_400_000);

  const rows = await db
    .select({ id: companies.id, symbol: companies.symbol })
    .from(companies)
    .innerJoin(scores, eq(scores.companyId, companies.id));
  const idBySymbol = new Map(rows.map((r) => [r.symbol.toUpperCase(), r.id]));

  const result: TechnicalsRefreshResult = {
    updated: 0,
    noHistory: 0,
    failed: 0,
    errors: [],
    answeredBy: {},
    newestAsOf: null,
  };

  // Start times one slot apart, shared by both workers — the same pacing as the quotes.
  const gapMs = options.perMinute && options.perMinute > 0 ? 60_000 / options.perMinute : 0;
  let nextSlot = 0;
  const waitForSlot = async () => {
    if (!gapMs) return;
    const at = Date.now();
    const slot = Math.max(at, nextSlot);
    nextSlot = slot + gapMs;
    if (slot > at) await new Promise((resolve) => setTimeout(resolve, slot - at));
  };

  let done = 0;
  let cursor = 0;
  const work = async () => {
    while (cursor < symbols.length) {
      const symbol = symbols[cursor++].toUpperCase();
      const companyId = idBySymbol.get(symbol);
      if (companyId) {
        try {
          await waitForSlot();
          const { bars, source } = await getBars(symbol, "1Day", from, now);
          const t = computeTechnicals(bars);
          if (!t) {
            result.noHistory += 1;
          } else {
            await db
              .update(scores)
              .set({
                technicalClose: t.close,
                sma50: t.sma50,
                sma200: t.sma200,
                rsi14: t.rsi14,
                high52w: t.high52w,
                low52w: t.low52w,
                lastCross: t.lastCross?.direction ?? null,
                lastCrossDate: t.lastCross?.date ?? null,
                trendStates: trendStates(t),
                technicalsAsOf: t.asOf,
              })
              .where(eq(scores.companyId, companyId));
            result.updated += 1;
            const name = source ?? "unknown";
            result.answeredBy[name] = (result.answeredBy[name] ?? 0) + 1;
            if (!result.newestAsOf || t.asOf > result.newestAsOf) result.newestAsOf = t.asOf;
          }
        } catch (err) {
          result.failed += 1;
          if (result.errors.length < 20) {
            result.errors.push(`${symbol}: ${err instanceof Error ? err.message : "failed"}`);
          }
        }
      }
      onProgress?.(++done, symbols.length);
    }
  };

  await Promise.all([work(), work()]);
  return result;
}
