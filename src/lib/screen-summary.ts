import { money } from "./format";
import { ADVANCED_FILTER_KEYS, PRESETS, type ScreenFilters } from "./screener";

/**
 * A saved screen in one line — "Quality · Canada only · health ≥ 7".
 *
 * So a list of saved screens says what each one does, rather than leaving the
 * reader to remember what they meant by a name they typed months ago. Filters
 * appear in the order the form shows them; the advanced set is counted rather
 * than spelled out, because a line that lists nine thresholds is not a summary.
 */

const LISTING: Record<string, string> = { US: "US only", CA: "Canada only" };

export function describeFilters(filters: ScreenFilters): string {
  const parts: string[] = [];

  if (filters.preset) parts.push(PRESETS[filters.preset].label);
  if (filters.sector) parts.push(filters.sector);
  if (filters.country) parts.push(LISTING[filters.country] ?? filters.country);
  if (filters.minHealth != null) parts.push(`health ≥ ${filters.minHealth}`);
  if (filters.maxPe != null) parts.push(`P/E ≤ ${filters.maxPe}`);
  if (filters.minFScore != null) parts.push(`F-Score ≥ ${filters.minFScore}`);
  if (filters.minGrowth != null) parts.push(`growth ≥ ${Math.round(filters.minGrowth * 100)}%`);
  if (filters.minMarketCap != null) parts.push(`market value ≥ ${money(filters.minMarketCap)}`);

  const advanced = ADVANCED_FILTER_KEYS.filter(
    (key) => filters[key] != null && filters[key] !== false,
  ).length;
  if (advanced > 0) parts.push(`${advanced} advanced ${advanced === 1 ? "filter" : "filters"}`);

  return parts.length > 0 ? parts.join(" · ") : "All companies";
}
