import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { LocalTime } from "@/components/local-time";
import {
  Badge,
  Card,
  EmptyState,
  NotReported,
  PageHeader,
  RatingBadge,
} from "@/components/ui";
import { WatchlistPanel, WatchlistSync } from "@/components/watchlist";
import { GroupPicker } from "@/components/watchlist-groups";
import { auth } from "@/lib/auth";
import { calendarDate, multiple, percent } from "@/lib/format";
import { SEVERITY_LABEL } from "@/lib/scoring/change-thresholds";
import { listWatchlist } from "@/lib/watchlist/actions";
import {
  filterByGroup,
  healthRating,
  loadWatchlist,
  sortWatchlist,
  UNGROUPED,
  WATCHLIST_SORTS,
  watchlistSummary,
  type WatchlistRow,
  type WatchlistSort,
} from "@/lib/watchlist/dashboard";
import { groupsInUse } from "@/lib/watchlist/groups";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Watchlist",
  description:
    "The companies you saved, with their health, what changed in their figures, and what is worth a closer look.",
  // One reader's own list.
  robots: { index: false, follow: false },
};

export default async function WatchlistPage({ searchParams }: PageProps<"/watchlist">) {
  const params = await searchParams;
  const get = (key: string): string | undefined => {
    const v = params[key];
    return Array.isArray(v) ? v[0] : v;
  };

  const session = await auth().catch(() => null);
  const signedIn = Boolean(session?.user?.id);

  const header = (
    <PageHeader eyebrow="Your companies" title="Watchlist">
      <p>
        Every company you saved, with its health, the largest change in its latest annual
        figures, and anything in its scores worth a closer look. Each figure comes from the
        company&apos;s own filings.
      </p>
    </PageHeader>
  );

  if (!signedIn) {
    return (
      <div className="space-y-5">
        {header}
        <Card className="p-5">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-strong">
            Sign in to see health, changes and alerts for each company you save, and to sort
            them into groups. Companies already saved in this browser move to your account
            when you sign in.
          </p>
          <Link
            href="/signin?next=/watchlist"
            className="mt-3 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            Sign in
          </Link>
        </Card>
        <WatchlistPanel />
      </div>
    );
  }

  const saved = await listWatchlist();
  const rows = await loadWatchlist(saved);
  const groups = groupsInUse(saved.map((entry) => entry.groupName));

  const sortParam = get("sort");
  const sort: WatchlistSort =
    sortParam && sortParam in WATCHLIST_SORTS ? (sortParam as WatchlistSort) : "added";
  const groupParam = get("group") ?? "";
  const group = groupParam === UNGROUPED || groups.includes(groupParam) ? groupParam : "";

  const visible = sortWatchlist(filterByGroup(rows, group || null), sort);
  const summary = watchlistSummary(rows);

  const href = (next: { sort?: WatchlistSort; group?: string }) => {
    const query = new URLSearchParams();
    const nextSort = next.sort ?? sort;
    const nextGroup = next.group ?? group;
    if (nextSort !== "added") query.set("sort", nextSort);
    if (nextGroup) query.set("group", nextGroup);
    const qs = query.toString();
    return qs ? `/watchlist?${qs}` : "/watchlist";
  };

  return (
    <div className="space-y-5">
      {header}
      <WatchlistSync signedIn />

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing saved yet"
            description="Save a company from its page and it appears here with its health, the changes in its figures and any alerts."
            action={
              <Link
                href="/screen"
                className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
              >
                Find companies in the screener
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <SummaryTile label="Saved" value={summary.total} />
            <SummaryTile label="With an alert" value={summary.withAlerts} />
            <SummaryTile label="Health lower than a year earlier" value={summary.healthDown} />
            <SummaryTile label="Health higher than a year earlier" value={summary.healthUp} />
          </div>

          <Card>
            <div className="flex flex-col gap-2.5 border-b border-border px-5 py-3">
              {groups.length > 0 && (
                <nav aria-label="Filter by group" className="flex flex-wrap items-center gap-1.5">
                  <span className="mr-1 text-xs text-muted">Group</span>
                  <Chip href={href({ group: "" })} active={!group}>
                    All ({rows.length})
                  </Chip>
                  {groups.map((name) => (
                    <Chip key={name} href={href({ group: name })} active={group === name}>
                      {name} ({rows.filter((row) => row.groupName === name).length})
                    </Chip>
                  ))}
                  {rows.some((row) => !row.groupName) && (
                    <Chip href={href({ group: UNGROUPED })} active={group === UNGROUPED}>
                      No group
                    </Chip>
                  )}
                </nav>
              )}
              <nav aria-label="Sort" className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 text-xs text-muted">Sort</span>
                {(Object.keys(WATCHLIST_SORTS) as WatchlistSort[]).map((key) => (
                  <Chip key={key} href={href({ sort: key })} active={sort === key}>
                    {WATCHLIST_SORTS[key]}
                  </Chip>
                ))}
              </nav>
            </div>
            <WatchlistTable rows={visible} groups={groups} />
          </Card>

          <p className="max-w-3xl text-xs leading-relaxed text-muted">
            Health change compares this year&apos;s score with last year&apos;s, both computed
            from the stored annual filings and without the share price, so the two are measured
            the same way. Alerts come from the Beneish and Altman models where they apply, and
            from a fall in health of a point or more. None of them is a verdict on the company.
            Companies outside the scored universe are listed without figures; their own pages
            still analyse them live.
          </p>
        </>
      )}
    </div>
  );
}

