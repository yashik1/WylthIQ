import { getCompanyFilings } from "../providers";
import type { Filing } from "../providers/types";
import { classifyFiling, type ClassifiedFiling } from "../filings/timeline";

/**
 * What the companies a reader saved have filed recently.
 *
 * The same filings the company pages list, classified by the same timeline
 * rules, so a filing described one way on the research page is never described
 * another way on the company page.
 */

export interface NewFiling extends ClassifiedFiling {
  symbol: string;
  name: string | null;
  form: string;
  filedAt: string;
  url: string;
}

const DAY_MS = 86_400_000;

const SEVERITY_RANK: Record<ClassifiedFiling["severity"], number> = {
  "red-flag": 0,
  notable: 1,
  routine: 2,
};

/** One company's filings from the last `days` days, classified. */
export function recentFilings(
  company: { symbol: string; name: string | null },
  filings: Filing[],
  days: number,
  now = Date.now(),
): NewFiling[] {
  const cutoff = now - days * DAY_MS;
  return filings
    .filter((filing) => {
      const filed = Date.parse(filing.filedAt);
      return Number.isFinite(filed) && filed >= cutoff && filed <= now + DAY_MS;
    })
    .map((filing) => ({
      ...classifyFiling(filing),
      symbol: company.symbol,
      name: company.name,
      form: filing.form,
      filedAt: filing.filedAt,
      url: filing.url,
    }));
}

/** The strongest filings first, then the newest. */
export function orderNewFilings(items: NewFiling[]): NewFiling[] {
  return [...items].sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.filedAt.localeCompare(a.filedAt),
  );
}

/**
 * Recent filings across a reader's saved companies.
 *
 * Sequential and capped, for the reason the weekly digest is: EDGAR publishes
 * a fair-use limit of ten requests a second, and fanning out across a long
 * saved list at once is how a deployment gets its user agent blocked. The
 * result says how many companies it covered, so a capped list is never
 * presented as complete.
 */
export async function newFilingsFor(
  companies: { symbol: string; name: string | null }[],
  { days = 14, maxCompanies = 12 }: { days?: number; maxCompanies?: number } = {},
): Promise<{ items: NewFiling[]; covered: number; total: number; days: number }> {
  const covered = companies.slice(0, maxCompanies);
  const items: NewFiling[] = [];

  for (const company of covered) {
    const filings = await getCompanyFilings(company.symbol, 25).catch(() => [] as Filing[]);
    items.push(...recentFilings(company, filings, days));
  }

  return { items: orderNewFilings(items), covered: covered.length, total: companies.length, days };
}
