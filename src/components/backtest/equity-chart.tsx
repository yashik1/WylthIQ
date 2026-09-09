"use client";

import {
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import Link from "next/link";
import { accountIsEnough } from "@/lib/billing/access-mode";
import { useEffect, useRef, useState } from "react";
import type { InvestmentPoint } from "@/lib/backtest/single-stock";
import { ema, sma } from "@/lib/backtest/indicators";
import { cn } from "@/lib/utils";

/**
 * Converts any of lightweight-charts' time representations into a Date.
 * Mirrors the same helper in price-chart.tsx and compare-chart.tsx — daily
 * data can arrive as an epoch number, a date string, or a `{year,month,day}`
 * object depending on the library's own internal path, and assuming a number
 * throughout produced an invalid Date that took a chart down entirely.
 */
function toDate(time: unknown): Date | null {
  if (typeof time === "number") return new Date(time * 1000);
  if (typeof time === "string") {
    const parsed = Date.parse(time.length === 10 ? `${time}T00:00:00Z` : time);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }
  if (time && typeof time === "object") {
    const d = time as { year?: number; month?: number; day?: number };
    if (d.year != null && d.month != null && d.day != null) {
      return new Date(Date.UTC(d.year, d.month - 1, d.day));
    }
  }
  return null;
}

function localTick(time: unknown): string {
  const date = toDate(time);
  if (!date) return "";
  return new Intl.DateTimeFormat(undefined, { year: "numeric", month: "short" }).format(date);
}

function localCrosshair(time: unknown): string {
  const date = toDate(time);
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(date) : "";
}

function cssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

interface Line {
  label: string;
  series: InvestmentPoint[];
}

/**
 * Below this many points an average says more about its own window than about
 * the data. The screener backtest rebalances yearly, so its curve can be six
 * or seven points across — a 50-period average of that is not a smoother line,
 * it is no line at all.
 */
const MIN_POINTS_FOR_AVERAGES = 20;

const MIN_PERIOD = 2;

/**
 * Two dollar-value lines over time: the holding and its benchmark.
 *
 * Both series were built from the same starting amount by `simulateInvestment`,
 * so unlike the price-comparison chart elsewhere in this app, no rebasing to a
 * percentage is needed — the lines are already on the same footing and the
 * gap between them at any point is a real dollar amount, which is closer to
 * how a reader actually thinks about "how did my money do".
 *
 * The averages smooth the portfolio's own value, not a share price. On a
 * backtest that is the more useful reading: it answers "is the strategy's
 * value trending above or below where it has been sitting", which a jagged
 * equity curve makes hard to judge by eye.
 */
/**
 * Whether the moving averages are unlocked.
 *
 * Deliberately a UI gate, not a server one, and worth being clear about why.
 * The equity curve is free, and an SMA is the mean of numbers already on the
 * page — so computing them server-side and withholding them would stop nobody
 * determined while forcing a round trip every time a subscriber nudged the
 * period, turning an instant control into a laggy one. Degrading the paid
 * experience to deter a bypass that yields nothing is the wrong trade. The
 * things that genuinely must not leak — the screener backtest and the journal
 * — are gated at the route and the action, where it counts.
 */
export function EquityChart({
  target,
  benchmark,
  canUseAverages = true,
}: {
  target: Line;
  benchmark: Line | null;
  canUseAverages?: boolean;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  const [showSma, setShowSma] = useState(false);
  const [showEma, setShowEma] = useState(false);
  const [smaPeriod, setSmaPeriod] = useState(50);
  const [emaPeriod, setEmaPeriod] = useState(20);

  const points = target.series.length;
  const averagesAvailable = canUseAverages && points >= MIN_POINTS_FOR_AVERAGES;
  // A period longer than the data produces an empty line with no explanation,
  // so the input is bounded by what the series can actually support.
  const maxPeriod = Math.max(MIN_PERIOD, points - 1);

  // ---- chart lifecycle: rebuilt only when the underlying backtest changes ----
  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: cssVar("--muted", "#64748b"),
        fontFamily: "inherit",
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: cssVar("--border", "#e2e8f0") },
        horzLines: { color: cssVar("--border", "#e2e8f0") },
      },
      rightPriceScale: { borderColor: cssVar("--border", "#e2e8f0") },
      timeScale: {
        borderColor: cssVar("--border", "#e2e8f0"),
        tickMarkFormatter: (time: unknown) => localTick(time),
      },
      crosshair: { mode: 1 },
      localization: {
        priceFormatter: (v: number) =>
          `$${v.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
        timeFormatter: (time: unknown) => localCrosshair(time),
      },
      autoSize: true,
    });

    const targetSeries = chart.addSeries(LineSeries, {
      color: cssVar("--series-1", "#2a78d6"),
      lineWidth: 2,
      title: target.label,
      priceLineVisible: false,
    });
    targetSeries.setData(
      target.series.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
    );

    if (benchmark) {
      const benchSeries = chart.addSeries(LineSeries, {
        color: cssVar("--series-2", "#d97706"),
        lineWidth: 2,
        title: benchmark.label,
        priceLineVisible: false,
      });
      benchSeries.setData(
        benchmark.series.map((p) => ({ time: p.time as UTCTimestamp, value: p.value })),
      );
    }

    /*
      The average series are created here and left empty until switched on.
      Adding and removing a series on each toggle would rebuild the chart and
      throw away whatever the reader had zoomed or panned to, which is exactly
      the moment they are most likely to be reaching for an overlay.
    */
    smaSeriesRef.current = chart.addSeries(LineSeries, {
      color: cssVar("--series-3", "#5148d8"),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    emaSeriesRef.current = chart.addSeries(LineSeries, {
      color: cssVar("--series-4", "#c42a68"),
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });

    chart.timeScale().fitContent();
    chartRef.current = chart;

    return () => {
      chart.remove();
      chartRef.current = null;
      smaSeriesRef.current = null;
      emaSeriesRef.current = null;
    };
  }, [target, benchmark]);

  // ---- overlay data: updated in place, so toggling keeps the current view ----
  useEffect(() => {
    const values = target.series.map((p) => p.value);
    const times = target.series.map((p) => p.time as UTCTimestamp);

    /*
      A null becomes a whitespace point rather than being dropped. Dropping the
      leading positions would shift every remaining value one bar earlier than
      the figure it describes — a line that looks entirely plausible and is
      quietly wrong, which is the failure mode worth engineering against.
    */
    const paint = (series: ISeriesApi<"Line"> | null, computed: (number | null)[] | null) => {
      if (!series) return;
      if (!computed) {
        series.setData([]);
        return;
      }
      series.setData(
        times.map((time, i) =>
          computed[i] == null ? { time } : { time, value: computed[i] as number },
        ),
      );
    };

    const clamp = (p: number) => Math.min(Math.max(Math.round(p), MIN_PERIOD), maxPeriod);

    paint(
      smaSeriesRef.current,
      showSma && averagesAvailable ? sma(values, clamp(smaPeriod)) : null,
    );
    paint(
      emaSeriesRef.current,
      showEma && averagesAvailable ? ema(values, clamp(emaPeriod)) : null,
    );
  }, [target, showSma, showEma, smaPeriod, emaPeriod, averagesAvailable, maxPeriod]);

  return (
    <div className="flex flex-col gap-3">
      {!canUseAverages ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-surface-2 px-3.5 py-2.5">
          <span className="text-xs font-semibold">Moving averages</span>
          <span className="min-w-0 flex-1 text-xs text-muted">
            Overlay a simple or exponential moving average, at any period, to see the
            trend under the noise.
          </span>
          {/* Sends people where they can actually unlock it, which depends on
              what unlocking it currently costs. */}
          <Link
            href={accountIsEnough ? "/signup" : "/account"}
            className="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            {accountIsEnough ? "Create an account" : "Subscribe"}
          </Link>
        </div>
      ) : (
      <div className="flex flex-wrap items-center gap-2">
        <AverageControl
          label="SMA"
          hint={
            averagesAvailable
              ? "Simple moving average — the plain mean of the last N points."
              : `Needs at least ${MIN_POINTS_FOR_AVERAGES} points; this backtest has ${points}.`
          }
          enabled={showSma}
          onToggle={() => setShowSma((v) => !v)}
          period={smaPeriod}
          onPeriod={setSmaPeriod}
          max={maxPeriod}
          disabled={!averagesAvailable}
          swatch="var(--series-3)"
        />
        <AverageControl
          label="EMA"
          hint={
            averagesAvailable
              ? "Exponential moving average — weights recent points more heavily."
              : `Needs at least ${MIN_POINTS_FOR_AVERAGES} points; this backtest has ${points}.`
          }
          enabled={showEma}
          onToggle={() => setShowEma((v) => !v)}
          period={emaPeriod}
          onPeriod={setEmaPeriod}
          max={maxPeriod}
          disabled={!averagesAvailable}
          swatch="var(--series-4)"
        />

        {(showSma || showEma) && averagesAvailable && (
          <span className="text-xs text-faint">
            Smoothing the portfolio&apos;s value, not a share price. Descriptive only —
            neither line forecasts anything.
          </span>
        )}
      </div>
      )}

      <div ref={containerRef} className="h-[380px] w-full" />
    </div>
  );
}

function AverageControl({
  label,
  hint,
  enabled,
  onToggle,
  period,
  onPeriod,
  max,
  disabled,
  swatch,
}: {
  label: string;
  hint: string;
  enabled: boolean;
  onToggle: () => void;
  period: number;
  onPeriod: (n: number) => void;
  max: number;
  disabled: boolean;
  swatch: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        aria-pressed={enabled}
        onClick={onToggle}
        disabled={disabled}
        title={hint}
        className={cn(
          "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors",
          disabled
            ? "cursor-not-allowed border-border text-faint"
            : enabled
              ? "border-accent bg-accent-soft text-accent"
              : "border-border text-muted hover:text-foreground",
        )}
      >
        <span
          aria-hidden
          className="h-0.5 w-3 rounded-full"
          style={{ background: disabled ? "currentColor" : swatch }}
        />
        {label}
      </button>

      <label className="sr-only" htmlFor={`${label}-period`}>
        {label} period
      </label>
      <input
        id={`${label}-period`}
        type="number"
        inputMode="numeric"
        min={2}
        max={max}
        value={period}
        disabled={disabled || !enabled}
        onChange={(e) => {
          const next = Number(e.target.value);
          if (Number.isFinite(next)) onPeriod(next);
        }}
        className={cn(
          "tnum w-14 rounded-lg border border-border bg-surface px-2 py-1 text-xs",
          (disabled || !enabled) && "cursor-not-allowed text-faint",
        )}
      />
    </div>
  );
}
