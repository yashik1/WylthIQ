import { and, desc, eq, sql } from "drizzle-orm";
import { after } from "next/server";
import { getDb } from "../db";
import { tradeCharts, trades } from "../db/schema";
import { getBarsWithSource } from "../providers";
import type { Bar } from "../providers/types";
import { fillsKey, readFills } from "./fills";
import { chartPlan, coversTrade, type ChartInput, type ChartWindow } from "./trade-chart";

/**
 * Capturing each journal trade's chart, close to when the trade happened.
 *
 * The bars are fetched once and kept (`trade_charts`), which is what makes
 * this the trade's picture rather than a chart redrawn on every visit. Free
 * intraday history runs out after a few weeks for most listings, so a trade
 * charted the hour its broker reported it can still be drawn on five-minute
 * candles a year later, when nobody would serve them any more.
 *
 * A trade is captured again when its fills change — added to, trimmed or
 * closed — and, while it is open, a few times a day so the chart keeps up.
 * Everything here is best-effort: a failed capture leaves any chart already
 * kept in place, and is tried again later.
 */

export type CaptureOutcome = "captured" | "no-history" | "failed" | "missing";

export interface CaptureDeps {
  getBars?: typeof getBarsWithSource;
  now?: () => Date;
}

/** A capture that found nothing is not retried for a day; history does not appear by the hour. */
const RETRY_EMPTY_MS = 24 * 3600_000;
/** An open trade's chart is brought up to date this often. */
const REFRESH_OPEN_MS = 6 * 3600_000;
/** After a change to the fills, wait this long before trying again if the last try did not take. */
const RETRY_CHANGED_MS = 30 * 60_000;
/** A bound on what one chart stores, far above any window the plan asks for. */
const MAX_BARS = 5_000;

function usable(bar: Bar): boolean {
  return (
    Number.isFinite(bar.time) &&
    [bar.open, bar.high, bar.low, bar.close].every((n) => Number.isFinite(n) && n > 0)
  );
}

export interface Captured {
  window: ChartWindow;
  bars: Bar[];
  source: string | null;
  includesDividends: boolean;
}

export type Search =
  | { covered: Captured }
  | { covered: null; partial: Captured | null; failed: boolean };

/**
 * The finest bars that show the whole trade, trying each window of the plan
 * in turn: a day trade whose five-minute history has gone is still drawn on
 * daily candles. When none shows it all, the fullest partial answer, and
 * whether any provider failed outright, which is a reason to try again later
 * rather than to settle for less.
 */
export async function findBars(
  symbol: string,
  input: ChartInput,
  now: Date,
  getBars: NonNullable<CaptureDeps["getBars"]>,
): Promise<Search> {
  let failed = false;
  let partial: Captured | null = null;
  for (const window of chartPlan(input, now)) {
    try {
      const answer = await getBars(symbol, window.timeframe, window.from, window.to);
      const bars = answer.bars.filter(usable).sort((a, b) => a.time - b.time).slice(-MAX_BARS);
      const captured = { window, bars, source: answer.source, includesDividends: answer.includesDividends };
      if (coversTrade(bars, window, input, now)) return { covered: captured };
      if (bars.length > 0 && (!partial || bars.length > partial.bars.length)) partial = captured;
    } catch {
      // Every provider failed for this window; a coarser one may still answer.
      failed = true;
    }
  }
  return { covered: null, partial, failed };
}

/** Captures one trade's chart. The owner is part of the lookup, as everywhere trades are read. */
export async function captureTradeChart(
  tradeId: number,
  userId: string,
  deps: CaptureDeps = {},
): Promise<CaptureOutcome> {
  const db = getDb();
  const getBars = deps.getBars ?? getBarsWithSource;
  const now = deps.now?.() ?? new Date();

  const [trade] = await db
    .select({
      symbol: trades.symbol,
      openedAt: trades.openedAt,
      closedAt: trades.closedAt,
      fills: trades.fills,
      kept: sql<number | null>`(select jsonb_array_length(${tradeCharts.bars}) from ${tradeCharts} where ${tradeCharts.tradeId} = ${trades.id})`,
    })
    .from(trades)
    .where(and(eq(trades.id, tradeId), eq(trades.userId, userId)))
    .limit(1);
  if (!trade) return "missing";

  const input: ChartInput = { fills: readFills(trade.fills), openedAt: trade.openedAt, closedAt: trade.closedAt };
  const key = fillsKey(input.fills);
  const search = await findBars(trade.symbol, input, now, getBars);
  if (search.covered) {
    await save(tradeId, userId, key, search.covered, now);
    return "captured";
  }

  // Providers down is not the same as no history: leave everything as it is
  // and let the next run try again.
  if (search.failed && !search.partial) return "failed";

  if ((trade.kept ?? 0) > 0) {
    // A chart kept from before beats none. Note the try, so the trade is not
    // retried every run, but keep the bars it already has.
    await db
      .update(tradeCharts)
      .set({ fillsKey: key, capturedAt: now })
      .where(eq(tradeCharts.tradeId, tradeId));
    return "no-history";
  }

  // Part of the trade beats none of it. With nothing at all, an empty chart is
  // kept so the trade is tried again tomorrow rather than every hour.
  const plan = chartPlan(input, now);
  const nothing = { window: plan[plan.length - 1], bars: [], source: null, includesDividends: false };
  await save(tradeId, userId, key, search.partial ?? nothing, now);
  return "no-history";
}

