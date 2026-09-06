import { describe, expect, it } from "vitest";
import { csvFilename, screenRowsToCsv } from "./screener-csv";
import type { ScreenRow } from "./screener";

/**
 * Screen results as a CSV file.
 *
 * Almost everything here is about the two ways a CSV goes quietly wrong: a
 * field containing a delimiter that breaks the row structure, and a missing
 * figure written as a nought that a spreadsheet will then happily average.
 * Neither announces itself — the file opens, it just says something untrue.
 */

const row = (over: Partial<ScreenRow> = {}): ScreenRow => ({
  symbol: "AAPL",
  name: "Apple Inc.",
  sectorKind: "other",
  displaySector: "Technology",
  industry: "Electronic Computers",
  country: "US",
  healthScore: 9,
  headline: "Strong finances across the board.",
  price: 319.7,
  changePercent: 0.0335,
  fScore: 8,
  fScoreMax: 9,
  zZone: "safe",
  mFlagged: false,
  marketCap: 4.72e12,
  peRatio: 42.1,
  revenueGrowth: 0.061,
  netMargin: 0.269,
  debtToEquity: 1.4,
  zScore: 12.19,
  zApplicable: true,
  mScore: -2.29,
  mApplicable: true,
  pbRatio: 58.2,
  psRatio: 11.3,
  dividendYield: 0.0042,
  returnOnAssets: 0.312,
  currentRatio: 0.87,
  ...over,
});

const lines = (csv: string) => csv.trimEnd().split("\r\n");

describe("the shape of the file", () => {
  it("leads with a header naming every column", () => {
    const header = lines(screenRowsToCsv([]))[0];

    expect(header).toContain("Symbol");
    expect(header).toContain("Health score");
    expect(header).toContain("Piotroski F-Score");
  });

  it("writes one line per company", () => {
    const csv = screenRowsToCsv([row(), row({ symbol: "MSFT", name: "Microsoft Corp" })]);
    expect(lines(csv)).toHaveLength(3);
  });

  /*
    RFC 4180 says CRLF, and Excel on Windows is the one consumer that still
    cares — which is where most of these will be opened.
  */
  it("separates rows with CRLF and ends with one", () => {
    const csv = screenRowsToCsv([row()]);

    expect(csv).toContain("\r\n");
    expect(csv.endsWith("\r\n")).toBe(true);
    expect(csv).not.toMatch(/[^\r]\n/);
  });

  it("still produces a usable file when nothing matched", () => {
    expect(lines(screenRowsToCsv([]))).toHaveLength(1);
  });
});

describe("fields that would otherwise break the row", () => {
  /*
    The one that actually happens. "Alphabet Inc., Class A" contains the
    delimiter, and written raw it shifts every later column of that row one
    place left — silently, in a file somebody then sorts and filters.
  */
  it("quotes a company name containing a comma", () => {
    const csv = screenRowsToCsv([row({ name: "Alphabet Inc., Class A" })]);

    expect(csv).toContain('"Alphabet Inc., Class A"');
    // And the row still has as many fields as the header.
    const [header, first] = lines(csv);
    expect(countFields(first)).toBe(countFields(header));
  });

  it("doubles a quote inside a name rather than ending the field", () => {
    const csv = screenRowsToCsv([row({ name: 'The "Big" Company' })]);
    expect(csv).toContain('"The ""Big"" Company"');
  });

  it("survives a newline inside a field", () => {
    const csv = screenRowsToCsv([row({ name: "Two\nLines Inc" })]);

    expect(csv).toContain('"Two\nLines Inc"');
    // The embedded newline must not be read as a row break by a naive count,
    // which is exactly why it had to be quoted.
    expect(csv.split("\r\n").length).toBe(3);
  });

  it("leaves an ordinary name unquoted", () => {
    expect(screenRowsToCsv([row({ name: "Apple Inc." })])).toContain("Apple Inc.");
    expect(screenRowsToCsv([row({ name: "Apple Inc." })])).not.toContain('"Apple Inc."');
  });
});

describe("figures that are missing rather than zero", () => {
  /*
    The rule the rest of the app holds to on screen, and it matters more in an
    export: a spreadsheet will average a column of noughts and hand somebody a
    confident wrong answer, where it skips a blank.
  */
  it("writes an empty cell for a figure that was never reported", () => {
    const csv = screenRowsToCsv([
      row({ peRatio: null, netMargin: null, healthScore: null }),
    ]);
    const [, first] = lines(csv);

    expect(first).not.toMatch(/,0\.00,/);
    expect(first).toContain(",,");
  });

  it("does not confuse a real zero with a missing one", () => {
    const csv = screenRowsToCsv([row({ revenueGrowth: 0 })]);
    expect(lines(csv)[1]).toContain("0.0000");
  });

  /*
    Altman's zone is only meaningful where the model applies — it does not for
    a bank. Exporting the stored zone regardless would state a verdict the
    model never reached.
  */
  it("leaves the Altman zone blank where the model does not apply", () => {
    const csv = screenRowsToCsv([row({ zApplicable: false, zZone: "safe" })]);
    const [header, first] = lines(csv);
    const index = header.split(",").indexOf("Altman zone");

    expect(first.split(",")[index]).toBe("");
  });
});

describe("the filename", () => {
  it("says what it is and when it was taken", () => {
    expect(csvFilename(new Date("2026-08-30T12:00:00Z"))).toBe(
      "wylthiq-screen-2026-08-30.csv",
    );
  });
});

/** Counts top-level fields, respecting quoting — a naive split would not. */
function countFields(line: string): number {
  let count = 1;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) count++;
  }
  return count;
}
