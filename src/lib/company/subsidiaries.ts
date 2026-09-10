import { SEC_USER_AGENT } from "../providers/sec-config";
import type { Filing } from "../providers/types";

/**
 * The companies a company owns, out of Exhibit 21 of its annual report.
 *
 * Every 10-K carries one: a plain list of subsidiaries and where each is
 * incorporated, filed because Item 601(b)(21) of Regulation S-K requires it.
 * Free, public, and the company's own statement — the same standard
 * everything else on these pages is held to.
 *
 * What it is not, and the page says so rather than letting a reader assume:
 * this is a list of *significant subsidiaries*, not of acquisitions. The rule
 * lets a filer omit any subsidiary that would not itself be significant, and
 * most large ones do — Apple's exhibit names nineteen entities and ends with a
 * footnote saying the rest are left out. So a brand a company bought will
 * usually not appear, because the brand is not the legal entity and the entity
 * is not significant enough to name. Beats is absent from Apple's; that is the
 * filing being complete under the rule, not this code failing.
 *
 * What it does show is the shape of a company: where it is incorporated, how
 * many jurisdictions it operates through, and which arms are big enough to
 * name. For a conglomerate that is a genuinely long list.
 */

const SEC_HEADERS = { "User-Agent": SEC_USER_AGENT };

/** Exhibit 21 changes once a year. A day is far more often than that. */
const TTL_MS = 60 * 60 * 24 * 1000;
const CACHE_MAX = 300;

/**
 * How Exhibit 21 is named, across filers.
 *
 * There is no convention, and the eight largest filers tested use eight
 * different ones: `a10-kexhibit21109272025.htm`, `msft-ex21.htm`,
 * `ex21-subsidiariesxform10xk.htm`, `wmtexhibit21fy26.htm`. What they share is
 * "ex" or "exhibit" followed by 21, which is what this matches.
 */
const EXHIBIT_21 = /ex(?:hibit)?[-_]?\s?21/i;

/** Annual reports carry Exhibit 21; quarterly ones and 8-Ks do not. */
const ANNUAL_FORMS = new Set(["10-K", "10-K/A", "20-F", "40-F"]);

export interface Subsidiary {
  name: string;
  /** Where it is incorporated, as filed. Null when the exhibit omits it. */
  jurisdiction: string | null;
}

export interface SubsidiaryReport {
  subsidiaries: Subsidiary[];
  /** The annual report it came from. */
  filedAt: string;
  form: string;
  /** The exhibit itself, so a reader can check it. */
  url: string;
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

function decode(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m);
}

function cellText(html: string): string {
  return decode(html.replace(/<[^>]+>/g, " "))
    .replace(/ /g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Reads the subsidiary table out of an Exhibit 21 document.
 *
 * Row-wise rather than over the flattened text, because the flattened version
 * runs a name straight into the next jurisdiction — "Apple Asia Limited Hong
 * Kong Apple Asia LLC Delaware" — and no amount of splitting recovers the
 * boundary reliably. The table already knows where each field ends.
 *
 * Exported for its own tests: this is the part that has to survive a hundred
 * filers formatting the same list a hundred ways.
 */
export function parseExhibit21(html: string, parentName?: string | null): Subsidiary[] {
  const out: Subsidiary[] = [];
  const seen = new Set<string>();

  for (const row of html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const cells = [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)]
      .map((c) => cellText(c[1]))
      // Layout tables pad rows with empty cells for spacing; they carry no
      // data and would otherwise shift the columns.
      .filter((c) => c.length > 0);

    if (cells.length === 0) continue;

    const name = cells[0];
    if (!isSubsidiaryName(name)) continue;

    /*
      The filer itself is not one of its own subsidiaries.

      Several exhibits open with the parent — Coca-Cola's names "The Coca-Cola
      Company" above the list it heads — and carrying it through would tell a
      reader the company owns itself.
    */
    if (parentName && sameCompany(name, parentName)) continue;

    // Deduplicated case-insensitively: some exhibits repeat a parent across
    // sections, and a list that names one company twice looks wrong.
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      // A single-column exhibit is common and legitimate; jurisdiction is a
      // detail, and having the names without it is still worth showing.
      name,
      /*
        The second column, not the last.

        Exhibit 21's convention is name then jurisdiction, and the columns
        after that vary: Walmart adds percentage owned and a trading name, so
        reading the last cell reported every one of its subsidiaries as
        incorporated in "Walmart".
      */
      jurisdiction: cells.length > 1 ? cells[1] : null,
    });
  }

  return out;
}

