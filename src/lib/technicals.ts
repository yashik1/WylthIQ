/**
 * Where a share price stands against its own history: the states a screen can
 * filter on — a golden or death cross, above or below the 200-day average,
 * near a 52-week high or low, overbought or oversold.
 *
 * Worked out once a night from daily closes (see technicals-refresh.ts) and
 * stored, so the screener filters on them in the same single query as every
 * other column. Which states a company is in is decided here and stored as a
 * list, rather than re-derived in SQL, so the rule exists in one place and is
 * tested in one place.
 *
 * Pure: bars in, figures out. Every state describes past prices. None of them
 * predicts the next one, and the screener says so beside the filter.
 */

/** The fields of a daily bar this needs. Times are seconds since the epoch. */
export interface DailyBar {
  time: number;
  high: number;
  low: number;
  close: number;
}

export interface Technicals {
  /** The date of the last bar used, ISO. */
  asOf: string;
  close: number;
  sma50: number | null;
  sma200: number | null;
  /** The most recent crossing of the 50-day over or under the 200-day average, if any in the history read. */
  lastCross: { direction: "golden" | "death"; date: string; barsAgo: number } | null;
  /** The highest high and lowest low of the last 52 weeks (252 trading days, or fewer when that is all there is). */
  high52w: number | null;
  low52w: number | null;
  /** Wilder's 14-day relative strength index, 0–100. */
  rsi14: number | null;
}

/** A trading year. */
const YEAR = 252;
/** "Recent", for a cross: about a month of trading days. */
export const RECENT_CROSS_DAYS = 20;
/** "Near" a 52-week high or low: within this fraction of it. */
export const NEAR_EXTREME = 0.05;
export const RSI_OVERSOLD = 30;
export const RSI_OVERBOUGHT = 70;
/** The fewest closes a 52-week range is reported for. Less than half a year is not a 52-week range. */
const MIN_RANGE_BARS = 126;

export const TREND_FILTERS = {
  "golden-cross": {
    group: "Moving averages",
    label: "Golden cross (last 20 days)",
    short: "Golden cross",
    describes: "The 50-day average crossed above the 200-day average within the last 20 trading days.",
  },
  "death-cross": {
    group: "Moving averages",
    label: "Death cross (last 20 days)",
    short: "Death cross",
    describes: "The 50-day average crossed below the 200-day average within the last 20 trading days.",
  },
  uptrend: {
    group: "Moving averages",
    label: "Uptrend (50-day above 200-day)",
    short: "Uptrend",
    describes: "The 50-day average is above the 200-day average, however long ago it crossed.",
  },
  downtrend: {
    group: "Moving averages",
    label: "Downtrend (50-day below 200-day)",
    short: "Downtrend",
    describes: "The 50-day average is below the 200-day average, however long ago it crossed.",
  },
  "above-200": {
    group: "Moving averages",
    label: "Price above 200-day average",
    short: "Above 200-day",
    describes: "The last close is above the average of the last 200 closes.",
  },
  "below-200": {
    group: "Moving averages",
    label: "Price below 200-day average",
    short: "Below 200-day",
    describes: "The last close is below the average of the last 200 closes.",
  },
  "near-high": {
    group: "52-week range",
    label: "Within 5% of 52-week high",
    short: "Near 52-week high",
    describes: "The last close is within 5% of the highest price of the past year.",
  },
  "near-low": {
    group: "52-week range",
    label: "Within 5% of 52-week low",
    short: "Near 52-week low",
    describes: "The last close is within 5% of the lowest price of the past year.",
  },
  oversold: {
    group: "Momentum",
    label: "Oversold (RSI below 30)",
    short: "Oversold",
    describes: "The 14-day relative strength index is below 30: recent falls have far outweighed recent rises.",
  },
  overbought: {
    group: "Momentum",
    label: "Overbought (RSI above 70)",
    short: "Overbought",
    describes: "The 14-day relative strength index is above 70: recent rises have far outweighed recent falls.",
  },
} as const;

export type TrendKey = keyof typeof TREND_FILTERS;

export function isTrendKey(value: unknown): value is TrendKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(TREND_FILTERS, value);
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/** The simple moving average of `period` closes ending at each index; null before there are enough. */
function movingAverage(closes: number[], period: number): (number | null)[] {
  const out: (number | null)[] = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** Wilder's RSI over the whole series, which settles the smoothing; null with too few closes. */
function relativeStrength(closes: number[], period = 14): number | null {
  if (closes.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) gain += change;
    else loss -= change;
  }
  gain /= period;
  loss /= period;
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    gain = (gain * (period - 1) + Math.max(change, 0)) / period;
    loss = (loss * (period - 1) + Math.max(-change, 0)) / period;
  }
  if (loss === 0) return gain === 0 ? 50 : 100;
  return 100 - 100 / (1 + gain / loss);
}

