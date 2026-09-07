import type { Metadata } from "next";
import Link from "next/link";
import {
  ShieldCheck,
  PiggyBank,
  TrendingUp,
  HandCoins,
  TriangleAlert,
  type LucideIcon,
} from "lucide-react";
import { SetupNotice } from "@/components/setup-notice";
import { Badge, Card, EmptyState, MeterBar, NotReported, PageHeader, RatingBadge } from "@/components/ui";
import { money, multiple, percent, price as fmtPrice, signedPercent } from "@/lib/format";
import type { Rating } from "@/lib/scoring/types";
import {
  PRESETS,
  runScreen,
  SORTS,
  usesAdvancedFilters,
  withoutAdvancedFilters,
  type PresetKey,
  type ScreenFilters,
  type ScreenRow,
  type SortKey,
} from "@/lib/screener";
import { DISPLAY_SECTORS } from "@/lib/scoring/sectors";
import { accountIsEnough } from "@/lib/billing/access-mode";
import { canAccess, getEntitlement } from "@/lib/billing/entitlement";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Screener — filter companies by financial health",
  description:
    "Filter hundreds of US and Canadian companies by financial health, valuation, growth and debt.",
};

/** One icon per preset. "red-flags" is a warning, not an invitation, so it is
 * styled separately below rather than sharing the other four's accent tile. */
const PRESET_ICONS: Record<PresetKey, LucideIcon> = {
  healthy: ShieldCheck,
  "cheap-profitable": PiggyBank,
  growing: TrendingUp,
  dividend: HandCoins,
  "red-flags": TriangleAlert,
};

/*
  The sectors a reader recognises, not the four scoring buckets.

  This dropdown used to offer manufacturing / financial / real-estate / other,
  which is `sectorKind` — an internal gate on which valuation models apply,
  and not a list anybody thinks in. It also meant the dashboard's sector
  heatmap, which groups by the familiar names, had nowhere to link to.
*/
const SECTORS = [
  { value: "", label: "All sectors" },
  ...DISPLAY_SECTORS.map((s) => ({ value: s, label: s })),
];

const COUNTRIES = [
  { value: "", label: "US & Canada" },
  { value: "US", label: "US only" },
  { value: "CA", label: "Canada only" },
];

function healthRating(score: number | null): Rating {
  if (score == null) return "unknown";
  if (score >= 7.5) return "good";
  if (score >= 5) return "fair";
  return "poor";
}

