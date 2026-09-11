import type { Rating } from "./types";

/**
 * How a health score reads, and the word every panel uses for a rating.
 *
 * One definition. The score bands were written out separately on the
 * dashboard, the screener, compare, the backtest, the portfolio, the peer
 * table, the watchlist and twice on the company page — nine copies that only
 * agreed because nobody had changed one yet. And a single rating was called
 * "Mixed" in the investor brief and "Moderate" a few inches below it.
 */

/** A score at or above this is rated good. */
export const HEALTH_GOOD_FROM = 7.5;

/** A score at or above this, and below good, is rated fair. */
export const HEALTH_FAIR_FROM = 5;

export function healthRating(score: number | null | undefined): Rating {
  if (score == null || !Number.isFinite(score)) return "unknown";
  if (score >= HEALTH_GOOD_FROM) return "good";
  if (score >= HEALTH_FAIR_FROM) return "fair";
  return "poor";
}

/** A rating in a word, so it never rests on colour alone. */
export const RATING_WORD: Readonly<Record<Rating, string>> = {
  good: "Strong",
  fair: "Mixed",
  poor: "Weak",
  unknown: "Not enough data",
};
