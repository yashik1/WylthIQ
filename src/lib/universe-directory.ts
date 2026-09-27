import { getUniverse } from "./universe";

/**
 * The covered companies, grouped for a directory page.
 *
 * Separate from `universe.ts` because that list is the ingest's input — an
 * unordered set of tickers a script iterates — and this is a reader's index:
 * sorted, grouped by first letter, and stable between renders so the page can
 * be built once and cached.
 */
export interface LetterGroup {
  letter: string;
  symbols: string[];
}

export function listCoveredCompanies(symbols: string[] = getUniverse()): LetterGroup[] {
  const byLetter = new Map<string, string[]>();

  for (const raw of symbols) {
    const symbol = raw.trim().toUpperCase();
    if (!symbol) continue;
    // A ticker always starts with a letter; anything else would sort into a
    // group nobody would think to look in.
    const letter = /^[A-Z]/.test(symbol) ? symbol[0] : "#";
    const group = byLetter.get(letter);
    if (group) group.push(symbol);
    else byLetter.set(letter, [symbol]);
  }

  return [...byLetter.entries()]
    .map(([letter, group]) => ({ letter, symbols: [...new Set(group)].sort() }))
    .sort((a, b) => a.letter.localeCompare(b.letter));
}
