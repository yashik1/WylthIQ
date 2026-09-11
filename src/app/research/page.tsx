import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ContinueResearching } from "@/components/research/continue-researching";
import { LocalTime } from "@/components/local-time";
import { Badge, Card, CardHeader, PageHeader, RatingBadge } from "@/components/ui";
import { WatchlistSync } from "@/components/watchlist";
import { getEntitlement, hasAccess } from "@/lib/billing/entitlement";
import { calendarDate } from "@/lib/format";
import { listEntries } from "@/lib/journal/actions";
import { newFilingsFor, type NewFiling } from "@/lib/research/new-filings";
import { listSavedScreens } from "@/lib/saved-screens";
import { describeFilters } from "@/lib/screen-summary";
import { listWatchlist, type SavedCompany } from "@/lib/watchlist/actions";
import { healthRating, loadWatchlist, sortWatchlist } from "@/lib/watchlist/dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Research",
  description:
    "Pick up where you left off: companies you opened and saved, what changed, what they filed, and your notes.",
  robots: { index: false, follow: false },
};

const FILING_TONE: Record<NewFiling["severity"], "neutral" | "fair" | "poor"> = {
  routine: "neutral",
  notable: "fair",
  "red-flag": "poor",
};

const linkClass = "text-xs text-accent underline underline-offset-2";

/**
 * One place to pick research back up.
 *
 * Built entirely from things the app already holds for this reader — the
 * saved list, its scores, saved screens, journal notes, and the filings the
 * company pages already list. The one slow part, checking EDGAR for recent
 * filings, streams in behind a fallback so it never holds up the rest.
 */
