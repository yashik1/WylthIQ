"use client";

import {
  AreaSeries,
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Bar, CorporateEvent, Timeframe } from "@/lib/providers/types";
import {
  nearestBar,
  placeEvents,
  projectNextEvents,
  type ProjectedEvent,
} from "@/lib/chart-markers";
import { daysSinceStartOfYear, resolveDays, type RangeDays } from "@/lib/ranges";
import { cssVar, localCrosshair, localTick } from "@/lib/chart-theme";
import { cn } from "@/lib/utils";
import { LocalTime, useTimeZone } from "@/components/local-time";

type ChartStyle = "candles" | "line" | "area";

/**
 * Ranges offered per timeframe, in days.
 *
 * Year-to-date sits between the six-month and one-year windows, which is where
 * it falls for most of the year and where a reader looks for it. Its length is
 * a function rather than a constant because the calendar decides it.
 */
const RANGES: { label: string; days: RangeDays; timeframe: Timeframe }[] = [
  { label: "1D", days: 1, timeframe: "1Min" },
  { label: "5D", days: 5, timeframe: "5Min" },
  { label: "1M", days: 30, timeframe: "15Min" },
  { label: "6M", days: 182, timeframe: "1Hour" },
  { label: "YTD", days: daysSinceStartOfYear, timeframe: "1Day" },
  { label: "1Y", days: 365, timeframe: "1Day" },
  { label: "5Y", days: 365 * 5, timeframe: "1Day" },
  { label: "Max", days: 365 * 20, timeframe: "1Week" },
];

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: "1Min", label: "1m" },
  { value: "5Min", label: "5m" },
  { value: "15Min", label: "15m" },
  { value: "1Hour", label: "1h" },
  { value: "1Day", label: "1D" },
  { value: "1Week", label: "1W" },
];

/** Longest window each timeframe can serve, mirroring the API's caps. */
const MAX_DAYS: Record<Timeframe, number> = {
  "1Min": 7,
  "5Min": 30,
  "15Min": 60,
  "1Hour": 365,
  "1Day": 365 * 10,
  "1Week": 365 * 25,
};

/**
 * Turns events into markers the chart can draw.
 *
 * Placement lives in chart-markers.ts and is shared with its tests; this maps
 * the result onto the library's shapes and the theme's colours.
 */
function buildMarkers(events: CorporateEvent[], bars: Bar[]): SeriesMarker<Time>[] {
  const style = {
    dividend: { color: cssVar("--up", "#059669"), shape: "circle" as const },
    split: { color: cssVar("--accent", "#a35d00"), shape: "arrowUp" as const },
    earnings: { color: cssVar("--muted-strong", "#6b7280"), shape: "square" as const },
  };

  return placeEvents(events, bars).map((e) => ({
    time: e.time as Time,
    position: "aboveBar" as const,
    color: style[e.kind].color,
    shape: style[e.kind].shape,
    text: e.label,
    id: e.id,
  }));
}

/**
 * Markers for dates that have not happened yet.
 *
 * Drawn deliberately unlike the confirmed ones — the muted colour and a label
 * that says "due" rather than naming an amount. A reader who cannot tell an
 * estimate from a scheduled date is worse off than one shown nothing, and the
 * reader this app is for is exactly the one who would not think to check. The
 * sentence beneath the chart carries the caveat in full.
 */
function buildProjected(
  projections: ProjectedEvent[],
  future: { time: UTCTimestamp; value: number }[],
): SeriesMarker<Time>[] {
  if (future.length === 0) return [];

  const slots = future.map((f) => ({ time: f.time as number }));
  const muted = cssVar("--faint", "#9ca3af");

  return projections.map((p) => ({
    // Snapped the same way past events are, and for the same reason.
    time: nearestBar(slots, p.time) as Time,
    position: "aboveBar" as const,
    color: muted,
    shape: "circle" as const,
    text: p.kind === "earnings" ? "Results due" : "Dividend due",
    id: `expected-${p.kind}`,
  }));
}

/**
 * A price series in a currency other than the one it traded in.
 *
 * The page's header price is restated when a reader picks a currency, and a
 * chart underneath it still drawn in dollars would put two different prices
 * for the same share on one screen. Volume is a count of shares and does not
 * move.
 */
export function scaleBars(bars: Bar[], rate: number): Bar[] {
  if (!Number.isFinite(rate) || rate === 1 || rate <= 0) return bars;
  return bars.map((bar) => ({
    ...bar,
    open: bar.open * rate,
    high: bar.high * rate,
    low: bar.low * rate,
    close: bar.close * rate,
  }));
}

