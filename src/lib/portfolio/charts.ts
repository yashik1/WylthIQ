import type { ValuedHolding } from "./math";

/**
 * The figures behind the portfolio's two charts: an allocation ring and a map
 * of every company, sized by value and shaded by gain or loss.
 *
 * Both need every holding in one currency, which the table deliberately does
 * not do. A portfolio held in one currency is charted in it; a mixed one is
 * converted into the base currency at the latest rate, and the chart says so.
 * A holding with no price, or in a currency with no rate, is left out and
 * counted rather than charted at cost or at an invented rate.
 */

export type SliceBy = "company" | "sector" | "broker" | "currency";

export interface ChartHolding {
  symbol: string;
  name: string | null;
  /** The company's sector, or null outside the scored universe. */
  sector: string | null;
  /** "Entered by hand", or the institution a synced holding came from. */
  broker: string;
  /** The currency the holding trades in, before any conversion. */
  currency: string;
  /** Value and cost in the chart's currency. */
  value: number;
  cost: number;
}

export interface PortfolioChart {
  currency: string;
  /** True when holdings in other currencies were converted into `currency`. */
  converted: boolean;
  holdings: ChartHolding[];
  /** Holdings left out: no price, or no exchange rate into `currency`. */
  leftOut: number;
}

export const HAND_ENTERED = "Entered by hand";
export const UNCLASSIFIED = "Unclassified";

/** One ring keeps six segments at most; past that, the smallest fold into "Other". */
export const MAX_SLICES = 6;

export function chartHoldings(
  holdings: ValuedHolding[],
  /** Each currency's rate into `base`, or null where none was available. */
  rates: Map<string, number | null>,
  sectors: Record<string, string | null>,
  base: string,
): PortfolioChart {
  const priced = holdings.filter((h) => h.value != null && h.value > 0);
  const currencies = new Set(priced.map((h) => h.currency));
  const single = currencies.size <= 1;
  const currency = single ? ([...currencies][0] ?? base) : base;

  const charted: ChartHolding[] = [];
  for (const holding of priced) {
    const rate = single ? 1 : (rates.get(holding.currency) ?? null);
    if (rate == null || !(rate > 0)) continue;
    charted.push({
      symbol: holding.symbol,
      name: holding.name,
      sector: sectors[holding.symbol] ?? null,
      broker: holding.source === "manual" ? HAND_ENTERED : (holding.sourceLabel ?? "Your broker"),
      currency: holding.currency,
      value: holding.value! * rate,
      cost: holding.cost * rate,
    });
  }

  return {
    currency,
    converted: !single && charted.some((h) => h.currency !== currency),
    holdings: charted,
    leftOut: holdings.length - charted.length,
  };
}

export interface Slice {
  key: string;
  label: string;
  /** A company's name under its ticker, or what "Other" holds. */
  detail: string | null;
  value: number;
  /** Share of the charted total, 0 to 1. */
  share: number;
  /** True for the folded remainder, which is drawn in neutral grey. */
  other: boolean;
}

const NOUNS: Record<SliceBy, [string, string]> = {
  company: ["company", "companies"],
  sector: ["sector", "sectors"],
  broker: ["source", "sources"],
  currency: ["currency", "currencies"],
};

function groupOf(holding: ChartHolding, by: SliceBy): string {
  if (by === "company") return holding.symbol;
  if (by === "sector") return holding.sector ?? UNCLASSIFIED;
  if (by === "broker") return holding.broker;
  return holding.currency;
}

/**
 * The ring's segments, largest first. Six or fewer groups are all drawn; more
 * than six keep the five largest and fold the rest into "Other", so no
 * segment ever needs a seventh colour.
 */
