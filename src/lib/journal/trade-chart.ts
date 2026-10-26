import type { Bar, Timeframe } from "../providers/types";
import { zonedToUtc, type TradeFill } from "./fills";

/**
 * Which bars to draw a trade on, and where its arrows go.
 *
 * Pure, so the choices are tested without a provider. The rule is to pick the
 * finest candles that still show the whole trade with some context either
 * side: a ten-minute scalp on one-minute candles, a day trade on five-minute
 * candles, a two-week swing on hourly ones, and anything longer on daily.
 *
 * Free intraday history does not reach far back for most listings, so every
 * plan carries coarser fallbacks, each with its own padding. A day trade that
 * can no longer be drawn on five-minute candles is better drawn on daily ones
 * than not at all.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Finest first; a plan falls back along this list. */
const ORDER: Timeframe[] = ["1Min", "5Min", "15Min", "1Hour", "1Day"];

/** Context either side of the trade: at least `min`, about half the trade's length, at most `max`. */
const PADDING: Record<Exclude<Timeframe, "1Week">, { min: number; max: number }> = {
  "1Min": { min: 30 * MINUTE, max: 2 * HOUR },
  "5Min": { min: 2 * HOUR, max: 12 * HOUR },
  "15Min": { min: 1 * DAY, max: 3 * DAY },
  "1Hour": { min: 5 * DAY, max: 20 * DAY },
  "1Day": { min: 30 * DAY, max: 180 * DAY },
};

/**
 * How far from the first and last fill the bars may start and end and still
 * count as covering the trade. Generous on daily candles, which skip weekends
 * and holidays.
 */
const COVER_SLACK: Record<Exclude<Timeframe, "1Week">, number> = {
  "1Min": 1 * HOUR,
  "5Min": 2 * HOUR,
  "15Min": 1 * DAY,
  "1Hour": 3 * DAY,
  "1Day": 5 * DAY,
};

export interface ChartWindow {
  timeframe: Exclude<Timeframe, "1Week">;
  from: Date;
  to: Date;
}

export interface TradeSpan {
  /** The first fill, or the opening day's start. */
  start: Date;
  /** The last fill, the closing day's end, or now while open. */
  end: Date;
  /** Whether every fill has a time, so the span is exact. */
  timed: boolean;
}

export interface ChartInput {
  fills: TradeFill[];
  openedAt: string;
  closedAt: string | null;
}

/** A trading day as New York sees it, which is where the North American markets keep time. */
function dayStart(date: string): Date {
  return new Date(zonedToUtc(date, "00:00", "America/New_York") ?? `${date}T05:00:00Z`);
}

function dayEnd(date: string): Date {
  return new Date(dayStart(date).getTime() + DAY - 1);
}

/** Where the trade starts and ends, as exactly as its fills allow. */
export function tradeSpan(input: ChartInput, now: Date): TradeSpan {
  const instants = input.fills.map((f) => (f.at ? Date.parse(f.at) : NaN));
  const timed = instants.length > 0 && instants.every((t) => Number.isFinite(t));
  const open = !input.closedAt;

  if (timed) {
    const start = Math.min(...instants);
    const end = open ? now.getTime() : Math.max(...instants);
    return { start: new Date(start), end: new Date(Math.max(end, start)), timed };
  }

  const start = dayStart(input.openedAt);
  const end = open ? now : dayEnd(input.closedAt!);
  return { start, end: end < start ? start : end, timed };
}

/** The finest candles that suit a trade of this length. */
function finestFor(span: TradeSpan): Exclude<Timeframe, "1Week"> {
  const length = span.end.getTime() - span.start.getTime();
  if (!span.timed) {
    // Without times, a trade inside one day is shown across that day's
    // session, and anything longer on daily candles: hourly ones would only
    // guess where in each day the arrows belong.
    return length <= DAY ? "5Min" : "1Day";
  }
  if (length <= HOUR) return "1Min";
  if (length <= 12 * HOUR) return "5Min";
  if (length <= 7 * DAY) return "15Min";
  if (length <= 60 * DAY) return "1Hour";
  return "1Day";
}

function windowFor(span: TradeSpan, timeframe: Exclude<Timeframe, "1Week">, now: Date): ChartWindow {
  const length = span.end.getTime() - span.start.getTime();
  const { min, max } = PADDING[timeframe];
  const pad = Math.min(Math.max(length / 2, min), max);
  const to = Math.min(span.end.getTime() + pad, now.getTime());
  return { timeframe, from: new Date(span.start.getTime() - pad), to: new Date(Math.max(to, span.start.getTime())) };
}

