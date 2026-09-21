/**
 * Page titles that fit what a search result shows.
 *
 * An audit of the live site on 2026-09-21 flagged 46 company pages whose
 * titles were outside the range engines display. "Archer-Daniels-Midland
 * Company (ADM) — financial health in plain English" is 77 characters before
 * the " · WylthIQ" the layout appends to every one of them, and what a reader
 * saw in a result list was the first two thirds of a sentence.
 */

/** What the root layout appends: `template: "%s · WylthIQ"`. */
const SUFFIX = " · WylthIQ";

/** Where search engines stop showing a title. */
const MAX = 60;

export interface TitleParts {
  /** The company, fund or contract. Never shortened — it is what was searched for. */
  subject: string;
  /**
   * Descriptive tails, longest first. The first one that fits is used, and
   * none of them is truncated: half a phrase reads as a broken page and says
   * nothing the subject has not already said.
   */
  tails: string[];
  /** A listing reads "ZDV (ZDV.TO) on the TSX", with no dash. */
  separator?: " — " | " ";
}

export function fitTitle({ subject, tails, separator = " — " }: TitleParts): string {
  const budget = MAX - SUFFIX.length;

  for (const tail of tails) {
    const candidate = `${subject}${separator}${tail}`;
    if (candidate.length <= budget) return candidate;
  }

  // Nothing fits alongside it. A name long enough to exceed the budget on its
  // own is still left whole — cutting "Taiwan Semiconductor Manufacturing"
  // mid-word helps nobody, and the ticker is at the end of it.
  return subject;
}
