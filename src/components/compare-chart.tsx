"use client";

import {
  ColorType,
  createChart,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Bar, Timeframe } from "@/lib/providers/types";
import { daysSinceStartOfYear, resolveDays, type RangeDays } from "@/lib/ranges";
import { cn } from "@/lib/utils";

/**
 * Categorical slots, read from the theme so dark mode uses hues stepped for the
 * dark surface rather than the light ones reused.
 *
 * Four hues, not four steps of one. Every theme used to run a blue ramp here —
 * light was #2563eb, #60a5fa, #a5c4fb, #78849a, which is one colour four times
 * as far as a reader is concerned — and the palette checker agreed: the closest
 * adjacent pair scored ΔE 11.9 to normal vision against a floor of 15, and
 * midnight's cyan pair scored 2.1 to a protan reader. All seven themes failed.
 *
 * Now two validated sets, chosen by surface rather than by theme: blue, orange,
 * green, amber. A chart then reads the same whichever theme it is under, which
 * is the point of a categorical order — the theme supplies the surface, not the
 * identity of series two. Re-check with the data-viz palette validator before
 * changing any of these, and check every theme's surface, not just white:
 * light and minimal sit on #ffffff, the rest on their own dark grounds.
 */
const SERIES_VARS = ["--series-1", "--series-2", "--series-3", "--series-4"];
const SERIES_FALLBACK = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100"];

function seriesColor(i: number): string {
  return cssVar(SERIES_VARS[i % SERIES_VARS.length], SERIES_FALLBACK[i % SERIES_FALLBACK.length]);
}

const RANGES: { label: string; days: RangeDays; timeframe: Timeframe }[] = [
  { label: "1M", days: 30, timeframe: "1Day" },
  { label: "6M", days: 182, timeframe: "1Day" },
  { label: "YTD", days: daysSinceStartOfYear, timeframe: "1Day" },
  { label: "1Y", days: 365, timeframe: "1Day" },
  { label: "5Y", days: 365 * 5, timeframe: "1Week" },
];

interface Series {
  symbol: string;
  bars: Bar[];
  /**
   * Whether this series' closes already have dividends reinvested.
   *
   * Null when the provider did not say. Carried per symbol rather than per
   * chart because failover picks a provider independently for each one, which
   * is precisely how a comparison ends up with one total-return line and one
   * price-only line on the same axis.
   */
  includesDividends: boolean | null;
}

/**
 * What basis a set of lines is drawn on, and whether they agree.
 *
 * The mixed case is the one that matters. Rebasing a total-return series
 * against a price-only one and reading the gap as relative performance
 * credits one holding with a dividend stream the other also paid but never
 * showed — on SPY since 2020 that is roughly 27 percentage points. The
 * backtester guards against this already; this chart could not, because the
 * flag never left the API route.
 */
type Basis = "total-return" | "price-only" | "mixed" | "unknown";

function basisOf(series: Series[]): Basis {
  const known = series
    .map((s) => s.includesDividends)
    .filter((v): v is boolean => v !== null);

  if (known.length === 0 || known.length !== series.length) return "unknown";
  if (known.every((v) => v)) return "total-return";
  if (known.every((v) => !v)) return "price-only";
  return "mixed";
}

/**
 * Converts any of lightweight-charts' time representations into a Date.
 *
 * `Time` is a union: epoch seconds, a "YYYY-MM-DD" string, or a
 * `{ year, month, day }` object, and the library picks between them by series
 * type — daily and weekly data commonly arrives as the object form. Assuming a
 * number produced an invalid Date, which made Intl throw and took the whole
 * chart down with it.
 */
