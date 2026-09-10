/**
 * What a quote's own timestamp can honestly be shown as.
 *
 * Providers disagree on the format, and one of them is ambiguous: Twelve Data
 * sends "2026-09-10 15:59:00" in the exchange's local time with no zone, which
 * a server running in UTC would read as a moment several hours away from the
 * real one. So only a timestamp that states its zone becomes a time; a bare
 * date stays a date; anything else is left out rather than shown wrong.
 */
export type QuoteTime =
  | { kind: "instant"; iso: string }
  | { kind: "date"; date: string }
  | null;

const ZONED = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export function describeQuoteTime(asOf: string | null | undefined): QuoteTime {
  if (!asOf) return null;
  const value = asOf.trim();

  if (DATE_ONLY.test(value)) return { kind: "date", date: value };

  if (ZONED.test(value)) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? { kind: "instant", iso: new Date(ms).toISOString() } : null;
  }

  return null;
}