async function save(tradeId: number, userId: string, key: string, captured: Captured, now: Date): Promise<void> {
  const values = {
    timeframe: captured.window.timeframe,
    fromAt: captured.window.from,
    toAt: captured.window.to,
    bars: captured.bars,
    source: captured.source,
    includesDividends: captured.includesDividends,
    fillsKey: key,
    capturedAt: now,
  };
  await getDb()
    .insert(tradeCharts)
    .values({ tradeId, userId, ...values })
    .onConflictDoUpdate({ target: tradeCharts.tradeId, set: values });
}

export interface ChartState {
  closedAt: string | null;
  fills: unknown;
  /** Null when the trade has no chart yet. */
  chart: { fillsKey: string; capturedAt: Date; empty: boolean } | null;
}

/** Whether a trade's chart should be captured (again) now. */
export function isDue(state: ChartState, now: Date): boolean {
  const { chart } = state;
  if (!chart) return true;
  const age = now.getTime() - new Date(chart.capturedAt).getTime();
  if (chart.fillsKey !== fillsKey(readFills(state.fills))) return age >= RETRY_CHANGED_MS;
  if (chart.empty) return age >= RETRY_EMPTY_MS;
  if (!state.closedAt) return age >= REFRESH_OPEN_MS;
  return false;
}

/**
 * Captures a reader's due charts once the current response has gone, for the
 * places a sync finishes in front of the reader: a chart is worth having,
 * not worth waiting for.
 */
export function captureDueChartsAfterResponse(userId: string): void {
  after(async () => {
    await captureDueCharts(userId).catch(() => undefined);
  });
}

/** How many of a reader's newest trades are looked over for charts due. */
const SCAN = 500;

/**
 * Captures the charts a reader's trades are due, newest trades first, within
 * a count and a time budget. Called after a broker sync, so a trade's chart
 * is taken within the hour its broker reports it.
 */
export async function captureDueCharts(
  userId: string,
  options: { limit?: number; budgetMs?: number } = {},
  deps: CaptureDeps = {},
): Promise<{ captured: number; noHistory: number; failed: number }> {
  const limit = options.limit ?? 10;
  const budgetMs = options.budgetMs ?? 30_000;
  const started = Date.now();
  const now = deps.now?.() ?? new Date();
  const counts = { captured: 0, noHistory: 0, failed: 0 };

  const rows = await getDb()
    .select({
      id: trades.id,
      closedAt: trades.closedAt,
      fills: trades.fills,
      chartKey: tradeCharts.fillsKey,
      capturedAt: tradeCharts.capturedAt,
      empty: sql<boolean>`jsonb_array_length(${tradeCharts.bars}) = 0`,
    })
    .from(trades)
    .leftJoin(tradeCharts, eq(tradeCharts.tradeId, trades.id))
    .where(eq(trades.userId, userId))
    .orderBy(desc(trades.openedAt), desc(trades.id))
    .limit(SCAN);

  const due = rows
    .filter((row) =>
      isDue(
        {
          closedAt: row.closedAt,
          fills: row.fills,
          chart:
            row.capturedAt && row.chartKey !== null
              ? { fillsKey: row.chartKey, capturedAt: row.capturedAt, empty: Boolean(row.empty) }
              : null,
        },
        now,
      ),
    )
    .slice(0, limit);

  for (const row of due) {
    if (Date.now() - started > budgetMs) break;
    try {
      const outcome = await captureTradeChart(row.id, userId, deps);
      if (outcome === "captured") counts.captured++;
      else if (outcome === "no-history") counts.noHistory++;
      else if (outcome === "failed") counts.failed++;
    } catch {
      counts.failed++;
    }
  }
  return counts;
}