function toDate(time: unknown): Date | null {
  if (typeof time === "number") return new Date(time * 1000);

  if (typeof time === "string") {
    // "YYYY-MM-DD" is parsed as UTC midnight, matching how the library treats it.
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

/**
 * Formats an axis tick in the reader's own timezone.
 *
 * The series carries UTC epoch seconds, which the library renders as UTC — so a
 * US market opening at 9:30 Eastern appeared as 14:30 with nothing to say why.
 * Only the display is shifted; the underlying timestamps stay UTC.
 */
function localTick(time: unknown, intraday: boolean): string {
  const date = toDate(time);
  // An unrecognised shape returns empty rather than throwing: a missing tick
  // label is a blemish, an exception takes the whole chart down.
  if (!date) return "";

  return intraday
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

/** Full local date and time, for the crosshair readout. */
function localCrosshair(time: unknown, intraday: boolean): string {
  const date = toDate(time);
  if (!date) return "";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(intraday ? { timeStyle: "short" as const } : {}),
  }).format(date);
}

function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Relative performance of several symbols on one axis.
 *
 * Prices are rebased so each series starts at 0%, because absolute prices are
 * not comparable — a $600 share moving $6 and a $60 share moving $6 are very
 * different events, and plotting them together would imply otherwise.
 */
export function CompareChart({ symbols }: { symbols: string[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRefs = useRef<ISeriesApi<"Line">[]>([]);

  const [rangeLabel, setRangeLabel] = useState("1Y");
  const [series, setSeries] = useState<Series[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "empty" | "error">("loading");
  const [message, setMessage] = useState<string | null>(null);

  const range =
    RANGES.find((r) => r.label === rangeLabel) ??
    RANGES.find((r) => r.label === "1Y")!;
  const key = symbols.join(",");
  // Resolved once per render so the request and the effect's dependency agree,
  // and so year-to-date is measured at one instant rather than twice.
  const days = resolveDays(range.days);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();

    (async () => {
      setStatus("loading");
      setMessage(null);

      try {
        const loaded = await Promise.all(
          symbols.map(async (symbol) => {
            const res = await fetch(
              `/api/bars?symbol=${encodeURIComponent(symbol)}&timeframe=${range.timeframe}&days=${days}`,
              { signal: controller.signal },
            );
            const json = await res.json();
            // Surface any reported failure, not just a missing key — an invalid
            // key or an exhausted quota otherwise looks like "no data exists".
            if (json.error) throw new Error(json.message ?? json.error);
            return {
              symbol,
              bars: (json.bars ?? []) as Bar[],
              includesDividends:
                typeof json.includesDividends === "boolean" ? json.includesDividends : null,
            };
          }),
        );

        if (cancelled) return;
        const withData = loaded.filter((s) => s.bars.length > 1);
        setSeries(withData);
        setStatus(withData.length === 0 ? "empty" : "ready");
      } catch (err) {
        if (cancelled || (err as Error).name === "AbortError") return;
        setStatus("error");
        setMessage((err as Error).message ?? "Could not load price data.");
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, days, range.timeframe, symbols]);

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
        vertLines: { visible: false },
        // The zero line matters here in a way it does not on a price chart —
        // this axis is percent change, so "level with where it started" is a
        // real reading, and the horizontal rules are what make it findable.
        horzLines: { color: cssVar("--chart-grid", "rgba(29,31,32,0.1)"), style: 0 },
      },
      rightPriceScale: { borderColor: cssVar("--chart-axis", "rgba(29,31,32,0.34)") },
      timeScale: {
        borderColor: cssVar("--chart-axis", "rgba(29,31,32,0.34)"),
        tickMarkFormatter: (time: unknown) => localTick(time, false),
      },
      crosshair: { mode: 1 },
      localization: {
        priceFormatter: (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`,
        timeFormatter: (time: unknown) => localCrosshair(time, false),
      },
      autoSize: true,
    });

    seriesRefs.current = series.map((s, i) =>
      chart.addSeries(LineSeries, {
        color: seriesColor(i),
        lineWidth: 2,
        title: s.symbol,
        priceFormat: { type: "custom", formatter: (v: number) => `${v.toFixed(1)}%` },
      }),
    );

    chartRef.current = chart;
  }, [series]);

  useEffect(() => {
    buildChart();
    return () => {
      chartRef.current?.remove();
      chartRef.current = null;
      seriesRefs.current = [];
    };
  }, [buildChart]);

  useEffect(() => {
    const observer = new MutationObserver(buildChart);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, [buildChart]);

  useEffect(() => {
    if (seriesRefs.current.length !== series.length) return;

    series.forEach((s, i) => {
      const base = s.bars[0]?.close;
      if (!base) return;
      seriesRefs.current[i]?.setData(
        s.bars.map((b) => ({
          time: b.time as UTCTimestamp,
          // Percentage change from the first bar in the window.
          value: ((b.close - base) / base) * 100,
        })),
      );
    });

    chartRef.current?.timeScale().fitContent();
  }, [series]);

  return (
    <div className="flex flex-col gap-3">
      <div className={cn("flex flex-wrap items-center gap-3", status !== "ready" && "hidden")}>
        <div role="group" aria-label="Date range" className="flex border border-border">
          {RANGES.map((r) => (
            <button
              key={r.label}
              type="button"
              aria-pressed={rangeLabel === r.label}
              onClick={() => setRangeLabel(r.label)}
              className={cn(
                "border-r border-border px-2.5 py-1 text-xs font-medium transition-colors last:border-r-0",
                rangeLabel === r.label ? "bg-accent text-accent-fg" : "text-muted hover:text-foreground",
              )}
            >
              {r.label}
            </button>
          ))}
        </div>

        <ul className="flex flex-wrap items-center gap-3">
          {series.map((s, i) => (
            <li key={s.symbol} className="flex items-center gap-1.5 text-xs font-medium">
              <span
                aria-hidden
                className="size-2.5 rounded-full"
                style={{ background: `var(${SERIES_VARS[i % SERIES_VARS.length]})` }}
              />
              {s.symbol}
              {(() => {
                const base = s.bars[0]?.close;
                const last = s.bars[s.bars.length - 1]?.close;
                if (!base || !last) return null;
                const pct = ((last - base) / base) * 100;
                return (
                  <span className={cn("tnum", pct >= 0 ? "text-up" : "text-down")}>
                    {pct >= 0 ? "+" : ""}
                    {pct.toFixed(1)}%
                  </span>
                );
              })()}
            </li>
          ))}
        </ul>
      </div>

      {/* A tall empty frame reads as a broken chart, so the container only
          reserves full height once there is something to draw. */}
      <div
        className={cn(
          "relative w-full transition-[height]",
          status === "ready" ? "h-[360px]" : "h-auto",
        )}
      >
        <div
          ref={containerRef}
          className={cn("absolute inset-0", status !== "ready" && "invisible")}
        />

        {status !== "ready" && (
          <div className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius)] border border-dashed border-border bg-surface-2/40 px-6 py-10 text-center">
            {status === "loading" ? (
              <>
                <div
                  aria-hidden
                  className="size-5 animate-spin rounded-full border-2 border-border border-t-accent"
                />
                <p className="text-sm text-muted">Loading price history…</p>
              </>
            ) : (
              <>
                <p className="text-sm font-medium">
                  {status === "empty" ? "No price history to chart" : "Could not load prices"}
                </p>
                <p className="max-w-md text-sm leading-relaxed text-muted">
                  {status === "empty"
                    ? "The comparison below still works — it comes from company filings, which need no price data."
                    : (message ?? "Could not load price data.")}
                </p>
              </>
            )}
          </div>
        )}
      </div>

      {status === "ready" && <BasisNote basis={basisOf(series)} />}
    </div>
  );
}

/**
 * What the lines actually measure, said plainly under the chart.
 *
 * Not a footnote for completeness. "Did this beat the index" has a different
 * answer depending on whether dividends are counted, and for an income stock
 * against a broad index the difference is most of the gap — so a reader who
 * is not told which they are looking at has been given a number they cannot
 * interpret.
 */
function BasisNote({ basis }: { basis: Basis }) {
  const shared =
    "Each line shows percentage change from the start of the window, so symbols with " +
    "very different share prices can be compared directly.";

  if (basis === "mixed") {
    return (
      <div className="border border-fair px-3.5 py-2.5">
        <p className="text-xs font-semibold">These lines are not on the same basis</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          One of these price histories already has dividends reinvested and another does
          not, because they were answered by different data providers. The gap between
          them therefore includes a dividend stream rather than only performance, so read
          the comparison with that in mind. {shared}
        </p>
      </div>
    );
  }

  const suffix =
    basis === "total-return"
      ? " Dividends are reinvested in every line, so this is total return."
      : basis === "price-only"
        ? " Share price only — dividends paid over the window are not counted, which understates income-paying holdings."
        : " Whether dividends are included was not reported by the data provider.";

  return (
    <p className="text-xs leading-relaxed text-muted">
      {shared}
      {suffix}
    </p>
  );
}
