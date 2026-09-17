/**
 * The currency a reader asks to see figures in.
 *
 * By default a company's figures are shown in the currency its shares trade
 * in, which is the money somebody buying it would actually spend. That is the
 * right default and the wrong answer for a reader who does not live there: a
 * Canadian looking at a US filer is reading dollars they would have to buy,
 * and "$70.92B of revenue" means something different to them than to a New
 * Yorker.
 *
 * So the choice is offered, remembered in a cookie, and applied to every
 * company page. It never changes what was filed — the note under the figures
 * always names the filing currency and the rate used.
 */

/** Where the choice is kept. Readable by the server, which renders the page. */
export const CURRENCY_COOKIE = "wylthiq-currency";

/** A year: long enough that somebody sets this once and forgets it. */
export const CURRENCY_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export interface CurrencyChoice {
  /** Empty means "whatever this company trades in", the default. */
  code: string;
  label: string;
}

/**
 * What can be chosen.
 *
 * Limited to currencies the European Central Bank publishes a daily rate for,
 * since that is the source behind `getRate` and the one whose terms permit
 * this. A code missing from the ECB's list would fall through to Yahoo, which
 * is opt-in and may be off — so the menu would offer a currency the page then
 * could not produce.
 */
export const CURRENCY_CHOICES: CurrencyChoice[] = [
  { code: "", label: "As traded" },
  { code: "USD", label: "US dollar" },
  { code: "CAD", label: "Canadian dollar" },
  { code: "EUR", label: "Euro" },
  { code: "GBP", label: "British pound" },
  { code: "AUD", label: "Australian dollar" },
  { code: "JPY", label: "Japanese yen" },
  { code: "INR", label: "Indian rupee" },
  { code: "KRW", label: "South Korean won" },
  { code: "CHF", label: "Swiss franc" },
  { code: "SGD", label: "Singapore dollar" },
  { code: "HKD", label: "Hong Kong dollar" },
];

/**
 * A cookie's value, believed only if it names a currency on the menu.
 *
 * A cookie is reader-supplied text: it reaches `getRate` and the formatter, so
 * it is checked against the list rather than passed along.
 */
export function supportedCurrency(value: string | null | undefined): string | null {
  if (!value) return null;
  const code = value.trim().toUpperCase();
  return CURRENCY_CHOICES.some((c) => c.code && c.code === code) ? code : null;
}

/** The name for a code, for a sentence rather than a dropdown. */
export function currencyName(code: string): string {
  return CURRENCY_CHOICES.find((c) => c.code === code.toUpperCase())?.label ?? code;
}
