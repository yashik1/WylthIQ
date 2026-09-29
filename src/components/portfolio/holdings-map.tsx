"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { money, percent } from "@/lib/format";
import { gainStep, GAIN_BOUNDS, mapCompanies, squarify, type PortfolioChart } from "@/lib/portfolio/charts";
import { cn } from "@/lib/utils";

/**
 * Every company held, as one tile: its area is its share of the portfolio's
 * value, its shade how far it is up or down on what was paid.
 *
 * The shades run from the theme's own loss colour through a neutral grey to
 * its gain colour, three steps each way, mixed over the neutral so that the
 * page's ordinary text stays readable on every tile in every theme (at least
 * 4.5:1, checked against each theme's tokens). The shade is never the only
 * key: a tile large enough to hold them carries its ticker and signed change,
 * and every tile's full figures are in its hover or focus readout and in the
 * holdings table below.
 */

/** How much of the gain or loss colour each step mixes over the neutral, strongest last. */
const STEP_MIX = [10, 22, 34];

function shade(step: number): string {
  if (step === 0) return "var(--surface-3)";
  const pole = step > 0 ? "var(--up)" : "var(--down)";
  return `color-mix(in srgb, ${pole} ${STEP_MIX[Math.abs(step) - 1]}%, var(--surface-3))`;
}

