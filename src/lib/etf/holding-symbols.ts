import { inArray } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { cusipSymbols } from "../db/schema";

/**
 * This site's symbols for a fund's holdings, by CUSIP.
 *
 * N-PORT names each position by CUSIP and never by ticker, so a fund's rows
 * could not link anywhere. The 13F job already keeps a CUSIP-to-ticker table
 * for every company this site scores (`cusip_symbols`), which is exactly the
 * set of holdings that have a page here to link to. Anything not in it — a
 * bond, a foreign share, a company outside the universe — stays plain text.
 *
 * Fails soft: a slow or missing table costs the links, never the page.
 */
export async function symbolsForCusips(
  cusips: readonly (string | null | undefined)[],
  read: (wanted: string[]) => Promise<{ cusip: string; symbol: string }[]> = readCusipSymbols,
): Promise<Record<string, string>> {
  const wanted = [...new Set(cusips.filter((c): c is string => typeof c === "string" && /^[0-9A-Z]{9}$/.test(c)))];
  if (wanted.length === 0) return {};
  try {
    const rows = await read(wanted);
    return Object.fromEntries(rows.map((row) => [row.cusip, row.symbol]));
  } catch {
    return {};
  }
}

async function readCusipSymbols(wanted: string[]): Promise<{ cusip: string; symbol: string }[]> {
  if (!isDatabaseConfigured()) return [];
  return getDb()
    .select({ cusip: cusipSymbols.cusip, symbol: cusipSymbols.symbol })
    .from(cusipSymbols)
    .where(inArray(cusipSymbols.cusip, wanted));
}
