import { after } from "next/server";
import { and, asc, eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { tradeCharts, trades, tradeScreenshots, type TradeChartRow, type TradeRow } from "../db/schema";
import { captureTradeChart, isDue } from "./chart-capture";

/**
 * Everything one trade's own page shows, for its owner only.
 *
 * The trade is looked up by its id and the reader's id together, so a guessed
 * id that belongs to somebody else reads exactly like one that does not exist.
 */

export interface ScreenshotMeta {
  id: number;
  width: number;
  height: number;
  bytes: number;
  caption: string;
  createdAt: Date;
}

export interface TradePageData {
  trade: TradeRow;
  chart: TradeChartRow | null;
  /** True when a chart was wanted and no provider could be reached for it. */
  chartUnavailable: boolean;
  screenshots: ScreenshotMeta[];
}

/** Long enough for a provider to answer, short enough that a stuck one does not hold the page. */
const INLINE_CAPTURE_MS = 8_000;

async function readChart(tradeId: number, userId: string): Promise<TradeChartRow | null> {
  const [chart] = await getDb()
    .select()
    .from(tradeCharts)
    .where(and(eq(tradeCharts.tradeId, tradeId), eq(tradeCharts.userId, userId)))
    .limit(1);
  return chart ?? null;
}

export async function loadTradePage(tradeId: number, userId: string): Promise<TradePageData | null> {
  if (!isDatabaseConfigured() || !Number.isInteger(tradeId) || tradeId <= 0) return null;
  const db = getDb();

  const [trade] = await db
    .select()
    .from(trades)
    .where(and(eq(trades.id, tradeId), eq(trades.userId, userId)))
    .limit(1);
  if (!trade) return null;

  const [chartRow, screenshots] = await Promise.all([
    readChart(tradeId, userId),
    db
      .select({
        id: tradeScreenshots.id,
        width: tradeScreenshots.width,
        height: tradeScreenshots.height,
        bytes: tradeScreenshots.bytes,
        caption: tradeScreenshots.caption,
        createdAt: tradeScreenshots.createdAt,
      })
      .from(tradeScreenshots)
      .where(and(eq(tradeScreenshots.tradeId, tradeId), eq(tradeScreenshots.userId, userId)))
      .orderBy(asc(tradeScreenshots.createdAt), asc(tradeScreenshots.id)),
  ]);

  let chart = chartRow;
  let chartUnavailable = false;

  if (!chart) {
    // A trade from before charts were kept, or one whose capture has not run
    // yet: drawn now, while the reader waits, but not for long.
    const outcome = await Promise.race([
      captureTradeChart(tradeId, userId).catch(() => "failed" as const),
      new Promise<"slow">((resolve) => setTimeout(() => resolve("slow"), INLINE_CAPTURE_MS)),
    ]);
    chart = await readChart(tradeId, userId);
    chartUnavailable = !chart && (outcome === "failed" || outcome === "slow");
  } else if (
    isDue(
      {
        closedAt: trade.closedAt,
        fills: trade.fills,
        chart: { fillsKey: chart.fillsKey, capturedAt: chart.capturedAt, empty: (chart.bars as unknown[]).length === 0 },
      },
      new Date(),
    )
  ) {
    // An open trade's chart a few hours old, or one whose fills have changed:
    // the kept chart is shown now and brought up to date for the next visit.
    after(async () => {
      await captureTradeChart(tradeId, userId).catch(() => undefined);
    });
  }

  return { trade, chart, chartUnavailable, screenshots };
}
