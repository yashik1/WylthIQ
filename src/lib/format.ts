/** Display formatting helpers. */

/**
 * Symbols for the currencies a filer is likely to report in.
 *
 * Only two were handled before, and everything else fell through to no symbol
 * at all. SK hynix reports in won, so its revenue rendered as a bare "97.15T" —
 * ninety-seven trillion of nothing in particular — and elsewhere, where the
 * currency was not passed at all, as "$97.15T", which reads as a company larger
 * than every listed company on earth combined. It is ₩97 trillion, or about
 * $70 billion.
 */
const SYMBOLS: Record<string, string> = {
  USD: "$",
  CAD: "C$",
  AUD: "A$",
  NZD: "NZ$",
  HKD: "HK$",
  SGD: "S$",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
  CNY: "¥",
  KRW: "₩",
  INR: "₹",
  BRL: "R$",
  ZAR: "R",
  CHF: "CHF ",
  SEK: "kr",
  NOK: "kr",
  DKK: "kr",
  MXN: "Mex$",
  TWD: "NT$",
  ILS: "₪",
};

/**
 * Units that are written after the number rather than before it.
 *
 * `USX` is Yahoo's code for US cents, and it is what eleven of the agricultural
 * and livestock contracts are quoted in — wheat at "695" is 695 cents a bushel,
 * or $6.95. Rendering that as "$695" overstates the price of a bushel of wheat
 * by a hundred times, which is the same shape of mistake as reading a won
 * figure as dollars. Cents conventionally trail the number, so this map exists
 * separately rather than being forced into the prefix table.
 */
const SUFFIX_SYMBOLS: Record<string, string> = {
  USX: "¢",
  GBX: "p", // London quotes many shares in pence for the same reason.
};

/**
 * How a figure is labelled.
 *
 * A currency with no symbol here keeps its ISO code as a suffix rather than
 * being dropped: "1.2B TWD" is plain, but a number with no unit at all invites
 * the reader to assume dollars, which is the mistake worth preventing.
 */
function label(currency: string): { prefix: string; suffix: string } {
  const code = currency.toUpperCase();

  const trailing = SUFFIX_SYMBOLS[code];
  if (trailing) return { prefix: "", suffix: trailing };

  const symbol = SYMBOLS[code];
  if (symbol) return { prefix: symbol, suffix: "" };
  return { prefix: "", suffix: ` ${code}` };
}

/**
 * How many decimals a price needs to still say something.
 *
 * Two is right for a share and useless for a token: Shiba Inu trades near
 * 0.0000045, and `toFixed(2)` renders that as "$0.00" — a price of zero, which
 * is both wrong and the kind of wrong a reader cannot detect. Small numbers
 * get enough places to keep four significant figures, capped so nothing turns
 * into a wall of zeroes.
 */
function decimalsFor(abs: number): number {
  if (abs >= 1) return 2;
  if (abs >= 0.01) return 4;
  if (abs <= 0) return 2;
  return Math.min(12, 3 - Math.floor(Math.log10(abs)));
}

/**
 * A calendar date — "Oct 31, 2025" — from an ISO `YYYY-MM-DD`.
 *
 * Built from the string's own parts rather than the reader's clock: a filing
 * date is a date, not a moment, and passing it through a timezone turns the
 * 31st into the 30th for every reader west of UTC.
 */
export function calendarDate(iso: string | null | undefined): string | null {
  const match = iso?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Formats a large money figure as $1.23B / €456M / ₩12.3T. */
export function money(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const { prefix, suffix } = label(currency);
  const wrap = (n: string) => `${sign}${prefix}${n}${suffix}`;

  if (abs >= 1e12) return wrap(`${(abs / 1e12).toFixed(2)}T`);
  if (abs >= 1e9) return wrap(`${(abs / 1e9).toFixed(2)}B`);
  if (abs >= 1e6) return wrap(`${(abs / 1e6).toFixed(1)}M`);
  if (abs >= 1e3) return wrap(`${(abs / 1e3).toFixed(1)}K`);
  return wrap(abs.toFixed(2));
}

/** Formats a share price with two decimals. */
export function price(value: number | null | undefined, currency = "USD"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const { prefix, suffix } = label(currency);

  const abs = Math.abs(value);
  const places = decimalsFor(abs);
  let text = value.toFixed(places);

  // Trailing zeroes past two places are noise — "0.00000456" not
  // "0.000004560" — but the first two are kept so ordinary prices still line
  // up in a column as "12.30" rather than "12.3".
  if (places > 2) text = text.replace(/(\.\d\d\d*?)0+$/, "$1");

  return `${prefix}${text}${suffix}`;
}

/** Formats a ratio as a percentage. `0.253` becomes `25.3%`. */
export function percent(value: number | null | undefined, places = 1): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(places)}%`;
}

/** Formats a signed percentage for changes. `0.021` becomes `+2.1%`. */
export function signedPercent(value: number | null | undefined, places = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${(value * 100).toFixed(places)}%`;
}

/** Formats a plain number with a fixed number of decimals. */
export function num(value: number | null | undefined, places = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(places);
}

/** Formats a multiple, e.g. `1.8x`. */
export function multiple(value: number | null | undefined, places = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toFixed(places)}x`;
}

/** Compact integer with thousands separators. */
export function count(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}
