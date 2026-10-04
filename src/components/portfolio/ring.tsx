"use client";

import type { KeyboardEvent, ReactNode } from "react";
import { money, percent } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * A ring of shares — the one drawing behind every ring on the portfolio page.
 *
 * Segments run clockwise from twelve o'clock, separated by a gap the colour
 * of the page. The segment pointed at or focused grows outward and the rest
 * dim; its share, name and value fill the hole. A ring whose segments can be
 * chosen (`onSelect`) makes each one a button, by pointer or keyboard, and
 * keeps the chosen one raised. Colour is never the only key: whoever uses a
 * ring lists its segments beside it, by name, with their figures.
 */

export interface RingSegment {
  key: string;
  label: string;
  value: number;
  /** Share of the ring, 0 to 1. */
  share: number;
  color: string;
  /** False for a segment that cannot be chosen, such as a folded "Other". */
  selectable?: boolean;
}

const SIZE = 220;
const CENTER = SIZE / 2;
const OUTER = 104;
const INNER = 76;
/** How far the pointed-at or chosen segment grows outward. */
const LIFT = 5;

function point(radius: number, angle: number): string {
  return `${(CENTER + radius * Math.cos(angle)).toFixed(3)} ${(CENTER + radius * Math.sin(angle)).toFixed(3)}`;
}

/** A ring segment from one share of the way round to another. */
function arc(start: number, end: number, outer: number): string {
  // A whole ring cannot be drawn as one arc: its two ends are the same point.
  const span = Math.min(end - start, 0.9999);
  const a0 = start * 2 * Math.PI - Math.PI / 2;
  const a1 = (start + span) * 2 * Math.PI - Math.PI / 2;
  const large = span > 0.5 ? 1 : 0;
  return [
    `M ${point(outer, a0)}`,
    `A ${outer} ${outer} 0 ${large} 1 ${point(outer, a1)}`,
    `L ${point(INNER, a1)}`,
    `A ${INNER} ${INNER} 0 ${large} 0 ${point(INNER, a0)}`,
    "Z",
  ].join(" ");
}

export function Ring({
  segments,
  currency,
  ariaLabel,
  active,
  onActive,
  selected = null,
  onSelect,
  idle,
  className,
}: {
  segments: RingSegment[];
  currency: string;
  ariaLabel: string;
  /** The segment pointed at or focused, if any. */
  active: string | null;
  onActive: (key: string | null) => void;
  /** The segment chosen, kept raised. */
  selected?: string | null;
  onSelect?: (key: string) => void;
  /** What the hole shows when no segment is pointed at or chosen. */
  idle: ReactNode;
  className?: string;
}) {
  const highlighted = active ?? selected;
  const shown = segments.find((s) => s.key === highlighted) ?? null;

  return (
    <div className={cn("relative mx-auto aspect-square w-full max-w-[220px]", className)}>
      <svg
        viewBox={`0 0 ${SIZE} ${SIZE}`}
        className="h-full w-full overflow-visible"
        role="group"
        aria-label={ariaLabel}
        onPointerLeave={() => onActive(null)}
      >
        {segments.map((segment, index) => {
          const start = segments.slice(0, index).reduce((sum, s) => sum + s.share, 0);
          const raised = segment.key === highlighted || segment.key === selected;
          const choosable = Boolean(onSelect) && segment.selectable !== false;
          const choose = () => onSelect?.(segment.key);
          return (
            <path
              key={segment.key}
              d={arc(start, start + segment.share, raised ? OUTER + LIFT : OUTER)}
              fill={segment.color}
              // The surface-coloured edge is the gap between segments, not a border.
              stroke="var(--surface)"
              strokeWidth={2}
              strokeLinejoin="round"
              opacity={highlighted && !raised ? 0.4 : 1}
              tabIndex={0}
              role={choosable ? "button" : "img"}
              aria-pressed={choosable ? segment.key === selected : undefined}
              aria-label={`${segment.label}: ${percent(segment.share)}, ${money(segment.value, currency)}`}
              className={cn("outline-none transition-opacity duration-150", choosable ? "cursor-pointer" : "cursor-default")}
              onPointerEnter={() => onActive(segment.key)}
              onFocus={() => onActive(segment.key)}
              onBlur={() => onActive(null)}
              onClick={choosable ? choose : undefined}
              onKeyDown={
                choosable
                  ? (event: KeyboardEvent) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        choose();
                      }
                    }
                  : undefined
              }
            />
          );
        })}
      </svg>

      {/* The readout in the hole: the segment pointed at or chosen, or the whole. */}
      <div
        aria-live="polite"
        className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center px-12 text-center"
      >
        {shown ? (
          <>
            <span className="text-2xl font-semibold tracking-tight">{percent(shown.share)}</span>
            <span className="mt-0.5 max-w-full truncate text-xs font-medium">{shown.label}</span>
            <span className="text-xs text-muted">{money(shown.value, currency)}</span>
          </>
        ) : (
          idle
        )}
      </div>
    </div>
  );
}
