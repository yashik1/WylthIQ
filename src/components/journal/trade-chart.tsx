"use client";

import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineStyle,
  type IChartApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { cssVar, localCrosshair, localTick } from "@/lib/chart-theme";
import { num } from "@/lib/format";
import type { TradeFill } from "@/lib/journal/fills";
import { fillMarkers } from "@/lib/journal/trade-chart";
import type { Bar, Timeframe } from "@/lib/providers/types";

export interface TradeLevels {
  entry: number | null;
  exit: number | null;
  stop: number | null;
  target: number | null;
}

/**
 * One trade drawn on the candles it happened in.
 *
 * The bars were captured when the trade was recorded (journal/chart-capture),
 * so this draws them and nothing is fetched. Each fill is an arrow on its own
 * candle pointing at the price it was filled at — a buy from below, a sell
 * from above — and
 * the average entry and exit, the stop and the target are lines across, so the
 * plan and what happened can be read against each other.
 */
export function TradeChart({
  bars,
  timeframe,
  fills,
  levels,
}: {
  bars: Bar[];
  timeframe: Timeframe;
  fills: TradeFill[];
  levels: TradeLevels;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const intraday = timeframe !== "1Day" && timeframe !== "1Week";
  const markers = useMemo(() => fillMarkers(fills, bars, timeframe), [fills, bars, timeframe]);

  const build = useCallback(() => {
    if (!containerRef.current) return;
    chartRef.current?.remove();

    const axis = cssVar("--chart-axis", "rgba(29,31,32,0.34)");
    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--muted", "#64748b"),
        fontFamily: "inherit",
        attributionLogo: false,
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { color: cssVar("--chart-grid", "rgba(29,31,32,0.1)"), style: 0 },
      },
      rightPriceScale: { borderColor: axis },
      timeScale: {
        borderColor: axis,
        timeVisible: intraday,
        secondsVisible: false,
        tickMarkFormatter: (time: unknown) => localTick(time, intraday),
      },
      localization: { timeFormatter: (time: unknown) => localCrosshair(time, intraday) },
      crosshair: { mode: 1 },
      autoSize: true,
    });

    const up = cssVar("--up", "#059669");
    const down = cssVar("--down", "#dc2626");

    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up,
      downColor: down,
      borderUpColor: up,
      borderDownColor: down,
      wickUpColor: up,
      wickDownColor: down,
      // The last close is not what this chart is about; the trade's own levels are.
      priceLineVisible: false,
    });
    candles.setData(
      bars.map((b) => ({ time: b.time as UTCTimestamp, open: b.open, high: b.high, low: b.low, close: b.close })),
    );

    const volume = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    volume.setData(
      bars.map((b) => ({ time: b.time as Time, value: b.volume, color: `${b.close >= b.open ? up : down}40` })),
    );

    const lines: [number | null, string, string, LineStyle][] = [
      [levels.entry, "Entry", cssVar("--accent", "#2563eb"), LineStyle.Solid],
      [levels.exit, "Exit", cssVar("--muted", "#64748b"), LineStyle.Solid],
      [levels.stop, "Stop", cssVar("--poor", "#dc2626"), LineStyle.Dashed],
      [levels.target, "Target", cssVar("--good", "#059669"), LineStyle.Dashed],
    ];
    for (const [price, title, color, lineStyle] of lines) {
      if (price == null || !Number.isFinite(price)) continue;
      candles.createPriceLine({ price, title, color, lineStyle, lineWidth: 1, axisLabelVisible: true });
    }

    const drawn: SeriesMarker<Time>[] = markers.map((m, i) => ({
      time: m.time as UTCTimestamp,
      position: m.side === "buy" ? "atPriceBottom" : "atPriceTop",
      price: m.price,
      shape: m.side === "buy" ? "arrowUp" : "arrowDown",
      color: m.side === "buy" ? up : down,
      text: `${m.side === "buy" ? "Buy" : "Sell"} ${num(m.shares, m.shares % 1 === 0 ? 0 : 2)} @ ${num(m.price, 2)}`,
      id: `fill-${i}`,
    }));
    createSeriesMarkers(candles, drawn);

    chart.timeScale().fitContent();
    chartRef.current = chart;
  }, [bars, intraday, levels.entry, levels.exit, levels.stop, levels.target, markers]);

  useEffect(() => {
    build();
    return () => {
      chartRef.current?.remove();
      chartRef.current = null;
    };
  }, [build]);

  // Rebuilt when the theme changes, so the colours follow it.
  useEffect(() => {
    const observer = new MutationObserver(build);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [build]);

  // Why a fill has no arrow: no time to place it on an intraday chart, or a
  // date outside the prices that were captured.
  const untimed = intraday ? fills.filter((f) => !f.at).length : 0;
  const outside = Math.max(0, fills.length - markers.length - untimed);

  return (
    <figure>
      <div className="relative h-[20rem] w-full sm:h-[26rem]">
        <div
          ref={containerRef}
          className="absolute inset-0"
          role="img"
          aria-label={`Price chart of the trade, with ${markers.length} ${markers.length === 1 ? "fill" : "fills"} marked`}
        />
      </div>
      {(untimed > 0 || outside > 0) && (
        <figcaption className="mt-2 space-y-1 text-xs text-faint">
          {untimed > 0 && (
            <p>
              {untimed === 1 ? "One fill has" : `${untimed} fills have`} no time recorded, so{" "}
              {untimed === 1 ? "it is" : "they are"} shown only as the entry or exit line.
            </p>
          )}
          {outside > 0 && (
            <p>
              {outside === 1 ? "One fill falls" : `${outside} fills fall`} outside the prices that were captured, so{" "}
              {outside === 1 ? "it has" : "they have"} no arrow.
            </p>
          )}
        </figcaption>
      )}
    </figure>
  );
}
