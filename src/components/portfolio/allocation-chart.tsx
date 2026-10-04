"use client";

import { useState } from "react";
import { money, percent } from "@/lib/format";
import { slices, usefulSlicings, type PortfolioChart, type Slice, type SliceBy } from "@/lib/portfolio/charts";
import { cn } from "@/lib/utils";
import { Ring } from "./ring";

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

function colourOf(slice: Slice, index: number): string {
  return slice.other ? "var(--faint)" : `var(--series-${index + 1})`;
}

export function AllocationChart({ chart }: { chart: PortfolioChart }) {
  const options = usefulSlicings(chart);
  const [by, setBy] = useState<SliceBy>("company");
  const [active, setActive] = useState<string | null>(null);

  const segments = slices(chart, by);
  const total = segments.reduce((sum, s) => sum + s.value, 0);

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
        <Ring
          segments={segments.map((slice, index) => ({
            key: slice.key,
            label: slice.label,
            value: slice.value,
            share: slice.share,
            color: colourOf(slice, index),
          }))}
          currency={chart.currency}
          ariaLabel={`Allocation by ${LABELS[by].toLowerCase()}`}
          active={active}
          onActive={setActive}
          idle={
            <>
              <span className="text-2xl font-semibold tracking-tight">{money(total, chart.currency)}</span>
              <span className="mt-0.5 text-xs text-muted">in {chart.currency}</span>
            </>
          }
        />

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