function signed(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(1)}%`;
}

export function HoldingsMap({ chart }: { chart: PortfolioChart }) {
  const frame = useRef<HTMLDivElement>(null);
  const [{ width, height }, setSize] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({ width: Math.floor(entry.contentRect.width), height: Math.floor(entry.contentRect.height) }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const companies = mapCompanies(chart);
  const rects = width > 0 && height > 0 ? squarify(companies.map((c) => c.value), width, height) : [];
  const shown = companies.findIndex((c) => c.symbol === active);

  return (
    <div className="space-y-3 p-5">
      {/*
        Sized by CSS, so the frame is right before any script runs: a little
        over half as tall as it is wide, within bounds, so a phone's narrow
        map does not crush its tiles. The tiles are laid out once it is measured.
      */}
      <div
        ref={frame}
        className="relative aspect-[25/14] max-h-[440px] min-h-[240px] w-full"
        onPointerLeave={() => setActive(null)}
      >
        {rects.map((rect, index) => {
          const company = companies[index];
          if (rect.w <= 0 || rect.h <= 0) return null;
          // Inset by a pixel on every side: the 2px of page between tiles is what separates them.
          const w = Math.max(0, rect.w - 2);
          const h = Math.max(0, rect.h - 2);
          // A label goes inside a tile only when it fits with room to spare,
          // measured against a generous width per character; otherwise the
          // readout and the table carry it, rather than a clipped ticker.
          const large = w >= 120 && h >= 72;
          const perChar = large ? 8.8 : 7.6;
          const fits = (text: string) => text.length * perChar + 12 <= w;
          const showTicker = h >= 22 && fits(company.symbol);
          const showChange = showTicker && h >= 42 && fits(signed(company.gainPercent));
          return (
            <Link
              key={company.symbol}
              href={`/stock/${encodeURIComponent(company.symbol)}`}
              aria-label={`${company.symbol}${company.name ? `, ${company.name}` : ""}: ${money(company.value, chart.currency)}, ${percent(company.share)} of the portfolio, ${company.gainPercent == null ? "no cost to compare" : `${signed(company.gainPercent)} on cost`}`}
              onPointerEnter={() => setActive(company.symbol)}
              onFocus={() => setActive(company.symbol)}
              onBlur={() => setActive(null)}
              className={cn(
                "absolute overflow-hidden rounded-[4px] p-1.5 text-foreground outline-none transition-[filter,box-shadow] duration-150",
                active === company.symbol && "z-10 shadow-[0_0_0_2px_var(--foreground)]",
              )}
              style={{
                left: rect.x + 1,
                top: rect.y + 1,
                width: w,
                height: h,
                background: shade(gainStep(company.gainPercent)),
              }}
            >
              {showTicker && (
                <span className={cn("block truncate font-semibold leading-tight", large ? "text-sm" : "text-xs")}>
                  {company.symbol}
                </span>
              )}
              {showChange && (
                <span className={cn("tnum block truncate leading-tight", large ? "text-sm" : "text-xs")}>
                  {signed(company.gainPercent)}
                </span>
              )}
              {large && showChange && (
                <span className="tnum block truncate text-xs text-muted-strong">{percent(company.share)}</span>
              )}
            </Link>
          );
        })}

        {shown >= 0 && rects[shown] && (
          <Readout
            company={companies[shown]}
            currency={chart.currency}
            rect={rects[shown]}
            frameWidth={width}
            frameHeight={height}
          />
        )}
      </div>

      <Scale />
    </div>
  );
}

/** The figures for the tile pointed at or focused, placed beside it and kept inside the map. */
function Readout({
  company,
  currency,
  rect,
  frameWidth,
  frameHeight,
}: {
  company: ReturnType<typeof mapCompanies>[number];
  currency: string;
  rect: { x: number; y: number; w: number; h: number };
  frameWidth: number;
  frameHeight: number;
}) {
  const boxWidth = 200;
  const boxHeight = 92;
  const right = rect.x + rect.w + 8;
  const left = right + boxWidth <= frameWidth ? right : Math.max(0, rect.x - boxWidth - 8);
  const top = Math.min(Math.max(0, rect.y), Math.max(0, frameHeight - boxHeight));
  const gain = company.gainPercent != null ? company.value - company.cost : null;

  return (
    <div
      role="status"
      className="pointer-events-none absolute z-20 w-[200px] rounded-lg border border-border bg-surface p-2.5 text-xs shadow-md"
      style={{ left, top }}
    >
      <p className="text-sm font-semibold">{money(company.value, currency)}</p>
      <p className="mt-0.5 truncate text-muted">
        <span className="font-medium text-foreground">{company.symbol}</span>
        {company.name && ` · ${company.name}`}
      </p>
      <p className="mt-1 text-muted">{percent(company.share)} of the portfolio</p>
      <p className={cn("tnum", gain != null && gain > 0 && "text-up", gain != null && gain < 0 && "text-down")}>
        {gain == null
          ? "No cost to compare"
          : `${gain < 0 ? "−" : "+"}${money(Math.abs(gain), currency)} (${signed(company.gainPercent)}) on cost`}
      </p>
    </div>
  );
}

/** The key to the shades: losses on the left, gains on the right, with where each step begins. */
function Scale() {
  const steps = [-3, -2, -1, 0, 1, 2, 3];
  const bounds = [...GAIN_BOUNDS].reverse().map((b) => -b).concat([...GAIN_BOUNDS]);
  return (
    <div className="max-w-sm">
      <div className="flex justify-between text-[11px] text-muted">
        <span>Loss on cost</span>
        <span>Gain on cost</span>
      </div>
      <div className="mt-1 flex gap-[2px]" aria-hidden>
        {steps.map((step) => (
          <span key={step} className="h-2.5 flex-1 rounded-[3px]" style={{ background: shade(step) }} />
        ))}
      </div>
      <div className="relative mt-1 h-3.5 text-[10px] text-faint" aria-hidden>
        {bounds.map((bound, index) => (
          <span
            key={bound}
            className="tnum absolute -translate-x-1/2"
            style={{ left: `${((index + 1) / steps.length) * 100}%` }}
          >
            {signed(bound).replace(".0%", "%")}
          </span>
        ))}
      </div>
      <p className="sr-only">
        Tiles are shaded from loss to gain on cost: within 2% is grey, and the colour strengthens past{" "}
        {GAIN_BOUNDS.map((b) => percent(b, 0)).join(", ")} either way.
      </p>
    </div>
  );
}
