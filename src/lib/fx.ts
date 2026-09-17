/**
 * Exchange rates, for showing a company's figures in the currency its shares
 * actually trade in.
 *
 * SK hynix keeps its books in won and lists in New York. Reporting ₩42.92T is
 * faithful to the filing and almost useless to someone deciding whether to buy
 * it in dollars, so the figures are converted to the listing currency.
 *
 * One rate, today's, is applied to every year. That is not what an accountant
 * would do — a 2022 income statement was earned at 2022's rate — but it keeps
 * year-on-year comparisons about the business rather than about the currency,
 * which is the comparison a reader is actually making. The page says plainly
 * that the figures are converted, so nobody mistakes them for the filed ones.
 */

const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

const cache = new Map<string, { rate: number; at: number }>();

/**
 * How many units of `to` one unit of `from` buys.
 *
 * Returns null rather than guessing when no source can answer: showing a
 * converted figure at an invented rate would be worse than showing the filed
 * one in its own currency.
 */
export async function getRate(from: string, to: string): Promise<number | null> {
  const base = from.toUpperCase();
  const target = to.toUpperCase();
  if (base === target) return 1;

  const key = `${base}:${target}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.rate;

  const rate = (await fromEcb(base, target)) ?? (await fromYahoo(base, target));
  if (rate == null) return null;

  cache.set(key, { rate, at: Date.now() });
  return rate;
}

/**
 * The European Central Bank's published rates, via Frankfurter.
 *
 * Preferred because it needs no key, is documented, and its terms permit this —
 * unlike the endpoints behind Yahoo's website. It covers around thirty
 * currencies, which is most of what a listed filer reports in, but not all.
 */
async function fromEcb(from: string, to: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://api.frankfurter.dev/v1/latest?base=${from}&symbols=${to}`,
      { next: { revalidate: 21_600 } },
    );
    if (!res.ok) return null;

    const json = (await res.json()) as { rates?: Record<string, number> };
    const rate = json.rates?.[to];
    return typeof rate === "number" && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

/** Fallback for pairs the ECB does not publish. Opt-in, like the rest of Yahoo. */
async function fromYahoo(from: string, to: string): Promise<number | null> {
  if (process.env.ENABLE_YAHOO_FALLBACK !== "true") return null;

  try {
    const res = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${from}${to}=X?range=5d&interval=1d`,
      {
        headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        next: { revalidate: 21_600 },
      },
    );
    if (!res.ok) return null;

    const json = (await res.json()) as {
      chart?: { result?: { meta?: { regularMarketPrice?: number } }[] };
    };
    const rate = json.chart?.result?.[0]?.meta?.regularMarketPrice;
    return typeof rate === "number" && rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

/**
 * One money amount, restated in another currency.
 *
 * Separate from `getRate` so the decision can be tested without a network, and
 * so every caller makes the same one. A market value divided by a profit is
 * only a P/E when both are in the same currency: SK hynix's market value
 * arrived in won, its profit had been converted to dollars, and the page
 * reported a P/E of 39,478 for a company trading on 29 times earnings. Royal
 * Bank is the quieter version of the same fault — a dollar market value over a
 * Canadian-dollar profit, which reads as 19 rather than 27.
 *
 * Returns null when the currencies differ and no rate is available, because a
 * missing figure is honest where a mixed one silently is not. An unknown
 * currency on either side is left alone rather than guessed at.
 */
export function restate(
  amount: number | null | undefined,
  from: string | null | undefined,
  to: string | null | undefined,
  rate: number | null,
): number | null {
  if (amount == null || !Number.isFinite(amount)) return null;
  if (!from || !to) return amount;
  if (from.toUpperCase() === to.toUpperCase()) return amount;
  if (rate == null || !Number.isFinite(rate) || rate <= 0) return null;
  return amount * rate;
}

/** Exposed so tests start from a known state. */
export function clearRateCache(): void {
  cache.clear();
}