/**
 * Whether a first cell is a company rather than a heading or a footnote.
 *
 * Exhibits carry a title row, a column header, and often a footnote about the
 * subsidiaries left out — all of which sit in the same table as the data.
 */
function isSubsidiaryName(value: string): boolean {
  if (value.length < 2 || value.length > 120) return false;

  /*
    A trailing colon is a section heading.

    Longer lists are grouped — "U.S. Subsidiaries:", "Organized Under Laws
    of:" — and those headings sit in the same table as the companies, in the
    same column, so nothing but their punctuation distinguishes them.
  */
  if (value.endsWith(":")) return false;

  const lower = value.toLowerCase();
  if (/^(name|entity|subsidiar|jurisdiction|state|country|company|\*|note)/.test(lower)) {
    return false;
  }
  // A footnote sentence, not a name.
  if (/pursuant to|omitted|regulation s-k|item 601/.test(lower)) return false;

  // A name has a letter in it; a page number or a stray symbol does not.
  return /[a-z]/i.test(value);
}

/**
 * Whether two company names are the same company.
 *
 * Compared on letters and digits alone, because a filer writes its own name
 * inconsistently across a document — "The Coca-Cola Company" against
 * "Coca-Cola Co" — and punctuation and case carry no meaning here.
 */
function sameCompany(a: string, b: string): boolean {
  const norm = (v: string) =>
    v.toLowerCase().replace(/\b(the|inc|corp|corporation|company|co|ltd|plc|llc|lp)\b/g, "").replace(/[^a-z0-9]/g, "");
  const left = norm(a);
  const right = norm(b);
  return left.length > 2 && left === right;
}

interface Cached {
  at: number;
  value: SubsidiaryReport | null;
}

const cache = new Map<string, Cached>();

function read(symbol: string): Cached | null {
  const hit = cache.get(symbol);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(symbol);
    return null;
  }
  cache.delete(symbol);
  cache.set(symbol, hit);
  return hit;
}

function write(symbol: string, value: SubsidiaryReport | null): void {
  cache.set(symbol, { at: Date.now(), value });
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

/**
 * The subsidiary list from the most recent annual report, or null.
 *
 * Null is an ordinary answer: a company may file no Exhibit 21 at all, which
 * Item 601(b)(21)(ii) permits when it has no significant subsidiaries. Every
 * failure path returns null and the page omits the section rather than
 * showing an empty one, because "no subsidiaries listed" and "we could not
 * read the filing" are different claims.
 *
 * Takes the filings the page already fetched rather than fetching its own —
 * the annual report is in that list, and asking EDGAR twice for the same
 * thing is the kind of waste a cached provider is supposed to prevent.
 */
export async function getSubsidiaries(
  symbol: string,
  filings: Filing[],
  parentName: string | null = null,
): Promise<SubsidiaryReport | null> {
  const upper = symbol.toUpperCase();

  const cached = read(upper);
  if (cached) return cached.value;

  const value = await fetchSubsidiaries(filings, parentName).catch(() => null);
  write(upper, value);
  return value;
}

async function fetchSubsidiaries(
  filings: Filing[],
  parentName: string | null,
): Promise<SubsidiaryReport | null> {
  const annual = filings.find((f) => ANNUAL_FORMS.has(f.form));
  if (!annual) return null;

  // The filing's directory, from the document URL the filings list already
  // carries. Everything in one submission sits beside its primary document.
  const directory = annual.url.replace(/\/[^/]*$/, "");
  if (!/\/Archives\/edgar\/data\//.test(directory)) return null;

  const index = await fetch(`${directory}/index.json`, {
    headers: { ...SEC_HEADERS, Accept: "application/json" },
    next: { revalidate: 60 * 60 * 24 },
  });
  if (!index.ok) return null;

  const listing = (await index.json()) as {
    directory?: { item?: { name?: string }[] };
  };

  const file = (listing.directory?.item ?? [])
    .map((i) => i.name ?? "")
    .filter((n) => /\.html?$/i.test(n))
    .find((n) => EXHIBIT_21.test(n));
  if (!file) return null;

  const url = `${directory}/${file}`;
  const res = await fetch(url, { headers: SEC_HEADERS, next: { revalidate: 60 * 60 * 24 } });
  if (!res.ok) return null;

  const subsidiaries = parseExhibit21(await res.text(), parentName);
  if (subsidiaries.length === 0) return null;

  return { subsidiaries, filedAt: annual.filedAt, form: annual.form, url };
}