export function slices(chart: PortfolioChart, by: SliceBy): Slice[] {
  const groups = new Map<string, { value: number; name: string | null }>();
  for (const holding of chart.holdings) {
    const key = groupOf(holding, by);
    const group = groups.get(key) ?? { value: 0, name: by === "company" ? holding.name : null };
    group.value += holding.value;
    groups.set(key, group);
  }
  const total = [...groups.values()].reduce((sum, g) => sum + g.value, 0);
  if (total <= 0) return [];

  const sorted = [...groups]
    .map(([key, g]) => ({ key, label: key, detail: g.name, value: g.value, share: g.value / total, other: false }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  if (sorted.length <= MAX_SLICES) return sorted;

  const kept = sorted.slice(0, MAX_SLICES - 1);
  const rest = sorted.slice(MAX_SLICES - 1);
  const value = rest.reduce((sum, s) => sum + s.value, 0);
  const [one, many] = NOUNS[by];
  return [
    ...kept,
    {
      key: "__other__",
      label: "Other",
      detail: `${rest.length} more ${rest.length === 1 ? one : many}`,
      value,
      share: value / total,
      other: true,
    },
  ];
}

/** The ways of slicing that say something: at least two groups. Company is always offered. */
export function usefulSlicings(chart: PortfolioChart): SliceBy[] {
  const all: SliceBy[] = ["company", "sector", "broker", "currency"];
  return all.filter((by) => by === "company" || new Set(chart.holdings.map((h) => groupOf(h, by))).size > 1);
}

export interface MapCompany {
  symbol: string;
  name: string | null;
  value: number;
  cost: number;
  /** Share of the charted total, 0 to 1. */
  share: number;
  /** Gain against cost, or null with no cost to measure against. */
  gainPercent: number | null;
}

/** One entry per company, however many rows hold it, largest first. */
export function mapCompanies(chart: PortfolioChart): MapCompany[] {
  const bySymbol = new Map<string, { name: string | null; value: number; cost: number }>();
  for (const holding of chart.holdings) {
    const entry = bySymbol.get(holding.symbol) ?? { name: holding.name, value: 0, cost: 0 };
    entry.value += holding.value;
    entry.cost += holding.cost;
    bySymbol.set(holding.symbol, entry);
  }
  const total = [...bySymbol.values()].reduce((sum, e) => sum + e.value, 0);
  return [...bySymbol]
    .map(([symbol, e]) => ({
      symbol,
      name: e.name,
      value: e.value,
      cost: e.cost,
      share: total > 0 ? e.value / total : 0,
      gainPercent: e.cost > 0 ? (e.value - e.cost) / e.cost : null,
    }))
    .sort((a, b) => b.value - a.value || a.symbol.localeCompare(b.symbol));
}

/** Where the map's shades change, as a fraction of cost: within 2% reads as flat. */
export const GAIN_BOUNDS = [0.02, 0.1, 0.25] as const;

/** A gain's shade on the map: 0 flat, 1 to 3 gains, -1 to -3 losses, stronger with size. */
export function gainStep(gainPercent: number | null): number {
  if (gainPercent == null || !Number.isFinite(gainPercent)) return 0;
  const size = Math.abs(gainPercent);
  const step = GAIN_BOUNDS.filter((bound) => size >= bound).length;
  return gainPercent < 0 && step > 0 ? -step : step;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * A squarified treemap (Bruls, Huizing and van Wijk, 2000): each value gets
 * a rectangle of proportional area, kept as close to square as the values
 * allow, so a tile's size can be read at a glance. Values should be positive
 * and sorted largest first; the rectangles come back in the same order.
 */
export function squarify(values: number[], width: number, height: number): Rect[] {
  const total = values.reduce((sum, v) => sum + Math.max(0, v), 0);
  if (total <= 0 || width <= 0 || height <= 0) return values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));

  const scale = (width * height) / total;
  const areas = values.map((v) => Math.max(0, v) * scale);
  const rects: Rect[] = values.map(() => ({ x: 0, y: 0, w: 0, h: 0 }));
  let x = 0;
  let y = 0;
  let w = width;
  let h = height;

  /** The worst aspect ratio in a row laid along a side of this length. */
  const worst = (row: number[], side: number) => {
    const sum = row.reduce((a, b) => a + b, 0);
    const max = Math.max(...row);
    const min = Math.min(...row);
    return Math.max((side * side * max) / (sum * sum), (sum * sum) / (side * side * min));
  };

  const place = (row: number[]) => {
    const sum = row.reduce((a, b) => a + areas[b], 0);
    if (w >= h) {
      // A column down the left edge.
      const cw = sum / h;
      let cy = y;
      for (const i of row) {
        const ih = areas[i] / cw;
        rects[i] = { x, y: cy, w: cw, h: ih };
        cy += ih;
      }
      x += cw;
      w -= cw;
    } else {
      // A row across the top.
      const rh = sum / w;
      let cx = x;
      for (const i of row) {
        const iw = areas[i] / rh;
        rects[i] = { x: cx, y, w: iw, h: rh };
        cx += iw;
      }
      y += rh;
      h -= rh;
    }
  };

  let row: number[] = [];
  for (let i = 0; i < areas.length; i++) {
    if (areas[i] <= 0) continue;
    const side = Math.min(w, h);
    const current = row.map((j) => areas[j]);
    if (row.length === 0 || worst([...current, areas[i]], side) <= worst(current, side)) {
      row.push(i);
    } else {
      place(row);
      row = [i];
    }
  }
  if (row.length > 0) place(row);
  return rects;
}