export function PriceChart({
  symbol,
  rate = 1,
}: {
  symbol: string;
  /** What one unit of the trading currency is worth in the displayed one. */
  rate?: number;
}) {
  const zone = useTimeZone();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const priceSeriesRef = useRef<ISeriesApi<"Candlestick" | "Line" | "Area"> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const eventSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const [rangeLabel, setRangeLabel] = useState("1Y");
  const [timeframe, setTimeframe] = useState<Timeframe>("1Day");
  const [style, setStyle] = useState<ChartStyle>("candles");
  const [bars, setBars] = useState<Bar[]>([]);
  const [events, setEvents] = useState<CorporateEvent[]>([]);
  const [showEvents, setShowEvents] = useState(true);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  /*
    What is probably next, stated in words below the chart rather than drawn on
    it.

    No free source publishes confirmed dates per symbol — Yahoo's calendar
    answers 401, Finnhub's needs a working key, Nasdaq's is queryable only by
    date — so these are the company's own rhythm carried forward, and only where
    that rhythm is regular enough to mean something.

    In words because an estimate deserves its caveat attached. A marker sitting
    on the axis alongside four confirmed ones reads as a scheduled date however
    it is coloured, and the reader who would take it that way is the one this is
    written for. Prose can say "expected", give the interval it rests on, and
    admit that nothing has been announced.
  */
  // Memoised because the render effect depends on it. Recomputed each render it
  // would be a new array every time, redrawing the whole series on every pass.
  const expected = useMemo(
    () => (showEvents ? projectNextEvents(events) : []),
    [events, showEvents],
  );

  // Found by label rather than by index, so inserting a range cannot silently
  // change which one is the fallback.
  const range =
    RANGES.find((r) => r.label === rangeLabel) ??
    RANGES.find((r) => r.label === "1Y")!;

  // ---- data ----
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      setStatus("loading");
      setMessage(null);

      // A range longer than the timeframe can serve is clamped rather than
      // silently returning a partial window.
      const days = Math.min(resolveDays(range.days), MAX_DAYS[timeframe]);

      try {
        const res = await fetch(
          `/api/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${timeframe}&days=${days}`,
          { signal: controller.signal },
        );
        const json = await res.json();
        if (cancelled) return;

        // Any reported failure is shown verbatim. Collapsing an invalid key or
        // an exhausted quota into "no data" hides the only useful information.
        if (json.error) {
          setStatus("error");
          setMessage(json.message ?? json.error);
          return;
        }
        const next: Bar[] = scaleBars(json.bars ?? [], rate);
        setBars(next);
        setStatus(next.length === 0 ? "empty" : "ready");
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") return;
        setStatus("error");
        setMessage("Could not load price data.");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbol, timeframe, range.days, rate]);

  // Fetched separately from the bars so that losing the annotation never costs
  // the chart itself.
  useEffect(() => {
    let cancelled = false;
    const days = resolveDays(range.days);

    (async () => {
      try {
        const res = await fetch(`/api/events?symbol=${encodeURIComponent(symbol)}&days=${days}`);
        const json = await res.json();
        if (!cancelled) setEvents((json.events ?? []) as CorporateEvent[]);
      } catch {
        if (!cancelled) setEvents([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [symbol, range.days]);

  // ---- chart lifecycle ----
  const buildChart = useCallback(() => {
    if (!containerRef.current) return;

    chartRef.current?.remove();

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--muted", "#64748b"),
        fontFamily: "inherit",
        attributionLogo: false,
      },
      grid: {
        // Vertical rules dropped entirely. The time axis is already ruled by
        // its own tick labels, and a full cross-hatch competes with the series
        // it exists to help read.
        vertLines: { visible: false },
        horzLines: { color: cssVar("--chart-grid", "rgba(29,31,32,0.1)"), style: 0 },
      },
      rightPriceScale: { borderColor: cssVar("--chart-axis", "rgba(29,31,32,0.34)") },
      timeScale: {
        borderColor: cssVar("--chart-axis", "rgba(29,31,32,0.34)"),
        // Intraday needs the clock; daily and weekly do not.
        timeVisible: timeframe !== "1Day" && timeframe !== "1Week",
        secondsVisible: false,
        // Rendered in the reader's zone rather than UTC, which is what the
        // library would otherwise show for these timestamps.
        tickMarkFormatter: (time: unknown) =>
          localTick(time, timeframe !== "1Day" && timeframe !== "1Week"),
      },
      localization: {
        timeFormatter: (time: unknown) =>
          localCrosshair(time, timeframe !== "1Day" && timeframe !== "1Week"),
      },
      crosshair: { mode: 1 },
      autoSize: true,
    });

    const up = cssVar("--up", "#059669");
    const down = cssVar("--down", "#dc2626");
    const accent = cssVar("--accent", "#2563eb");

    if (style === "candles") {
      priceSeriesRef.current = chart.addSeries(CandlestickSeries, {
        upColor: up,
        downColor: down,
        borderUpColor: up,
        borderDownColor: down,
        wickUpColor: up,
        wickDownColor: down,
      });
    } else if (style === "line") {
      priceSeriesRef.current = chart.addSeries(LineSeries, {
        color: accent,
        lineWidth: 2,
      });
    } else {
      // A flat wash rather than a gradient. The area style exists to weight the
      // space under the line, which one even tint does; a fade implies the
      // lower half of the range matters less, which is not a claim about the
      // data.
      priceSeriesRef.current = chart.addSeries(AreaSeries, {
        lineColor: accent,
        topColor: `${accent}1f`,
        bottomColor: `${accent}1f`,
        lineWidth: 2,
      });
    }

    volumeSeriesRef.current = chart.addSeries(HistogramSeries, {
      priceFormat: { type: "volume" },
      priceScaleId: "volume",
    });
    // Volume keeps the bottom fifth, held clear of the very foot of the plot so
    // the event row below has a band of its own rather than sitting on top of
    // the bars.
    chart.priceScale("volume").applyOptions({
      scaleMargins: { top: 0.75, bottom: 0.12 },
    });

    /*
      An invisible rail along the foot of the chart, carrying nothing but the
      event markers.
      
      Markers have to belong to a series, and hanging them off the price meant
      each one sat at whatever height its bar happened to reach — so they
      scattered up and down the chart and cluttered the line they were
      annotating. Anchored here they form a single row against the date axis,
      which is where a reader looks to ask "when did that happen?".
    */
    eventSeriesRef.current = chart.addSeries(LineSeries, {
      color: "transparent",
      priceScaleId: "events",
      lastValueVisible: false,
      priceLineVisible: false,
      crosshairMarkerVisible: false,
    });
    chart.priceScale("events").applyOptions({
      scaleMargins: { top: 0.94, bottom: 0 },
    });

    chartRef.current = chart;
  }, [style, timeframe]);

  useEffect(() => {
    buildChart();
    return () => {
      chartRef.current?.remove();
      chartRef.current = null;
      priceSeriesRef.current = null;
      volumeSeriesRef.current = null;
      eventSeriesRef.current = null;
      // Bound to the series that was just removed; a stale handle would write
      // markers to a chart that no longer exists.
      markersRef.current = null;
    };
  }, [buildChart]);

  // Rebuild on theme change so chart colours follow the palette.
  useEffect(() => {
    const observer = new MutationObserver(buildChart);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, [buildChart]);

  // ---- render data ----
  useEffect(() => {
    const price = priceSeriesRef.current;
    const volume = volumeSeriesRef.current;
    if (!price || !volume || bars.length === 0) return;

    if (style === "candles") {
      price.setData(
        bars.map((b) => ({
          time: b.time as UTCTimestamp,
          open: b.open,
          high: b.high,
          low: b.low,
          close: b.close,
        })),
      );
    } else {
      price.setData(
        bars.map((b) => ({ time: b.time as UTCTimestamp, value: b.close })),
      );
    }

    const up = cssVar("--up", "#059669");
    const down = cssVar("--down", "#dc2626");
    volume.setData(
      bars.map((b) => ({
        time: b.time as Time,
        value: b.volume,
        color: `${b.close >= b.open ? up : down}40`,
      })),
    );

    // The rail needs a point on every bar, or a marker on a bar it does not
    // cover has nothing to attach to and is dropped.
    const rail = eventSeriesRef.current;
    if (rail) {
      const spacing = bars.length > 1 ? bars[1].time - bars[0].time : 86_400;
      const lastBar = bars[bars.length - 1].time;

      /*
        An expected date lies past the final bar, so there is nothing there to
        pin a marker to. These extra points extend the rail, and with it the
        time axis, far enough to reach it.

        They carry a real value rather than being blank. Trailing blanks are
        trimmed, so the axis snapped straight back to the last bar and the
        marker sat off-screen with no error to show for it. The rail is
        transparent, so a value draws nothing.

        Only on daily and weekly charts, and only when the wait is short next to
        the window on screen: ten weeks would add six thousand blank minutes to
        an intraday chart, and on a one-month view it would squeeze a month of
        trading into a third of the width to make room for an estimate.
      */
      const reachable =
        timeframe === "1Day" || timeframe === "1Week" ? expected : [];
      const furthest = reachable.reduce((m, p) => Math.max(m, p.time), 0);
      const extraBars = furthest > lastBar ? Math.ceil((furthest - lastBar) / spacing) : 0;
      const affordable = extraBars > 0 && extraBars <= bars.length * 0.3;

      const future = affordable
        ? Array.from({ length: extraBars }, (_, i) => ({
            time: (lastBar + (i + 1) * spacing) as UTCTimestamp,
            value: 0,
          }))
        : [];

      rail.setData([
        ...bars.map((b) => ({ time: b.time as UTCTimestamp, value: 0 })),
        ...future,
      ]);

      const markers = (markersRef.current ??= createSeriesMarkers(rail, []));
      markers.setMarkers(
        showEvents
          ? [
              ...buildMarkers(events, bars),
              ...(affordable ? buildProjected(reachable, future) : []),
            ]
          : [],
      );
    }

    chartRef.current?.timeScale().fitContent();
  }, [bars, style, events, showEvents, timeframe, expected]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Range presets */}
        <div
          role="group"
          aria-label="Date range"
          className="flex border border-border"
        >
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              aria-pressed={rangeLabel === r.label}
              onClick={() => {
                setRangeLabel(r.label);
                setTimeframe(r.timeframe);
              }}
              className={cn(
                "border-r border-border px-2.5 py-1 text-xs font-medium transition-colors last:border-r-0",
                rangeLabel === r.label
                  ? "bg-accent text-accent-fg"
                  : "text-muted hover:bg-surface hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        {/* Explicit timeframe control — the day/hour/minute filter */}
        <div
          role="group"
          aria-label="Candle interval"
          className="flex border border-border"
        >
          {TIMEFRAMES.map((t) => (
            <button
              key={t.value}
              type="button"
              aria-pressed={timeframe === t.value}
              onClick={() => setTimeframe(t.value)}
              className={cn(
                "border-r border-border px-2.5 py-1 text-xs font-medium transition-colors last:border-r-0",
                timeframe === t.value
                  ? "bg-accent text-accent-fg"
                  : "text-muted hover:bg-surface hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/*
          Off is a real choice: on a five-year daily chart a marker every
          quarter plus one every dividend crowds the line it is annotating.
        */}
        <button
          type="button"
          aria-pressed={showEvents}
          onClick={() => setShowEvents((v) => !v)}
          disabled={events.length === 0}
          className={cn(
            "ml-auto rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
            events.length === 0
              ? "cursor-not-allowed border-border text-faint"
              : showEvents
                ? "border-accent bg-accent-soft text-accent"
                : "border-border text-muted hover:text-foreground",
          )}
          title={
            events.length === 0
              ? "No dividends, splits or results dates in this window"
              : "Show dividends, splits and results dates"
          }
        >
          Events
        </button>

        <div
          role="group"
          aria-label="Chart style"
          className="flex border border-border"
        >
          {(["candles", "line", "area"] as ChartStyle[]).map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={style === s}
              onClick={() => setStyle(s)}
              className={cn(
                "border-r border-border px-2.5 py-1 text-xs font-medium capitalize transition-colors last:border-r-0",
                style === s
                  ? "bg-accent text-accent-fg"
                  : "text-muted hover:bg-surface hover:text-foreground",
              )}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/*
        A key for the markers. Shapes and colours mean nothing on their own, and
        the whole reason for marking a split is that a reader would otherwise
        misread the drop — leaving them to guess what a triangle means would
        reproduce the problem in a different form.
      */}
      {showEvents && events.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
          {(
            [
              ["dividend", "Dividend paid", "bg-up"],
              ["split", "Share split", "bg-accent"],
              ["earnings", "Results published", "bg-muted-strong"],
            ] as const
          )
            .filter(([kind]) => events.some((e) => e.kind === kind))
            .map(([kind, label, colour]) => (
              <span key={kind} className="flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2 rounded-full", colour)} />
                {label}
              </span>
            ))}

        </div>
      )}

      {expected.length > 0 && (
        <p className="text-xs leading-relaxed text-faint">
          {expected.map((p) => (
            <span key={p.kind} className="mr-3 inline-block">
              {p.kind === "earnings" ? "Results" : "Next dividend"} expected around{" "}
              <LocalTime value={p.time * 1000} mode="date" />, going by{" "}
              {p.intervalDays}-day gaps
              {p.driftDays > 0 ? ` that have varied by up to ${p.driftDays} days` : " every time"}
              . No date has been confirmed.
            </span>
          ))}
        </p>
      )}

      <div className="relative h-[420px] w-full">
        <div ref={containerRef} className="absolute inset-0" />

        {status !== "ready" && (
          <div className="absolute inset-0 flex items-center justify-center bg-surface/60 backdrop-blur-[1px]">
            <p className="max-w-sm px-6 text-center text-sm text-muted">
              {status === "loading" && "Loading price history…"}
              {status === "empty" &&
                `No ${timeframe} price data available for ${symbol} in this range.`}
              {status === "error" && (message ?? "Could not load price data.")}
            </p>
          </div>
        )}
      </div>

      {bars.length > 0 && (
        <p className="text-xs text-muted">
          {bars.length.toLocaleString()} bars · {timeframe} interval
          {zone && ` · times shown in ${zone}`}
        </p>
      )}
    </div>
  );
}
