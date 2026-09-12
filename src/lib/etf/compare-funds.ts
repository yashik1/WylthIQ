import { getBarsWithSource, getEtfProfile, yahoo } from "../providers";
import type { Bar } from "../providers/types";
import { isSameListing, summariseIncome, type PayoutFrequency } from "./income";

/**
 * Funds side by side, on facts a fund actually has.
 *
 * The comparison table next to this one asks a company's questions — revenue
 * growth, margin, debt — and every one of them is blank for a fund, so three
 * dividend ETFs compared here produced a screen of dashes and a note
 * explaining why. These are the rows a fund answers: what it charges, what it
 * pays, how many things it holds, and what it has returned.
 *
 * Two rules make it worth reading, and both are things a factsheet
 * comparison usually gets wrong:
 *
 *  - Every return is measured to the same date. Funds are priced by whichever
 *    provider answered, and their histories end at different points; a table
 *    reading one fund to July and another to February compares two different
 *    markets. Returns here stop at the earliest date they all reach, and the
 *    card says which date that is.
 *  - Every yield is computed the same way. Managers publish different things
 *    under the word "yield" — a portfolio dividend yield, an annualised last
 *    payment, a trailing twelve months — and those numbers are not
 *    comparable. This counts the last twelve months of actual payments
 *    against today's price, for all of them.
 */

export interface ReturnWindow {
  /** "1 year", "5 years", "Whole history". */
  label: string;
  /** The window asked for, or null for as far back as the prices go. */
  years: number | null;
  /** Change across the window, as a fraction. */
  total: number | null;
  /** That change compounded per year, where the window is at least a year. */
  perYear: number | null;
  /**
   * The date the window actually starts.
   *
   * Carried because "whole history" is a different length for each fund, and
   * two of those columns side by side otherwise read as one span of time.
   */
  from: string | null;
}

export interface FundFacts {
  symbol: string;
  name: string;
  /** The currency this listing trades in. */
  currency: string | null;
  /** The latest price, in that currency. */
  price: number | null;
  /** Annual fee as a fraction: 0.0022 is 0.22%. */
  fee: number | null;
  /** Who published the fee, so a reader can weigh it. */
  feeSource: string | null;
  /** The manager's stated launch date, where one is published. */
  launched: string | null;
  /** The first date there is a price for. */
  firstPriced: string | null;
  holdingCount: number | null;
  /** Share of the fund in its ten largest positions. */
  topTenWeight: number | null;
  netAssets: number | null;
  netAssetsCurrency: string | null;
  frequency: PayoutFrequency | null;
  /** Twelve months of payments against today's price, as a fraction. */
  trailingYield: number | null;
  paymentsCounted: number;
  returns: ReturnWindow[];
  /** Whether the prices behind the returns already have distributions in them. */
  includesDividends: boolean | null;
}

export interface FundComparison {
  funds: FundFacts[];
  /** The date every return is measured to. */
  asOf: string | null;
  /** True when these funds are priced in more than one currency. */
  mixedCurrency: boolean;
  /** True when one fund's returns include distributions and another's do not. */
  mixedBasis: boolean;
}

const DAY_SECONDS = 86_400;
const YEAR_SECONDS = 365.25 * DAY_SECONDS;

/**
 * How far a bar may sit from the date a window asks for.
 *
 * Weekly bars land where they land, and a fund that listed mid-week or missed
 * a print should still answer "five years". Wider than this is a different
 * question being answered, so the window is left empty instead.
 */
const NEAREST_TOLERANCE = 45 * DAY_SECONDS;

const WINDOWS: { label: string; years: number }[] = [
  { label: "1 year", years: 1 },
  { label: "3 years", years: 3 },
  { label: "5 years", years: 5 },
  { label: "10 years", years: 10 },
];

/** How far back the whole-history window may reach. Older than any ETF. */
const FULL_HISTORY_YEARS = 30;

/** The bar nearest a moment in time, or null when none is near enough. */
function nearest(bars: Bar[], target: number): Bar | null {
  let best: Bar | null = null;
  let bestGap = Infinity;

  for (const bar of bars) {
    const gap = Math.abs(bar.time - target);
    if (gap < bestGap) {
      best = bar;
      bestGap = gap;
    }
  }

  return best && bestGap <= NEAREST_TOLERANCE ? best : null;
}

function windowFrom(from: Bar, to: Bar, label: string, years: number | null): ReturnWindow {
  const total = to.close / from.close - 1;
  const elapsed = (to.time - from.time) / YEAR_SECONDS;

  return {
    label,
    years,
    total,
    // Under a year, a compounded rate states a pace the fund has never held.
    perYear: elapsed >= 1 ? (1 + total) ** (1 / elapsed) - 1 : null,
    from: isoDate(from.time),
  };
}

/**
 * What a price series returned over each window, measured to one date.
 *
 * `asOf` is passed in rather than read off the series, because the whole point
 * of it is that every fund in a comparison is read to the same moment.
 */
export function returnsTo(bars: Bar[], asOf: number): ReturnWindow[] {
  const usable = bars.filter((b) => b.close > 0 && b.time <= asOf);
  const last = usable[usable.length - 1];
  const first = usable[0];

  const empty = (label: string, years: number | null): ReturnWindow => ({
    label,
    years,
    total: null,
    perYear: null,
    from: null,
  });

  if (!last || !first || first.time === last.time) {
    return [...WINDOWS.map((w) => empty(w.label, w.years)), empty("Whole history", null)];
  }

  const windows = WINDOWS.map((w) => {
    const start = nearest(usable, last.time - w.years * YEAR_SECONDS);
    /*
      A fund younger than the window has no answer for it. Falling back to its
      whole history here would put a three-year record in a column headed ten
      years, beside funds that really have ten — which is the comparison this
      table exists to make, quietly broken.
    */
    return start && start.time < last.time
      ? windowFrom(start, last, w.label, w.years)
      : empty(w.label, w.years);
  });

  return [...windows, windowFrom(first, last, "Whole history", null)];
}