export default async function ScreenPage({ searchParams }: PageProps<"/screen">) {
  const params = await searchParams;

  const get = (key: string): string | undefined => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };
  const numeric = (key: string): number | undefined => {
    const v = Number(get(key));
    return Number.isFinite(v) ? v : undefined;
  };

  const preset = get("preset") as PresetKey | undefined;
  const sort = (get("sort") as SortKey | undefined) ?? "health";

  const flag = (key: string): true | undefined => {
    const v = get(key);
    return v === "1" || v === "true" ? true : undefined;
  };

  const requested: ScreenFilters = {
    preset: preset && preset in PRESETS ? preset : undefined,
    sector: get("sector") || undefined,
    country: get("country") || undefined,
    minHealth: numeric("minHealth"),
    maxPe: numeric("maxPe"),
    minFScore: numeric("minFScore"),
    minMarketCap: numeric("minMarketCap"),
    minGrowth: numeric("minGrowth"),
    sort: sort in SORTS ? sort : ("health" as SortKey),

    // The Pro dimensions. Read unconditionally and stripped below rather than
    // read conditionally, so there is one place that decides who gets them.
    maxPb: numeric("maxPb"),
    maxPs: numeric("maxPs"),
    minDividendYield: numeric("minDividendYield"),
    minNetMargin: numeric("minNetMargin"),
    minRoa: numeric("minRoa"),
    maxDebtToEquity: numeric("maxDebtToEquity"),
    minCurrentRatio: numeric("minCurrentRatio"),
    safeZoneOnly: flag("safeZoneOnly"),
    excludeAccountingFlags: flag("excludeAccountingFlags"),
  };

  /*
    The gate, applied to the query rather than to the page.

    A reader without the entitlement who arrives on a URL carrying advanced
    filters — a shared link, a hand-edited query string — gets the free screen
    those filters reduce to, plus a note saying so. Refusing the request
    outright would punish somebody for a link they were sent, on a page whose
    whole purpose is to be shareable; and honouring the filters would hand the
    paid feature to anyone who could read a URL.
  */
  const entitlement = await getEntitlement();
  const mayUseAdvanced = canAccess(entitlement, "ADVANCED_SCREENER");
  const advancedRequested = usesAdvancedFilters(requested);
  const filters = mayUseAdvanced ? requested : withoutAdvancedFilters(requested);

  const result = await runScreen(filters);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Scores precomputed nightly" title="Screener">
        <p>
          Filters on financial health, not price action. Every column traces back to a
          filing.
        </p>
      </PageHeader>

      {/* Preset screens: the entry point for anyone who does not know which
          ratio they want to filter on. */}
      <section aria-labelledby="presets-heading">
        <h2 id="presets-heading" className="sr-only">
          Quick screens
        </h2>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.keys(PRESETS) as PresetKey[]).map((key) => {
            const active = filters.preset === key;
            const Icon = PRESET_ICONS[key];
            const warning = key === "red-flags";
            return (
              <Link
                key={key}
                href={active ? "/screen" : `/screen?preset=${key}`}
                className={`rounded-xl border p-4 shadow-sm transition-[box-shadow,border-color,background-color] hover:shadow-md ${
                  active
                    ? warning
                      ? "border-poor bg-poor-soft"
                      : "border-accent bg-accent-soft"
                    : "border-border hover:border-accent"
                }`}
              >
                <span
                  aria-hidden
                  className={`mb-2.5 inline-flex size-8 items-center justify-center rounded-lg ${
                    active
                      ? warning
                        ? "bg-poor text-poor-fg"
                        : "bg-accent text-accent-fg"
                      : warning
                        ? "bg-poor-soft text-poor"
                        : "bg-accent-soft text-accent"
                  }`}
                >
                  <Icon className="size-4" strokeWidth={2} />
                </span>
                <p
                  className={`text-sm font-semibold ${
                    active ? (warning ? "text-poor" : "text-accent") : ""
                  }`}
                >
                  {PRESETS[key].label}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted">
                  {PRESETS[key].description}
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      {/*
        Filters beside the results rather than above them.

        Stacked, every adjustment pushed the table off-screen and the reader
        lost the thing they were adjusting it against. Side by side, a changed
        threshold and its effect are visible at once. The rail is held between
        240 and 268px — wide enough for the longest field label to sit on one
        line, narrow enough that the table keeps the space a table needs — and
        the results column is minmax(0, 1fr) so a wide row scrolls inside its
        own box instead of stretching the page sideways.
      */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[minmax(240px,268px)_minmax(0,1fr)] lg:items-start">
        <Card className="min-w-0 lg:sticky lg:top-5">
          <form method="get" className="grid grid-cols-[minmax(0,1fr)] gap-4 p-5">
          {filters.preset && <input type="hidden" name="preset" value={filters.preset} />}

          <Field label="Sector" name="sector" value={filters.sector} options={SECTORS} />
          <Field label="Listing" name="country" value={filters.country} options={COUNTRIES} />

          <NumberField
            label="Min health score"
            name="minHealth"
            value={filters.minHealth}
            placeholder="0–10"
            step="0.5"
            hint="One score out of 10 combining profit, growth, debt and accounting quality."
          />
          <NumberField
            label="Max P/E"
            name="maxPe"
            value={filters.maxPe}
            placeholder="e.g. 20"
            hint="Years of current profit it would take to earn back the share price. Lower is cheaper."
          />
          <NumberField
            label="Min F-Score"
            name="minFScore"
            value={filters.minFScore}
            placeholder="0–9"
            hint="Nine checks of financial strength. 7 or more means most things are improving."
          />
          <NumberField
            label="Min revenue growth"
            name="minGrowth"
            value={filters.minGrowth}
            placeholder="0.15 = 15%"
            step="0.05"
            hint="Sales growth on last year, written as a decimal — 0.15 means 15% growth."
          />
          <NumberField
            label="Min market value"
            name="minMarketCap"
            value={filters.minMarketCap}
            placeholder="e.g. 1000000000"
            hint="What the whole company is worth at today's share price."
          />

          <div className="min-w-0">
            <label htmlFor="sort" className="text-xs text-muted">
              Sort by
            </label>
            <select
              id="sort"
              name="sort"
              defaultValue={filters.sort}
              className="mt-1 w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              {(Object.keys(SORTS) as SortKey[]).map((k) => (
                <option key={k} value={k}>
                  {SORTS[k].label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-wrap items-end gap-2 pt-1">
            <button
              type="submit"
              className="rounded-lg border border-transparent bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
            >
              Apply filters
            </button>
            <Link
              href="/screen"
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-strong transition-colors hover:bg-surface-2"
            >
              Reset
            </Link>
          </div>
          </form>
        </Card>

        <div className="min-w-0 space-y-5">
          {/* Results */}
          {/*
          Said only when it actually happened. A reader who never used an
          advanced filter should not be told about one they did not ask for,
          which is how a paywall notice turns into an advertisement.
        */}
        {advancedRequested && !mayUseAdvanced && (
          <Card className="p-4">
            {/*
              No /pricing to point at while the pricing page is paused, and no
              loss in that: with accountIsEnough set, "Pro" already collapses to
              "signed in" (see requiredLevel in lib/billing/tiers.ts), so the
              honest fix for this reader really is signing in, not a plan page.
              Revisit the wording here if ACCESS_MODE ever flips back on.
            */}
            <p className="text-sm leading-relaxed text-muted-strong">
              This link uses filters that need a free account — book value, margins, returns,
              debt cover and the accounting screens. They have been left out, so these are the
              results for the rest of it.
              {accountIsEnough && (
                <>
                  {" "}
                  <Link href="/signin" className="text-accent underline underline-offset-2">
                    Sign in to use them
                  </Link>
                  .
                </>
              )}
            </p>
          </Card>
        )}

        {result.status !== "ok" ? (
          <SetupNotice status={result.status} detail={result.detail} />
        ) : (
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-5 py-3">
              <p className="text-sm text-muted">
                {result.total} {result.total === 1 ? "company" : "companies"}
                {filters.preset && ` · ${PRESETS[filters.preset].label}`}
              </p>

              {/*
                A plain link rather than a button: it is a GET that returns a
                file, so it should be openable in a new tab and copyable like
                any other URL. The route checks the entitlement again on its
                own — this only decides whether to offer it.
              */}
              {mayUseAdvanced ? (
                <a
                  href={`/api/screen/export${exportQuery(filters)}`}
                  className="text-xs text-accent underline underline-offset-2"
                >
                  Export CSV
                </a>
              ) : accountIsEnough ? (
                <Link href="/signin" className="text-xs text-muted underline underline-offset-2">
                  Sign in to export
                </Link>
              ) : null}
            </div>
            <ResultsTable rows={result.rows} />
          </Card>
        )}

        {result.status === "ok" && result.rows.length === 0 && (
          <Card>
            {result.missingData ? (
              // This preset can never match until the data it needs exists, so
              // saying "no companies match" would send people to adjust filters
              // that were never the problem.
              <EmptyState
                title="This screen needs price data"
                /*
                  Says what is missing, not why.

                  This used to assert the cause — "no price source was
                  configured when the data was loaded" — and send the reader
                  off to add an API key. On the live deployment that diagnosis
                  was simply wrong: price sources were configured and working,
                  and the dashboard was showing current prices for the same
                  companies. The column was empty because the market-cap lookup
                  reached past the provider failover chain to two named
                  providers, one of which had a rejected key and one of which
                  was rate-limited. A confidently wrong explanation is worse
                  than none, because it costs somebody an afternoon.
                */
                description={`"${filters.preset ? PRESETS[filters.preset].label : "This screen"}" needs ${result.missingData.needs}, and no company in the database has it yet. Prices are stored by a separate refresh from the one that reads the filings, so this screen fills in once that has run — every other screen works meanwhile.`}
                action={
                  <Link
                    href="/screen?preset=healthy"
                    className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
                  >
                    Try &ldquo;Financially healthy&rdquo; instead
                  </Link>
                }
              />
            ) : (
              <EmptyState
                title="No companies match these filters"
                description="Every filter applied, but nothing cleared them all. Try relaxing a threshold, or reset and start from a preset."
                action={
                  <Link
                    href="/screen"
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium"
                  >
                    Reset filters
                  </Link>
                }
              />
            )}
          </Card>
        )}
        </div>
      </div>
    </div>
  );
}

function ResultsTable({ rows }: { rows: ScreenRow[] }) {
  return (
    <div className="scroll-x">
      <table className="w-full min-w-[58rem] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
            <th scope="col" className="px-5 py-2.5 font-medium">Company</th>
            <th scope="col" className="px-3 py-2 font-medium">Health</th>
            {/* Price sits before the figures derived from it, so a reader can
                see what the market value and the P/E were computed against. */}
            <th scope="col" className="px-3 py-2 text-right font-medium">Price</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Market value</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">P/E</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Growth</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Margin</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">F-Score</th>
            <th scope="col" className="px-3 py-2 font-medium">Flags</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.symbol} className="transition-colors hover:bg-surface-2">
              <td className="px-5 py-3">
                <Link
                  href={`/stock/${encodeURIComponent(r.symbol)}`}
                  className="block transition-colors hover:text-accent"
                >
                  <span className="text-[0.9375rem] font-bold tracking-tight">{r.symbol}</span>
                  {r.country === "CA" && (
                    <span className="ml-1.5 text-[10px] text-muted">CA</span>
                  )}
                  <span className="block max-w-[16rem] truncate text-xs text-muted">
                    {r.name}
                  </span>
                </Link>
              </td>
              <td className="px-3 py-3">
                <div className="flex w-28 flex-col gap-1.5">
                  <RatingBadge
                    rating={healthRating(r.healthScore)}
                    label={r.healthScore != null ? `${r.healthScore.toFixed(1)}/10` : "no data"}
                  />
                  <MeterBar
                    value={r.healthScore}
                    max={10}
                    rating={healthRating(r.healthScore)}
                    label={`Health ${r.healthScore ?? "unknown"} out of 10`}
                  />
                </div>
              </td>
              <td className="tnum px-3 py-3 text-right">
                {r.price != null ? (
                  <>
                    <span className="block">{fmtPrice(r.price)}</span>
                    {r.changePercent != null && (
                      <span
                        className={`block text-xs ${
                          r.changePercent >= 0 ? "text-up" : "text-down"
                        }`}
                      >
                        {signedPercent(r.changePercent)}
                      </span>
                    )}
                  </>
                ) : (
                  <NotReported />
                )}
              </td>
              <td className="tnum px-3 py-3 text-right">{money(r.marketCap)}</td>
              <td className="tnum px-3 py-3 text-right">{multiple(r.peRatio)}</td>
              <td className="tnum px-3 py-3 text-right">{percent(r.revenueGrowth)}</td>
              <td className="tnum px-3 py-3 text-right">{percent(r.netMargin)}</td>
              <td className="tnum px-3 py-3 text-right">
                {r.fScore != null ? `${r.fScore}/${r.fScoreMax ?? 9}` : <NotReported />}
              </td>
              <td className="px-3 py-3">
                <div className="flex flex-wrap gap-1">
                  {r.zZone === "distress" && <Badge tone="poor">Distress risk</Badge>}
                  {r.mFlagged && <Badge tone="poor">Accounting</Badge>}
                  {r.sectorKind === "financial" && <Badge>Bank</Badge>}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  options,
}: {
  label: string;
  name: string;
  value?: string;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="min-w-0">
      <label htmlFor={name} className="text-xs text-muted">
        {label}
      </label>
      <select
        id={name}
        name={name}
        defaultValue={value ?? ""}
        className="mt-1 w-full min-w-0 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function NumberField({
  label,
  name,
  value,
  placeholder,
  step,
  hint,
}: {
  label: string;
  name: string;
  value?: number;
  placeholder?: string;
  step?: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={name} className="flex items-center gap-1 text-xs text-muted" title={hint}>
        {label}
        {hint && (
          <>
            <span aria-hidden className="cursor-help opacity-60">ⓘ</span>
            <span className="sr-only">{hint}</span>
          </>
        )}
      </label>
      <input
        id={name}
        name={name}
        type="number"
        step={step}
        inputMode="decimal"
        defaultValue={value ?? ""}
        placeholder={placeholder}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted/60"
      />
    </div>
  );
}

/**
 * The current screen as a query string for the export route.
 *
 * Rebuilt from the resolved filters rather than forwarded from the incoming
 * URL, so the file matches what is actually on screen — including the case
 * where an advanced filter was stripped, where forwarding the original query
 * would export a different screen from the one the reader is looking at.
 */
function exportQuery(filters: ScreenFilters): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value == null || value === false || value === "") continue;
    params.set(key, String(value));
  }
  const query = params.toString();
  return query ? `?${query}` : "";
}
