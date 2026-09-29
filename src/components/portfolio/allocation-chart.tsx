"use client";

import { useState } from "react";
import { money, percent } from "@/lib/format";
import { slices, usefulSlicings, type PortfolioChart, type Slice, type SliceBy } from "@/lib/portfolio/charts";
import { cn } from "@/lib/utils";

/**
 * Where the portfolio's value sits, as a ring.
 *
 * Six segments at most, each in its own colour in the palette's fixed order,
 * so neighbours stay distinguishable for colour-blind readers too; anything
 * past the five largest folds into a grey "Other". Colour is never the only
 * key: the table beside the ring names every segment with its share and value,
 * and pointing at or focusing a segment (or its row) shows the same in the
 * middle of the ring.
 */

const LABELS: Record<SliceBy, string> = {
  company: "Company",
  sector: "Sector",
  broker: "Broker",
  currency: "Currency",
};

const SIZE = 220;
const CENTER = SIZE / 2;
const OUTER = 104;
const INNER = 76;
/** How far the pointed-at segment grows outward. */
const LIFT = 5;

function colourOf(slice: Slice, index: number): string {
  return slice.other ? "var(--faint)" : `var(--series-${index + 1})`;
}

function point(radius: number, angle: number): string {
  return `${(CENTER + radius * Math.cos(angle)).toFixed(3)} ${(CENTER + radius * Math.sin(angle)).toFixed(3)}`;
}

/** A ring segment from one angle to another, clockwise from twelve o'clock. */
function arc(start: number, end: number, outer: number): string {
  const a0 = start * 2 * Math.PI - Math.PI / 2;
  const a1 = end * 2 * Math.PI - Math.PI / 2;
  const large = end - start > 0.5 ? 1 : 0;
  return [
    `M ${point(outer, a0)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${point(outer, a1)}`,
    `L ${point(INNER, a1)}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${point(INNER, a0)}`,
    "Z",
  ].join(" ");
}

export function AllocationChart({ chart }: { chart: PortfolioChart }) {
  const options = usefulSlicings(chart);
  const [by, setBy] = useState<SliceBy>("company");
  const [active, setActive] = useState<string | null>(null);

  const segments = slices(chart, by);
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const shown = segments.find((s) => s.key === active) ?? null;

  // Each segment starts where the ones before it end.
  const drawn = segments.map((slice, index) => {
    const start = segments.slice(0, index).reduce((sum, s) => sum + s.share, 0);
    return { slice, index, start, end: start + slice.share };
  });

  return (
    <div className="space-y-4 p-5">
      {options.length > 1 && (
        <div role="group" aria-label="Group the allocation by" className="flex w-fit border border-border">
          {options.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={by === option}
              onClick={() => {
                setBy(option);
                setActive(null);
              }}
              className={cn(
                "border-r border-border px-2.5 py-1 text-xs font-medium transition-colors last:border-r-0",
                by === option ? "bg-accent text-accent-fg" : "text-muted hover:text-foreground",
              )}
            >
              {LABELS[option]}
            </button>
          ))}
        </div>
      )}

      <div className="grid items-center gap-6 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
        <div className="relative mx-auto aspect-square w-full max-w-[220px]">
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="h-full w-full overflow-visible"
            role="group"
            aria-label={`Allocation by ${LABELS[by].toLowerCase()}`}
            onPointerLeave={() => setActive(null)}
          >
            {drawn.map(({ slice, index, start: from, end: to }) => {
              const lifted = slice.key === active;
              return (
                <path
                  key={slice.key}
                  d={arc(from, to, lifted ? OUTER + LIFT : OUTER)}
                  fill={colourOf(slice, index)}
                  // The surface-coloured edge is the gap between segments, not a border.
                  stroke="var(--surface)"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  opacity={active && !lifted ? 0.4 : 1}
                  tabIndex={0}
                  role="img"
                  aria-label={`${slice.label}: ${percent(slice.share)}, ${money(slice.value, chart.currency)}`}
                  className="cursor-default outline-none transition-opacity duration-150"
                  onPointerEnter={() => setActive(slice.key)}
                  onFocus={() => setActive(slice.key)}
                  onBlur={() => setActive(null)}
                />
              );
            })}
          </svg>

          {/* The readout in the hole: the whole portfolio, or the segment pointed at. */}
          <div
            aria-live="polite"
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-12 text-center"
          >
            {shown ? (
              <>
                <span className="text-2xl font-semibold tracking-tight">{percent(shown.share)}</span>
                <span className="mt-0.5 max-w-full truncate text-xs font-medium">{shown.label}</span>
                <span className="text-xs text-muted">{money(shown.value, chart.currency)}</span>
              </>
            ) : (
              <>
                <span className="text-2xl font-semibold tracking-tight">{money(total, chart.currency)}</span>
                <span className="mt-0.5 text-xs text-muted">in {chart.currency}</span>
              </>
            )}
          </div>
        </div>

        <table className="w-full text-sm">
          <caption className="sr-only">Allocation by {LABELS[by].toLowerCase()}</caption>
          <thead className="sr-only">
            <tr>
              <th scope="col">{LABELS[by]}</th>
              <th scope="col">Share</th>
              <th scope="col">Value</th>
            </tr>
          </thead>
          <tbody>
            {segments.map((slice, index) => (
              <tr
                key={slice.key}
                onPointerEnter={() => setActive(slice.key)}
                onPointerLeave={() => setActive(null)}
                className={cn("transition-colors", active === slice.key && "bg-surface-2")}
              >
                <th scope="row" className="py-1.5 pl-2 pr-3 text-left font-normal">
                  <span className="flex min-w-0 items-center gap-2">
                    <span
                      aria-hidden
                      className="h-2.5 w-2.5 shrink-0 rounded-[3px]"
                      style={{ background: colourOf(slice, index) }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{slice.label}</span>
                      {slice.detail && <span className="block truncate text-xs text-muted">{slice.detail}</span>}
                    </span>
                  </span>
                </th>
                <td className="tnum py-1.5 pr-3 text-right font-medium">{percent(slice.share)}</td>
                <td className="tnum py-1.5 pr-2 text-right text-muted">{money(slice.value, chart.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
