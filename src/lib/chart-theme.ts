/**
 * Shared by the app's lightweight-charts charts: colours read from the theme,
 * and axis labels in the reader's own time zone.
 */

/** A theme colour from the page's CSS variables, or the fallback before there is a page. */
export function cssVar(name: string, fallback: string) {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

/**
 * Converts any of lightweight-charts' time representations into a Date.
 *
 * `Time` is a union: epoch seconds, a "YYYY-MM-DD" string, or a
 * `{ year, month, day }` object, and the library picks between them by series
 * type — daily and weekly data commonly arrives as the object form. Assuming a
 * number produced an invalid Date, which made Intl throw and took the whole
 * chart down with it.
 */
export function toDate(time: unknown): Date | null {
  if (typeof time === "number") return new Date(time * 1000);

  if (typeof time === "string") {
    // "YYYY-MM-DD" is parsed as UTC midnight, matching how the library treats it.
    const parsed = Date.parse(time.length === 10 ? `${time}T00:00:00Z` : time);
    return Number.isNaN(parsed) ? null : new Date(parsed);
  }

  if (time && typeof time === "object") {
    const d = time as { year?: number; month?: number; day?: number };
    if (d.year != null && d.month != null && d.day != null) {
      return new Date(Date.UTC(d.year, d.month - 1, d.day));
    }
  }

  return null;
}

/**
 * Formats an axis tick in the reader's own timezone.
 *
 * The series carries UTC epoch seconds, which the library renders as UTC — so a
 * US market opening at 9:30 Eastern appeared as 14:30 with nothing to say why.
 * Only the display is shifted; the underlying timestamps stay UTC.
 */
export function localTick(time: unknown, intraday: boolean): string {
  const date = toDate(time);
  // An unrecognised shape returns empty rather than throwing: a missing tick
  // label is a blemish, an exception takes the whole chart down.
  if (!date) return "";

  return intraday
    ? new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(date)
    : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

/** Full local date and time, for the crosshair readout. */
export function localCrosshair(time: unknown, intraday: boolean): string {
  const date = toDate(time);
  if (!date) return "";

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    ...(intraday ? { timeStyle: "short" as const } : {}),
  }).format(date);
}
