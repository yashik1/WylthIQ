import type { MetadataRoute } from "next";
import { eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { ALL_INSTRUMENTS } from "@/lib/instruments";
import { GUIDES } from "@/lib/guides/content";
import { siteUrl } from "@/lib/site-url";

/**
 * The sitemap.
 *
 * Around 650 URLs — 542 companies, the instrument catalogue and the static
 * pages — which is far inside the 50,000 URL and 50MB limits, so this stays a
 * single file rather than using generateSitemaps.
 *
 * Every page listed here answers a question somebody actually types into a
 * search engine ("is Apple profitable", "PANW debt"), and until this file
 * existed none of them had been offered to a crawler at all. The `robots`
 * metadata already in the app grants permission to index; a sitemap is the
 * separate act of saying what there is.
 */

/**
 * Rendered per request rather than cached.
 *
 * Two reasons, and the first is the serious one. A cached sitemap is built in
 * the build container, which freezes both the origin every URL is written
 * against and whether the database was reachable at the time — so a build
 * without DATABASE_URL would serve a sitemap of 67 URLs, and a build without
 * AUTH_URL would serve 600 URLs pointing at localhost, with nothing to
 * correct either until the next deploy.
 *
 * The cost is one indexed scan of a few hundred rows per fetch, and a sitemap
 * is fetched by crawlers a handful of times a day.
 */
export const dynamic = "force-dynamic";

/**
 * Public, indexable routes.
 *
 * `/journal` and `/account` are deliberately absent: one holds somebody's
 * private notes and the other their billing state. `/signin` and its
 * siblings are absent because a sign-in form is not an answer to any search.
 */
const STATIC_PATHS: { path: string; priority: number; changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] }[] = [
  { path: "/", priority: 1, changeFrequency: "daily" },
  { path: "/screen", priority: 0.9, changeFrequency: "daily" },
  { path: "/markets", priority: 0.8, changeFrequency: "hourly" },
  { path: "/compare", priority: 0.8, changeFrequency: "weekly" },
  { path: "/learn", priority: 0.8, changeFrequency: "monthly" },
  { path: "/backtest", priority: 0.6, changeFrequency: "weekly" },
  { path: "/backtest/screener", priority: 0.5, changeFrequency: "weekly" },
  { path: "/terms", priority: 0.3, changeFrequency: "yearly" },
];

/**
 * Companies whose pages are worth offering.
 *
 * Returns an empty list rather than throwing when the database is unreachable.
 * A sitemap that 500s teaches a crawler the whole file is broken and is worse
 * than a short one that is true — the static pages and the instrument
 * catalogue need no database and should still be listed.
 */
async function companyEntries(base: string): Promise<MetadataRoute.Sitemap> {
  if (!isDatabaseConfigured()) return [];

  try {
    const rows = await getDb()
      .select({ symbol: companies.symbol, updatedAt: companies.updatedAt })
      .from(companies)
      // Filtered on isActive: a delisted company's page is no longer something
      // to advertise, and a sitemap full of 404s is worse than no sitemap.
      .where(eq(companies.isActive, true));

    return rows.map((row) => ({
      url: `${base}/stock/${encodeURIComponent(row.symbol)}`,
      lastModified: row.updatedAt,
      changeFrequency: "weekly" as const,
      priority: 0.7,
    }));
  } catch {
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();

  const statics: MetadataRoute.Sitemap = STATIC_PATHS.map((s) => ({
    url: `${base}${s.path}`,
    lastModified: new Date(),
    changeFrequency: s.changeFrequency,
    priority: s.priority,
  }));

  // Commodities and coins need no database, so they are listed whatever state
  // the deployment is in.
  const instruments: MetadataRoute.Sitemap = ALL_INSTRUMENTS.map((i) => ({
    url: `${base}/stock/${encodeURIComponent(i.symbol)}`,
    lastModified: new Date(),
    changeFrequency: "daily" as const,
    priority: 0.6,
  }));

  // The written guides. Each answers a question people search for, and they
  // are the only long-form pages, so all of them are listed.
  const guides: MetadataRoute.Sitemap = GUIDES.map((guide) => ({
    url: `${base}/${guide.slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [...statics, ...guides, ...instruments, ...(await companyEntries(base))];
}