/** The windows to try, finest first, ending on daily candles. */
export function chartPlan(input: ChartInput, now: Date): ChartWindow[] {
  const span = tradeSpan(input, now);
  const first = ORDER.indexOf(finestFor(span));
  return ORDER.slice(first).map((timeframe) => windowFor(span, timeframe as ChartWindow["timeframe"], now));
}

/**
 * Whether bars show the trade: they start by its first fill and, once it is
 * closed, reach its last. A provider's partial answer that begins after the
 * entry is no chart of the trade at all.
 */
export function coversTrade(
  bars: Bar[],
  window: ChartWindow,
  input: ChartInput,
  now: Date,
): boolean {
  if (bars.length < 3) return false;
  const span = tradeSpan(input, now);
  const slack = COVER_SLACK[window.timeframe];
  const first = bars[0].time * 1000;
  const last = bars[bars.length - 1].time * 1000;
  if (first > span.start.getTime() + slack) return false;
  if (input.closedAt && last < span.end.getTime() - slack) return false;
  return true;
}

export interface FillMarker {
  /** The bar it sits on, in epoch seconds. */
  time: number;
  side: "buy" | "sell";
  shares: number;
  price: number;
}

const INTRADAY: ReadonlySet<Timeframe> = new Set(["1Min", "5Min", "15Min", "1Hour"]);

/**
 * Each fill as an arrow on the candle it happened in.
 *
 * A fill with only a date goes on that day's candle when the chart is daily.
 * On an intraday chart there is no telling which candle it belongs to, so it
 * gets no arrow; its price is still drawn as a line.
 */
export function fillMarkers(fills: TradeFill[], bars: Bar[], timeframe: Timeframe): FillMarker[] {
  if (bars.length === 0) return [];
  const markers: FillMarker[] = [];
  const first = bars[0].time;
  const last = bars[bars.length - 1].time;
  const intraday = INTRADAY.has(timeframe);

  for (const fill of fills) {
    let target: number;
    if (fill.at) {
      target = Math.floor(Date.parse(fill.at) / 1000);
    } else if (!intraday) {
      // Midday in New York, so it lands on the right day's candle whichever
      // hour the provider stamps its daily bars with.
      target = Math.floor(dayStart(fill.date).getTime() / 1000) + 12 * 3600;
    } else {
      continue;
    }
    // A fill outside the bars would snap to the edge and claim a candle it
    // was never in.
    const width = barSeconds(timeframe);
    if (target < first - width || target > last + width) continue;

    markers.push({ time: bars[candleAt(bars, target)].time, side: fill.side, shares: fill.shares, price: fill.price });
  }

  // lightweight-charts wants markers in time order.
  return markers.sort((a, b) => a.time - b.time);
}

/**
 * The candle a moment falls in: the last one that opened at or before it, not
 * merely the nearest, which for a fill late in a candle would be the next.
 */
function candleAt(bars: Bar[], time: number): number {
  let lo = 0;
  let hi = bars.length - 1;
  if (time <= bars[0].time) return 0;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (bars[mid].time <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function barSeconds(timeframe: Timeframe): number {
  switch (timeframe) {
    case "1Min":
      return 60;
    case "5Min":
      return 300;
    case "15Min":
      return 900;
    case "1Hour":
      return 3600;
    default:
      return 86_400;
  }
}

/** The volume-weighted price of one side's fills, for the entry and exit lines. */
export function averagePrice(fills: TradeFill[], side: "buy" | "sell"): number | null {
  let shares = 0;
  let cost = 0;
  for (const f of fills) {
    if (f.side !== side) continue;
    shares += f.shares;
    cost += f.shares * f.price;
  }
  return shares > 0 ? cost / shares : null;
}

/** A plain-words name for a chart's candles. */
export function timeframeLabel(timeframe: string): string {
  switch (timeframe) {
    case "1Min":
      return "1-minute candles";
    case "5Min":
      return "5-minute candles";
    case "15Min":
      return "15-minute candles";
    case "1Hour":
      return "hourly candles";
    case "1Week":
      return "weekly candles";
    default:
      return "daily candles";
  }
}
