"use client";

import { useState } from "react";
import { CompareChart } from "@/components/compare-chart";
import { PriceChart } from "@/components/price-chart";
import { cn } from "@/lib/utils";

/**
 * The benchmark every holding is really competing with.
 *
 * Around nine in ten retail investors underperform a broad index, which makes
 * "would I have done better just buying the whole market" the single most
 * decision-relevant comparison on this page — and until now it was the one
 * comparison a reader could not reach from here. The machinery already
 * existed at /compare; what was missing was a door.
 */
const BENCHMARK = "SPY";

type Mode = "single" | "benchmark" | "peers";

/**
 * The stock page's price panel, switchable between this company alone, the
 * company against the market, and the company against its industry peers.
 *
 * These are genuinely different views rather than one chart with a toggle. A
 * single company is read as a price — candles, volume, intraday detail. A
 * comparison is read as relative performance, so it rebases every line to zero
 * and drops volume, because plotting several companies' absolute prices on one
 * axis implies a relationship the numbers do not have.
 */
export function PricePanel({
  symbol,
  peers,
  rate = 1,
}: {
  symbol: string;
  peers: string[];
  /**
   * The rate the page's prices were restated at, so this chart draws the same
   * currency as the price above it. The comparison modes plot percentage
   * performance, which no rate changes.
   */
  rate?: number;
}) {
  const [mode, setMode] = useState<Mode>("single");

  // Four lines is where a comparison stays readable, and it matches the
  // validated categorical palette, which has four slots.
  const peerSymbols = peers.slice(0, 3);
  const canCompare = peerSymbols.length > 0;
  // Charting SPY against SPY is a flat line and a wasted control.
  const canBenchmark = symbol.toUpperCase() !== BENCHMARK;

  const options: { mode: Mode; label: string; available: boolean }[] = [
    { mode: "single", label: `${symbol} alone`, available: true },
    { mode: "benchmark", label: "vs. the S&P 500", available: canBenchmark },
    { mode: "peers", label: "vs. peers", available: canCompare },
  ];
  const shown = options.filter((o) => o.available);

  return (
    <div className="flex flex-col gap-4">
      {shown.length > 1 && (
        <div className="flex flex-wrap items-center gap-3">
          {/*
            Segmented rather than a row of pills, matching the chart controls
            everywhere else in the app: one frame, hairline dividers, the
            active cell filled.
          */}
          <div role="group" aria-label="Chart view" className="flex border border-border">
            {shown.map((option) => (
              <button
                key={option.mode}
                type="button"
                aria-pressed={mode === option.mode}
                onClick={() => setMode(option.mode)}
                className={cn(
                  "border-r border-border px-2.5 py-1 text-xs font-medium transition-colors last:border-r-0",
                  mode === option.mode
                    ? "bg-accent text-accent-fg"
                    : "text-muted hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>

          {mode === "peers" && (
            <p className="text-xs text-muted">
              Against {peerSymbols.join(", ")} — companies in the same industry.
            </p>
          )}
          {mode === "benchmark" && (
            <p className="text-xs text-muted">
              Against SPY, a fund tracking the 500 largest US companies — roughly
              &ldquo;the market&rdquo;.
            </p>
          )}
        </div>
      )}

      {mode === "single" && <PriceChart symbol={symbol} rate={rate} />}
      {mode === "benchmark" && <CompareChart symbols={[symbol, BENCHMARK]} />}
      {mode === "peers" && <CompareChart symbols={[symbol, ...peerSymbols]} />}
    </div>
  );
}
