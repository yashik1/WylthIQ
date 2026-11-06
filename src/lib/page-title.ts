/**
 * Page titles that fit what a search result shows.
 *
 * An audit of the live site on 2026-09-21 flagged 46 company pages whose
 * titles were outside the range engines display. "Archer-Daniels-Midland
 * Company (ADM) — financial health in plain English" is 77 characters before
 * the " · WylthIQ" the layout appends to every one of them, and what a reader
 * saw in a result list was the first two thirds of a sentence.
 */

import { deShout } from "./name-case";

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

/** The longest title budget a subject gets: what is left after the suffix. */
export const TITLE_BUDGET = MAX - SUFFIX.length;

/**
 * Legal forms a name can lose when it does not fit, last first. Only ever
 * dropped from the end, and only while the name is still too long — "Apple
 * Inc." keeps its "Inc." wherever there is room.
 */
const LEGAL_TAILS = [
  /,?\s+National Association$/i,
  /,?\s+(Inc|Incorporated|Corp|Corporation|Co|Company|Ltd|Limited|LLC|L\.P|LP|plc|N\.V|S\.A|AG|SE|Holdings?|Group)\.?$/i,
];

/**
 * A company name as a title shows it: the SEC's state tag dropped ("ZIONS
 * BANCORPORATION, NATIONAL ASSOCIATION /UT/" carries "/UT/" for Utah), and
 * capitals undone the same way the ticker lookup undoes them.
 */
export function tidyCompanyName(name: string): string {
  const untagged = name
    .replace(/\s*[/\\][A-Z]{2,3}[/\\]?\s*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return deShout(untagged);
}

/**
 * "Name (TICKER)", short enough to leave room for nothing else if need be.
 *
 * The name is tidied first, then loses trailing legal forms one at a time
 * while the whole still overruns — "Charles River Laboratories International,
 * Inc. (CRL)" becomes "Charles River Laboratories International (CRL)". A name
 * that is long without them is left whole: cutting it mid-word helps nobody.
 */
export function titleSubject(name: string, ticker: string): string {
  let shown = tidyCompanyName(name);
  const fits = () => `${shown} (${ticker})`.length <= TITLE_BUDGET;
  for (let guard = 0; guard < 4 && !fits(); guard++) {
    const before = shown;
    for (const tail of LEGAL_TAILS) shown = shown.replace(tail, "").replace(/[,\s]+$/, "");
    if (shown === before) break;
  }
  return `${shown} (${ticker})`;
}

/** Where search engines stop showing a description. */
export const DESCRIPTION_MAX = 160;

/**
 * The first description that fits, or the last one cut at a word.
 *
 * Pass candidates longest first. A cut one ends on a whole word and an
 * ellipsis rather than wherever a result list happens to stop.
 */
export function fitDescription(...candidates: string[]): string {
  for (const text of candidates) {
    if (text.length <= DESCRIPTION_MAX) return text;
  }
  const last = candidates[candidates.length - 1] ?? "";
  const cut = last.slice(0, DESCRIPTION_MAX - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > 80 ? cut.slice(0, space) : cut).replace(/[,;:\s—-]+$/, "")}…`;
}

/** A title from parts, the first that fits the budget. */
export function firstThatFits(...titles: string[]): string {
  return titles.find((t) => t.length <= TITLE_BUDGET) ?? titles[titles.length - 1];
}
