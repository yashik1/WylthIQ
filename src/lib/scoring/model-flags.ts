/**
 * The two model flags, worded once.
 *
 * The Beneish accounting flag and the Altman distress reading were each
 * described in several places — the warning signs, the "what to watch"
 * column, the watchlist and the portfolio — in slightly different words, and
 * one flag could appear three times on a single company page. These are the
 * words wherever either is shown.
 */

export const ACCOUNTING_FLAG = {
  label: "Accounting flag",
  text:
    "Its accounting patterns resemble those of companies that later restated earnings. " +
    "This is a statistical screen, not evidence of wrongdoing.",
} as const;

export const DISTRESS_FLAG = {
  label: "Distress zone",
  text:
    "A published bankruptcy-risk model places it in its distress range. " +
    "This is a statistical reading, not a forecast.",
} as const;