/**
 * The positions in a comparison that lead their row.
 *
 * Ties lead together — two funds at 0.22% are both the cheapest, and marking
 * one of them would invent a difference. A row where "better" is a matter of
 * preference rather than fact, such as how concentrated a fund is, has no
 * leader and never calls this.
 */
export function leadingIndexes(
  values: (number | null | undefined)[],
  direction: "highest" | "lowest",
): number[] {
  const numbers = values
    .map((v, i) => ({ v, i }))
    .filter(
      (entry): entry is { v: number; i: number } =>
        typeof entry.v === "number" && Number.isFinite(entry.v),
    );

  if (numbers.length < 2) return [];

  const best = numbers.reduce(
    (acc, entry) => (direction === "highest" ? Math.max(acc, entry.v) : Math.min(acc, entry.v)),
    direction === "highest" ? -Infinity : Infinity,
  );

  return numbers.filter((entry) => entry.v === best).map((entry) => entry.i);
}

/** Share of a fund held in its ten largest positions, where they are published. */
export function topTenWeight(holdings: { weight: number }[] | undefined): number | null {
  if (!holdings || holdings.length < 10) return null;

  const weights = holdings.map((h) => h.weight).sort((a, b) => b - a);
  const top = weights.slice(0, 10).reduce((sum, w) => sum + w, 0);

  // Weights are fractions here. Anything over 1 is a percentage that slipped
  // through, and printing it as 4,561% would be worse than printing nothing.
  return top > 0 && top <= 1 ? top : null;
}

/** Everything this app knows about one fund, for the table. */
async function factsFor(item: {
  symbol: string;
  name: string;
  quote: { price: number | null; currency?: string | null } | null;
}): Promise<{ facts: Omit<FundFacts, "returns">; bars: Bar[] }> {
  const [profile, income, prices] = await Promise.all([
    getEtfProfile(item.symbol).catch(() => null),
    yahoo.getIncomeAndRange(item.symbol).catch(() => null),
    getBarsWithSource(
      item.symbol,
      "1Week",
      new Date(Date.now() - FULL_HISTORY_YEARS * 365 * 86_400_000),
      new Date(),
    ).catch(() => ({ bars: [] as Bar[], source: null, includesDividends: false })),
  ]);

  /*
    Payments only count when they describe the same listing as the price.

    A bare ticker can name a fund in two countries, and these two answers are
    resolved separately — the same trap the fund card documents. A yield built
    from one listing's payments over another listing's price is a number
    describing nothing.
  */
  const usable = income && isSameListing(item.quote?.currency, income.currency) ? income : null;
  const summary = usable ? summariseIncome(usable.dividends, item.quote?.price ?? null) : null;

  const bars = prices.bars;

  return {
    bars,
    facts: {
      symbol: item.symbol,
      name: item.name,
      currency: item.quote?.currency ?? null,
      price: item.quote?.price ?? null,
      fee: profile?.expenseRatio ?? null,
      feeSource: profile?.source.name ?? null,
      launched: profile?.inceptionDate ?? null,
      firstPriced: bars[0] ? isoDate(bars[0].time) : null,
      holdingCount: profile?.holdingCount ?? null,
      topTenWeight: topTenWeight(
        profile?.topHoldings && profile.topHoldings.length >= 10
          ? profile.topHoldings
          : profile?.holdings,
      ),
      netAssets: profile?.netAssets ?? null,
      netAssetsCurrency: profile?.netAssetsCurrency ?? null,
      frequency: summary?.frequency ?? null,
      trailingYield: summary?.yield ?? null,
      paymentsCounted: summary?.paymentsCounted ?? 0,
      includesDividends: bars.length > 0 ? prices.includesDividends : null,
    },
  };
}

/**
 * Loads a fund comparison, with every return measured to the same date.
 *
 * That date is the earliest last price among the funds: reading one fund a
 * week further than another credits it with a week of market the others were
 * never given, and a week of market is the difference between two of these
 * funds over a year.
 */
export async function loadFundComparison(
  items: {
    symbol: string;
    name: string;
    quote: { price: number | null; currency?: string | null } | null;
  }[],
): Promise<FundComparison | null> {
  if (items.length < 2) return null;

  const loaded = await Promise.all(items.map(factsFor));

  const ends = loaded
    .map((f) => f.bars[f.bars.length - 1]?.time)
    .filter((t): t is number => typeof t === "number");
  const asOf = ends.length > 0 ? Math.min(...ends) : null;

  const funds: FundFacts[] = loaded.map((f) => ({
    ...f.facts,
    returns: returnsTo(asOf == null ? [] : f.bars, asOf ?? 0),
  }));

  const currencies = new Set(funds.map((f) => f.currency).filter(Boolean));
  const bases = new Set(funds.map((f) => f.includesDividends).filter((b) => b !== null));

  return {
    funds,
    asOf: asOf == null ? null : isoDate(asOf),
    mixedCurrency: currencies.size > 1,
    mixedBasis: bases.size > 1,
  };
}

function isoDate(seconds: number): string {
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}