/** Where the price stands, from daily bars in any order. Null when there is nothing usable. */
export function computeTechnicals(input: DailyBar[]): Technicals | null {
  const bars = input
    .filter((b) => Number.isFinite(b.time) && Number.isFinite(b.close) && b.close > 0)
    .sort((a, b) => a.time - b.time);
  if (bars.length === 0) return null;

  const closes = bars.map((b) => b.close);
  const last = bars.length - 1;
  const fast = movingAverage(closes, 50);
  const slow = movingAverage(closes, 200);

  // Walk back to the last day the 50-day changed sides of the 200-day.
  let lastCross: Technicals["lastCross"] = null;
  for (let i = last; i > 0 && slow[i - 1] != null; i--) {
    const before = Math.sign(fast[i - 1]! - slow[i - 1]!);
    const after = Math.sign(fast[i]! - slow[i]!);
    if (before !== after && after !== 0) {
      lastCross = { direction: after > 0 ? "golden" : "death", date: isoDate(bars[i].time), barsAgo: last - i };
      break;
    }
  }

  const year = bars.slice(-YEAR);
  const enoughForRange = year.length >= MIN_RANGE_BARS;
  const highs = year.map((b) => (Number.isFinite(b.high) && b.high > 0 ? b.high : b.close));
  const lows = year.map((b) => (Number.isFinite(b.low) && b.low > 0 ? b.low : b.close));

  return {
    asOf: isoDate(bars[last].time),
    close: closes[last],
    sma50: fast[last],
    sma200: slow[last],
    lastCross,
    high52w: enoughForRange ? Math.max(...highs) : null,
    low52w: enoughForRange ? Math.min(...lows) : null,
    rsi14: relativeStrength(closes),
  };
}

/** Every state a company is in. The screener stores this list and filters on it. */
export function trendStates(t: Technicals): TrendKey[] {
  const states: TrendKey[] = [];
  if (t.lastCross && t.lastCross.barsAgo <= RECENT_CROSS_DAYS) {
    states.push(t.lastCross.direction === "golden" ? "golden-cross" : "death-cross");
  }
  if (t.sma50 != null && t.sma200 != null) {
    if (t.sma50 > t.sma200) states.push("uptrend");
    else if (t.sma50 < t.sma200) states.push("downtrend");
  }
  if (t.sma200 != null) {
    if (t.close > t.sma200) states.push("above-200");
    else if (t.close < t.sma200) states.push("below-200");
  }
  if (t.high52w != null && t.close >= t.high52w * (1 - NEAR_EXTREME)) states.push("near-high");
  if (t.low52w != null && t.close <= t.low52w * (1 + NEAR_EXTREME)) states.push("near-low");
  if (t.rsi14 != null) {
    if (t.rsi14 < RSI_OVERSOLD) states.push("oversold");
    else if (t.rsi14 > RSI_OVERBOUGHT) states.push("overbought");
  }
  return states;
}

/** The figures a screen row carries, for saying why it matched. */
export interface TrendFigures {
  technicalClose: number | null;
  sma50: number | null;
  sma200: number | null;
  rsi14: number | null;
  high52w: number | null;
  low52w: number | null;
  lastCross: string | null;
  lastCrossDate: string | null;
}

function pct(value: number): string {
  return `${Math.abs(value * 100).toFixed(1)}%`;
}

/** One short line saying why a row matched the trend filter: "Crossed Oct 14", "RSI 27". */
export function trendDetail(key: TrendKey, f: TrendFigures): string | null {
  switch (key) {
    case "golden-cross":
    case "death-cross":
      return f.lastCrossDate ? `Crossed ${shortDate(f.lastCrossDate)}` : null;
    case "uptrend":
    case "downtrend":
      return f.sma50 != null && f.sma200 != null && f.sma200 > 0
        ? `50-day ${pct(f.sma50 / f.sma200 - 1)} ${f.sma50 >= f.sma200 ? "above" : "below"} 200-day`
        : null;
    case "above-200":
    case "below-200":
      return f.technicalClose != null && f.sma200 != null && f.sma200 > 0
        ? `${pct(f.technicalClose / f.sma200 - 1)} ${f.technicalClose >= f.sma200 ? "above" : "below"} 200-day`
        : null;
    case "near-high":
      return f.technicalClose != null && f.high52w != null && f.high52w > 0
        ? `${pct(1 - f.technicalClose / f.high52w)} below 52-week high`
        : null;
    case "near-low":
      return f.technicalClose != null && f.low52w != null && f.low52w > 0
        ? `${pct(f.technicalClose / f.low52w - 1)} above 52-week low`
        : null;
    case "oversold":
    case "overbought":
      return f.rsi14 != null ? `RSI ${Math.round(f.rsi14)}` : null;
  }
}

/** "2026-10-14" as "Oct 14", read as a calendar date wherever the reader is. */
function shortDate(iso: string): string {
  const at = new Date(`${iso}T12:00:00Z`);
  return Number.isNaN(at.getTime())
    ? iso
    : at.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}