function WatchlistTable({ rows, groups }: { rows: WatchlistRow[]; groups: string[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        title="No companies in this group"
        description="Choose another group, or file a company under this one from its row."
      />
    );
  }

  return (
    <div className="scroll-x">
      <table className="w-full min-w-[66rem] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
            <th scope="col" className="px-5 py-2.5 font-medium">Company</th>
            <th scope="col" className="px-3 py-2 font-medium">Health</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">F-Score</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Growth</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">Margin</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">P/E</th>
            <th scope="col" className="px-3 py-2 font-medium">Largest change</th>
            <th scope="col" className="px-3 py-2 font-medium">Latest annual filing</th>
            <th scope="col" className="px-3 py-2 font-medium">Group</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((row) => (
            <tr key={row.symbol} className="align-top transition-colors hover:bg-surface-2">
              <td className="px-5 py-3">
                <Link
                  href={`/stock/${encodeURIComponent(row.symbol)}`}
                  className="block transition-colors hover:text-accent"
                >
                  <span className="text-[0.9375rem] font-bold tracking-tight">{row.symbol}</span>
                  {row.country === "CA" && <span className="ml-1.5 text-[10px] text-muted">CA</span>}
                  {row.name && (
                    <span className="block max-w-[14rem] truncate text-xs text-muted">{row.name}</span>
                  )}
                </Link>
                {row.alerts.length > 0 && (
                  <ul className="mt-1.5 flex flex-wrap gap-1" aria-label={`Alerts for ${row.symbol}`}>
                    {row.alerts.map((alert) => (
                      <li key={alert.kind}>
                        <Badge tone="poor" title={alert.detail}>
                          {alert.label}
                        </Badge>
                        <span className="sr-only"> — {alert.detail}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </td>

              <td className="px-3 py-3">
                {row.covered ? (
                  <div className="flex flex-col items-start gap-1">
                    <RatingBadge
                      rating={healthRating(row.healthScore)}
                      label={row.healthScore != null ? `${row.healthScore.toFixed(1)}/10` : "no data"}
                    />
                    {row.healthChange && (
                      <span
                        className={cn(
                          "tnum text-xs",
                          row.healthChange.points < 0
                            ? "text-down"
                            : row.healthChange.points > 0
                              ? "text-up"
                              : "text-muted",
                        )}
                      >
                        {signedPoints(row.healthChange.points)} vs FY{row.healthChange.comparedWith}
                      </span>
                    )}
                  </div>
                ) : (
                  <span className="text-xs text-faint">Not scored</span>
                )}
              </td>

              <td className="tnum px-3 py-3 text-right">
                {row.fScore != null ? `${row.fScore}/${row.fScoreMax ?? 9}` : <NotReported />}
              </td>
              <td className="tnum px-3 py-3 text-right">{percent(row.revenueGrowth)}</td>
              <td className="tnum px-3 py-3 text-right">{percent(row.netMargin)}</td>
              <td className="tnum px-3 py-3 text-right">{multiple(row.peRatio)}</td>

              <td className="px-3 py-3 text-xs">
                {row.topChange ? (
                  <>
                    <span
                      className={cn(
                        "font-medium",
                        row.topChange.direction === "worse" && "text-down",
                        row.topChange.direction === "better" && "text-up",
                      )}
                    >
                      {row.topChange.label} {row.topChange.delta}
                    </span>
                    <span className="block text-faint">
                      FY{row.topChange.fromYear} → FY{row.topChange.toYear} ·{" "}
                      {SEVERITY_LABEL[row.topChange.severity]}
                    </span>
                  </>
                ) : (
                  <span className="text-faint">{row.covered ? "No large moves" : "—"}</span>
                )}
              </td>

              <td className="px-3 py-3 text-xs">
                {row.lastFiling ? (
                  <>
                    {row.lastFiling.url ? (
                      <a
                        href={row.lastFiling.url}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="font-medium text-accent hover:underline"
                      >
                        {row.lastFiling.form} FY{row.lastFiling.fiscalYear}
                      </a>
                    ) : (
                      <span className="font-medium">
                        {row.lastFiling.form} FY{row.lastFiling.fiscalYear}
                      </span>
                    )}
                    {row.lastFiling.filedAt && (
                      <span className="block text-faint">
                        Filed {calendarDate(row.lastFiling.filedAt) ?? row.lastFiling.filedAt}
                      </span>
                    )}
                  </>
                ) : (
                  <span className="text-faint">—</span>
                )}
                {row.scoredAt && (
                  <span className="block text-faint">
                    Scored <LocalTime value={row.scoredAt.toISOString()} mode="relative" />
                  </span>
                )}
              </td>

              <td className="px-3 py-3">
                <GroupPicker symbol={row.symbol} group={row.groupName} groups={groups} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SummaryTile({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="tnum mt-1 text-2xl font-semibold tracking-tight">{value}</p>
    </Card>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: ReactNode }) {
  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={cn(
        "rounded-full border px-2.5 py-1 text-xs font-medium transition-colors",
        active
          ? "border-accent bg-accent-soft text-accent"
          : "border-border text-muted-strong hover:border-accent hover:text-accent",
      )}
    >
      {children}
    </Link>
  );
}

function signedPoints(points: number): string {
  const sign = points > 0 ? "+" : points < 0 ? "−" : "±";
  return `${sign}${Math.abs(points).toFixed(1)}`;
}