export default async function ResearchPage() {
  const entitlement = await getEntitlement();

  const header = (
    <PageHeader eyebrow="Your workspace" title="Research">
      <p>
        Where you left off: the companies you opened and saved, what changed in their figures,
        what they filed lately, your saved screens and your notes. Nothing here is a
        recommendation. It is a place to pick the reading back up.
      </p>
    </PageHeader>
  );

  if (!entitlement.userId) {
    return (
      <div className="w-full space-y-5">
        {header}
        <Card className="p-5">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-strong">
            Sign in to bring your saved companies, their changes and new filings, your saved
            screens and your notes together here.
          </p>
          <Link
            href="/signin?next=/research"
            className="mt-3 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            Sign in
          </Link>
        </Card>
        <Card>
          <CardHeader title="Continue researching" subtitle="Companies opened in this browser" />
          <ContinueResearching />
        </Card>
      </div>
    );
  }

  const [saved, screens, notes] = await Promise.all([
    listWatchlist(),
    listSavedScreens(),
    hasAccess(entitlement) ? listEntries() : Promise.resolve([] as Awaited<ReturnType<typeof listEntries>>),
  ]);
  const rows = await loadWatchlist(saved);
  const changed = sortWatchlist(
    rows.filter((row) => row.alerts.length > 0 || row.topChange),
    "alerts",
  ).slice(0, 8);

  return (
    <div className="w-full space-y-5">
      {header}
      <WatchlistSync signedIn />

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Continue researching"
            subtitle="Companies opened in this browser, most recent first"
          />
          <ContinueResearching />
        </Card>

        <Card>
          <CardHeader
            title="Saved companies"
            subtitle={
              rows.length > 0
                ? `${rows.length} on your account`
                : "Saved from a company page, kept on your account"
            }
            action={
              <Link href="/watchlist" className={linkClass}>
                Watchlist
              </Link>
            }
          />
          {rows.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">
              Save a company from its page and it appears here.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {rows.slice(0, 8).map((row) => (
                <li key={row.symbol}>
                  <Link
                    href={`/stock/${encodeURIComponent(row.symbol)}`}
                    className="flex items-center justify-between gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="flex min-w-0 items-baseline gap-2">
                      <span className="text-sm font-bold tracking-tight">{row.symbol}</span>
                      {row.name && <span className="truncate text-xs text-muted">{row.name}</span>}
                    </span>
                    {row.healthScore != null ? (
                      <RatingBadge
                        rating={healthRating(row.healthScore)}
                        label={`${row.healthScore.toFixed(1)}/10`}
                      />
                    ) : (
                      <span className="shrink-0 text-xs text-faint">
                        {row.covered ? "no data" : "not scored"}
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Changes in your saved companies"
          subtitle="Alerts from their scores, and the largest move in each one's latest annual figures"
        />
        {changed.length === 0 ? (
          <p className="px-5 py-4 text-sm text-muted">
            {rows.length === 0
              ? "Nothing saved yet."
              : "No alerts, and no large moves in the latest annual figures of the companies you saved."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {changed.map((row) => (
              <li key={row.symbol} className="px-5 py-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <Link
                    href={`/stock/${encodeURIComponent(row.symbol)}`}
                    className="text-sm font-bold tracking-tight hover:text-accent"
                  >
                    {row.symbol}
                  </Link>
                  {row.name && <span className="text-xs text-muted">{row.name}</span>}
                  {row.alerts.map((alert) => (
                    <Badge key={alert.kind} tone="poor">
                      {alert.label}
                    </Badge>
                  ))}
                </div>
                {row.topChange && (
                  <p className="mt-1 text-sm text-muted-strong">
                    {row.topChange.label} {row.topChange.delta}{" "}
                    <span className="text-faint">
                      ({row.topChange.from} → {row.topChange.to}, FY{row.topChange.fromYear} to FY
                      {row.topChange.toYear})
                    </span>
                  </p>
                )}
                {row.alerts.length > 0 && (
                  <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted">
                    {row.alerts.map((alert) => alert.detail).join(" ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Suspense
        fallback={
          <Card>
            <CardHeader title="New filings" subtitle="Checking SEC EDGAR for your saved companies…" />
            <p className="px-5 py-4 text-sm text-muted">Loading recent filings.</p>
          </Card>
        }
      >
        <NewFilings companies={saved} />
      </Suspense>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Saved screens"
            subtitle="Open one to run it against the latest scores"
            action={
              <Link href="/screen" className={linkClass}>
                Screener
              </Link>
            }
          />
          {screens.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">
              Screens you save in the screener appear here.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {screens.slice(0, 6).map((screen) => (
                <li key={screen.id}>
                  <Link
                    href={`/screen?saved=${screen.id}`}
                    className="block px-5 py-2.5 transition-colors hover:bg-surface-2"
                  >
                    <span className="text-sm font-semibold">{screen.name}</span>
                    <span className="block text-xs text-muted">{describeFilters(screen.filters)}</span>
                    {screen.lastRunAt && (
                      <span className="block text-xs text-faint">
                        Last opened{" "}
                        <LocalTime value={screen.lastRunAt.toISOString()} mode="relative" />
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Research notes"
            subtitle="From your journal. Only you can see these."
            action={
              <Link href="/journal" className={linkClass}>
                Journal
              </Link>
            }
          />
          {notes.length === 0 ? (
            <p className="px-5 py-4 text-sm text-muted">
              Notes you write in the journal appear here, with the company each one is about.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {notes.slice(0, 6).map((note) => (
                <li key={note.id} className="px-5 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold">{note.title}</span>
                    {note.symbol && (
                      <Link
                        href={`/stock/${encodeURIComponent(note.symbol)}`}
                        className="text-xs font-bold tracking-tight text-accent hover:underline"
                      >
                        {note.symbol}
                      </Link>
                    )}
                    <span className="ml-auto text-xs text-faint">
                      <LocalTime value={`${note.entryDate}T00:00:00Z`} mode="date" />
                    </span>
                  </div>
                  {note.body && (
                    <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted">{note.body}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

/** Recent filings across the saved list, streamed in once EDGAR has answered. */
async function NewFilings({ companies }: { companies: SavedCompany[] }) {
  if (companies.length === 0) {
    return (
      <Card>
        <CardHeader title="New filings" subtitle="What your saved companies filed with the SEC lately" />
        <p className="px-5 py-4 text-sm text-muted">Save companies to see what they file.</p>
      </Card>
    );
  }

  const { items, covered, total, days } = await newFilingsFor(
    companies.map((company) => ({ symbol: company.symbol, name: company.name })),
  );

  const coverage =
    covered < total ? ` · the ${covered} most recently saved of your ${total} companies` : "";

  return (
    <Card>
      <CardHeader
        title="New filings"
        subtitle={`Filed with the SEC in the last ${days} days${coverage}. Companies that file elsewhere, such as on SEDAR+, do not appear.`}
      />
      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">
          None of these companies filed with the SEC in the last {days} days.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {items.slice(0, 20).map((item, i) => (
            <li
              key={`${item.symbol}-${item.form}-${item.filedAt}-${i}`}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-5 py-2.5"
            >
              <time dateTime={item.filedAt} className="tnum w-24 shrink-0 text-xs text-muted">
                {calendarDate(item.filedAt) ?? item.filedAt}
              </time>
              <Link
                href={`/stock/${encodeURIComponent(item.symbol)}`}
                className="text-sm font-bold tracking-tight hover:text-accent"
              >
                {item.symbol}
              </Link>
              <Badge tone={FILING_TONE[item.severity]}>{item.label}</Badge>
              <span className="min-w-0 flex-1 text-sm text-muted-strong">{item.title}</span>
              <a
                href={item.url}
                target="_blank"
                rel="noreferrer noopener"
                className="text-xs text-accent hover:underline"
              >
                {item.form}
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
