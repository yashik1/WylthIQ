import { NextResponse } from "next/server";
import { refuseIfRateLimited } from "@/lib/security/guard";
import { canAccess, getEntitlement } from "@/lib/billing/entitlement";
import { runScreen, type ScreenFilters } from "@/lib/screener";
import { csvFilename, screenRowsToCsv } from "@/lib/screener-csv";

export const dynamic = "force-dynamic";

/** As many rows as an export may contain. */
const MAX_ROWS = 1000;

/**
 * A screen, as a CSV file.
 *
 * The entitlement is checked here rather than only on the button that points
 * at this. A route handler is a public URL: the fact that the only link to it
 * sits behind a paywall constrains nobody who can read the page source.
 *
 * Filters come from the query string so an export is the same screen the
 * reader is looking at, reachable by pasting the URL — the same reason the
 * screener page itself is driven by its query string.
 */
export async function GET(request: Request) {
  const limited = refuseIfRateLimited(request, "compute");
  if (limited) return limited;

  const entitlement = await getEntitlement();

  if (!canAccess(entitlement, "CSV_EXPORT")) {
    /*
      402 rather than 403, matching what the other gates already return. The
      resource exists and is being withheld pending something the caller has
      not done, and keeping the status the same across every gate means the
      API's contract does not change every time the pricing does.

      With accountIsEnough set, CSV_EXPORT collapses to "account" (see
      requiredLevel in lib/billing/tiers.ts), so reaching this branch means
      the caller specifically is not signed in — the message and the link say
      that rather than naming a plan, and there is no /pricing to send anyone
      to while it is paused.
    */
    return NextResponse.json(
      { error: "Exporting results needs a free account.", upgrade: "/signin" },
      { status: 402 },
    );
  }

  const url = new URL(request.url);
  const filters = filtersFromQuery(url.searchParams);
  const result = await runScreen(filters, MAX_ROWS);

  if (result.status === "no-database") {
    return NextResponse.json({ error: "The screener is not available here." }, { status: 503 });
  }

  const csv = screenRowsToCsv(result.rows);

  return new NextResponse(csv, {
    headers: {
      // charset spelled out: Excel opens a bare text/csv as the system
      // codepage, which mangles any company name with an accent in it.
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename()}"`,
      // A screen is a snapshot of a nightly table; caching it in a shared
      // cache would hand one reader another reader's filter set.
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Filters from the query string, ignoring anything unrecognised.
 *
 * Everything numeric is parsed rather than passed through, so a hand-edited
 * `?minHealth=DROP TABLE` becomes absent rather than reaching the query
 * builder. Drizzle parameterises regardless; this is the belt to that brace,
 * and it also keeps a nonsense value from silently returning zero rows.
 */
function filtersFromQuery(params: URLSearchParams): ScreenFilters {
  const filters: ScreenFilters = {};

  const numeric = [
    "minHealth", "maxPe", "minFScore", "minMarketCap", "minGrowth",
    "maxPb", "maxPs", "minDividendYield", "minNetMargin", "minRoa",
    "maxDebtToEquity", "minCurrentRatio",
  ] as const;

  for (const key of numeric) {
    const raw = params.get(key);
    if (raw == null) continue;
    const value = Number(raw);
    if (Number.isFinite(value)) filters[key] = value;
  }

  for (const key of ["safeZoneOnly", "excludeAccountingFlags"] as const) {
    if (params.get(key) === "1" || params.get(key) === "true") filters[key] = true;
  }

  const sector = params.get("sector");
  if (sector) filters.sector = sector;
  const country = params.get("country");
  if (country) filters.country = country;
  const preset = params.get("preset");
  if (preset) filters.preset = preset as ScreenFilters["preset"];
  const sort = params.get("sort");
  if (sort) filters.sort = sort as ScreenFilters["sort"];

  return filters;
}
