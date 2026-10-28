import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader, RatingBadge } from "@/components/ui";
import { getEntitlement } from "@/lib/billing/entitlement";
import { listWatchlist } from "@/lib/watchlist/actions";
import { healthRating, loadWatchlist, sortWatchlist, type WatchlistRow } from "@/lib/watchlist/dashboard";
import { listTheses } from "@/lib/thesis/actions";
import { buildThesisReality, type ConditionStatus, CONDITION_STATUS_LABEL } from "@/lib/thesis/reality";
import { getFundamentalsWithSource } from "@/lib/providers";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Alerts",
  description: "One compact view of material changes across your watchlist, portfolio research and theses.",
  robots: { index: false, follow: false },
};

type AlertItem = {
  symbol: string;
  kind: "accounting" | "distress" | "health" | "change" | "thesis";
  label: string;
  detail: string;
  href: string;
};

const kindTone: Record<AlertItem["kind"], "poor" | "fair" | "accent"> = {
  accounting: "poor",
  distress: "poor",
  health: "fair",
  change: "fair",
  thesis: "accent",
};

const kindLabel: Record<AlertItem["kind"], string> = {
  accounting: "Accounting",
  distress: "Distress",
  health: "Health",
  change: "What changed",
  thesis: "Thesis",
};

export default async function AlertsPage() {
  const entitlement = await getEntitlement();

  if (!entitlement.userId) {
    return (
      <div className="space-y-5">
        <PageHeader eyebrow="Monitoring" title="Alerts">
          <p>One place to see material changes in the companies you are researching.</p>
        </PageHeader>
        <Card className="p-5">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-strong">
            Sign in to turn your saved companies and theses into a compact review queue.
          </p>
          <Link href="/signin?next=/alerts" className="mt-3 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg">
            Sign in
          </Link>
        </Card>
      </div>
    );
  }

  const saved = await listWatchlist();
  const rows = await loadWatchlist(saved);
  const items: AlertItem[] = [];

  for (const row of rows) {
    for (const alert of row.alerts) {
      const kind = alert.kind === "health-drop" ? "health" : alert.kind;
      items.push({
        symbol: row.symbol,
        kind,
        label: alert.label,
        detail: alert.detail,
        href: `/stock/${encodeURIComponent(row.symbol)}#what-changed`,
      });
    }
    if (row.topChange) {
      items.push({
        symbol: row.symbol,
        kind: "change",
        label: row.topChange.label,
        detail: `${row.topChange.delta} (${row.topChange.from} → ${row.topChange.to}), FY${row.topChange.fromYear} to FY${row.topChange.toYear}.`,
        href: `/stock/${encodeURIComponent(row.symbol)}#what-changed`,
      });
    }
  }

  const theses = await listTheses();
  const thesisItems = [];
  for (const thesis of theses.slice(0, 12)) {
    const { fundamentals } = await getFundamentalsWithSource(thesis.symbol).catch(() => ({ fundamentals: null }));
    const reality = buildThesisReality(thesis.conditions, thesis.createdAt, fundamentals);
    const failed = reality.results.filter((result) => result.status === "below" || result.status === "no-data");
    if (failed.length > 0 || thesis.status === "at-risk" || thesis.status === "invalidated") {
      const statuses = failed.map((result) => CONDITION_STATUS_LABEL[result.status as ConditionStatus].toLowerCase());
      thesisItems.push({
        symbol: thesis.symbol,
        kind: "thesis" as const,
        label: thesis.status === "invalidated" ? "Thesis invalidated" : thesis.status === "at-risk" ? "Thesis at risk" : "Thesis condition changed",
        detail: statuses.length ? `${failed.length} condition${failed.length === 1 ? "" : "s"} need review: ${statuses.join(", ")}.` : "Your thesis status says it needs review.",
        href: `/stock/${encodeURIComponent(thesis.symbol)}#thesis`,
      });
    }
  }

  const feed = [...items, ...thesisItems];
  const byKind = new Map<string, number>();
  for (const item of feed) byKind.set(item.kind, (byKind.get(item.kind) ?? 0) + 1);
  const changedCompanies = new Set(feed.map((item) => item.symbol)).size;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Monitoring" title="Alerts">
        <p>
          Material changes from the same filing-derived scores and thesis checks used elsewhere in WylthIQ.
          Review the queue, then open the company or thesis to investigate.
        </p>
      </PageHeader>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-3">
        <SummaryCard label="Needs review" value={feed.length} />
        <SummaryCard label="Companies" value={changedCompanies} />
        <SummaryCard label="Health / distress" value={(byKind.get("health") ?? 0) + (byKind.get("distress") ?? 0)} />
        <SummaryCard label="Thesis" value={byKind.get("thesis") ?? 0} />
      </div>

      {feed.length === 0 ? (
        <Card>
          <EmptyState
            title={saved.length === 0 ? "Nothing to monitor yet" : "Nothing needs your attention"}
            description={
              saved.length === 0
                ? "Save companies from a stock page or the screener, and write a thesis when you have a view. This queue only fills from what you choose to follow."
                : "Your saved companies and theses have no current review flags. That is ordinary — most weeks nothing material changes."
            }
            action={
              <Link
                href={saved.length === 0 ? "/screen" : "/research"}
                className="text-sm font-medium text-accent underline underline-offset-2"
              >
                {saved.length === 0 ? "Find companies to follow" : "Open research"}
              </Link>
            }
          />
        </Card>
      ) : (
        <Card>
          <CardHeader title="Review queue" subtitle={`${feed.length} item${feed.length === 1 ? "" : "s"} across your research`} />
          <ul className="divide-y divide-border">
            {feed.slice(0, 40).map((item, index) => (
              <li key={`${item.symbol}-${item.kind}-${index}`} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={item.href} className="text-sm font-bold tracking-tight hover:text-accent">{item.symbol}</Link>
                  <Badge tone={kindTone[item.kind]}>{kindLabel[item.kind]}</Badge>
                  <span className="text-sm font-semibold">{item.label}</span>
                </div>
                <p className="mt-1 max-w-4xl text-xs leading-relaxed text-muted">{item.detail}</p>
              </li>
            ))}
          </ul>
          {feed.length > 40 && <p className="border-t border-border px-4 py-2.5 text-xs text-faint">Showing the first 40 review items.</p>}
        </Card>
      )}

      <Card>
        <CardHeader title="Watchlist pulse" subtitle="The companies with the biggest review load" />
        <ul className="divide-y divide-border">
          {sortWatchlist(rows, "alerts").slice(0, 8).map((row) => (
            <li key={row.symbol} className="flex items-center gap-3 px-4 py-2.5">
              <Link href={`/stock/${encodeURIComponent(row.symbol)}`} className="min-w-16 text-sm font-bold hover:text-accent">{row.symbol}</Link>
              {row.healthScore != null && <RatingBadge rating={healthRating(row.healthScore)} label={`${row.healthScore.toFixed(1)}/10`} />}
              <span className="ml-auto text-xs text-muted">{row.alerts.length} alert{row.alerts.length === 1 ? "" : "s"}{row.topChange ? " · 1 material change" : ""}</span>
            </li>
          ))}
          {rows.length === 0 && <li className="px-4 py-3 text-sm text-muted">No saved companies yet.</li>}
        </ul>
      </Card>
    </div>
  );
}

function SummaryCard({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-3.5">
      <p className="text-xs text-muted">{label}</p>
      <p className="tnum mt-0.5 text-2xl font-semibold tracking-tight">{value}</p>
    </Card>
  );
}
