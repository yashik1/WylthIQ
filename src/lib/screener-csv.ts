import type { ScreenRow } from "./screener";

/**
 * Screen results as a CSV file.
 *
 * Kept apart from the route that serves it so the formatting can be tested
 * without standing up a request — the escaping below is the sort of thing that
 * looks obviously right and is quietly wrong for one company in five hundred.
 */

/** Columns, in the order a reader would want them. */
const COLUMNS = [
  "Symbol",
  "Name",
  "Sector",
  "Country",
  "Health score",
  "Piotroski F-Score",
  "Altman Z-Score",
  "Altman zone",
  "Beneish M-Score",
  "Market cap",
  "P/E",
  "P/B",
  "P/S",
  "Dividend yield",
  "Revenue growth",
  "Net margin",
  "Return on assets",
  "Debt to equity",
  "Current ratio",
] as const;

/**
 * One CSV field, escaped.
 *
 * Company names contain commas ("Alphabet Inc., Class A"), quotes, and — for
 * a handful of foreign filers — newlines, any of which silently corrupts the
 * row structure if written raw. The rule is RFC 4180's: wrap in quotes when
 * the value contains a delimiter, a quote or a line break, and double any
 * quote inside.
 */
function field(value: string | number | null | undefined): string {
  if (value == null) return "";
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

/** A number as text, or blank. Never zero for missing — see the note below. */
function num(value: number | null | undefined, places = 2): string {
  /*
    A missing figure is an empty cell, not a nought. This is the same rule the
    rest of the app holds to on screen, and it matters more in an export: a
    spreadsheet will happily average a column of zeroes and give somebody a
    confident wrong answer, where a blank is skipped.
  */
  if (value == null || !Number.isFinite(value)) return "";
  return value.toFixed(places);
}

export function screenRowsToCsv(rows: readonly ScreenRow[]): string {
  const lines: string[] = [COLUMNS.map(field).join(",")];

  for (const row of rows) {
    lines.push(
      [
        field(row.symbol),
        field(row.name),
        field(row.displaySector),
        field(row.country),
        num(row.healthScore, 1),
        // An integer score; toFixed(0) rather than a decimal place on a count.
        num(row.fScore, 0),
        num(row.zScore),
        field(row.zApplicable ? row.zZone : ""),
        num(row.mScore),
        num(row.marketCap, 0),
        num(row.peRatio),
        num(row.pbRatio),
        num(row.psRatio),
        num(row.dividendYield, 4),
        num(row.revenueGrowth, 4),
        num(row.netMargin, 4),
        num(row.returnOnAssets, 4),
        num(row.debtToEquity),
        num(row.currentRatio),
      ].join(","),
    );
  }

  /*
    CRLF, and a trailing one. RFC 4180 specifies it, and Excel on Windows —
    where most of these will be opened — is the one consumer that still cares.
  */
  return lines.join("\r\n") + "\r\n";
}

/** A filename that says what the export is and when it was taken. */
export function csvFilename(now = new Date()): string {
  return `wylthiq-screen-${now.toISOString().slice(0, 10)}.csv`;
}
