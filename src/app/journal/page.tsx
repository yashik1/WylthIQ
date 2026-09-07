import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { Paywall } from "@/components/billing/paywall";
import { NewEntryForm, DeleteEntryButton } from "@/components/journal/journal-form";
import { ImportTrades } from "@/components/journal/import-trades";
import {
  CloseTradeForm,
  DeleteTradeButton,
  NewPlaybookForm,
  NewTradeForm,
} from "@/components/journal/trade-form";
import {
  AdherencePanel,
  Breakdown,
  EquityCurve,
  ResultBadge,
  StatsHeadline,
} from "@/components/journal/trade-stats";
import { LocalTime } from "@/components/local-time";
import { getEntitlement, hasAccess } from "@/lib/billing/entitlement";
import { listEntries } from "@/lib/journal/actions";
import { listPlaybooks, listTrades, toTrade } from "@/lib/journal/trade-actions";
import {
  adherence,
  byPlaybook,
  bySymbol,
  equityCurve,
  isClosed,
  plannedR,
  realisedPnl,
  realisedR,
  summarise,
  type Trade,
} from "@/lib/journal/trade-math";
import { money, num } from "@/lib/format";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trade journal",
  description: "Your own record of what you traded, why, and how it went.",
  // Somebody's private notes and positions should never be indexed.
  robots: { index: false, follow: false },
};

const KIND_LABEL: Record<string, string> = {
  note: "Note",
  buy: "Bought",
  sell: "Sold",
  watch: "Watching",
};

export default async function JournalPage() {
  const entitlement = await getEntitlement();
  const allowed = hasAccess(entitlement);

  // Each of these re-checks entitlement itself and returns nothing without it,
  // so this cannot expose anything even if the branch below were wrong.
  const [entries, tradeRows, playbooks] = allowed
    ? await Promise.all([listEntries(), listTrades(), listPlaybooks()])
    : [[], [], []];

  const trades: Trade[] = await Promise.all(tradeRows.map(toTrade));
  const stats = summarise(trades);
  const names = new Map(playbooks.map((p) => [p.id, p.name]));

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <PageHeader eyebrow="Your record" title="Trade journal">
        <p>
          What you traded, why you thought it was a good idea, and what it actually
          did. Every figure here is computed from prices you enter yourself — nothing
          on this page is fetched from a market data provider.
        </p>
      </PageHeader>

      {!allowed ? (
        <Paywall
          entitlement={entitlement}
          feature="Trade journal"
          description="Record your trades, see your win rate, profit factor and expectancy, and find out whether following your own rules actually pays."
          returnTo="/journal"
        />
      ) : (
        <>
          <StatsHeadline stats={stats} />

          <EquityCurve points={equityCurve(trades)} />

          <AdherencePanel adherence={adherence(trades)} />

          <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
            <Breakdown
              title="By strategy"
              subtitle="Which of your setups is carrying the account"
              groups={byPlaybook(trades, names)}
              emptyLabel="Attribute trades to a strategy below and they will be compared here."
            />
            <Breakdown
              title="By symbol"
              subtitle="Where the money actually came from"
              groups={bySymbol(trades)}
              emptyLabel="Nothing logged yet."
            />
          </div>

          <Card>
            <CardHeader
              title="Import from a file"
              subtitle="A broker export or your own spreadsheet — CSV, TSV or .xlsx"
            />
            <ImportTrades />
          </Card>

          <Card>
            <CardHeader
              title="Log a trade"
              subtitle="Four fields to start. The rest sharpens the analysis."
            />
            <NewTradeForm playbooks={playbooks} />
          </Card>

          <TradeLog trades={trades} names={names} />

          <Card>
            <CardHeader
              title="Your strategies"
              subtitle="A setup with its rules written down, so 'did I follow it' has an answer"
            />
            {playbooks.length > 0 && (
              <ul className="divide-y divide-border border-b border-border">
                {playbooks.map((p) => (
                  <li key={p.id} className="px-5 py-3.5">
                    <p className="text-[0.9375rem] font-semibold">{p.name}</p>
                    {p.description && (
                      <p className="mt-0.5 text-sm text-muted">{p.description}</p>
                    )}
                    {p.rules && (
                      <ul className="mt-2 space-y-1">
                        {p.rules
                          .split("\n")
                          .map((r) => r.trim())
                          .filter(Boolean)
                          .map((rule, i) => (
                            <li key={i} className="flex gap-2 text-xs leading-relaxed text-muted">
                              <span aria-hidden className="text-faint">·</span>
                              {rule}
                            </li>
                          ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <NewPlaybookForm />
          </Card>

          {/*
            The original notes journal, kept as it was.

            It records what somebody was thinking, which is the part a price
            history can never reconstruct — and plenty of entries worth writing
            are not about a trade at all.
          */}
          <Card>
            <CardHeader
              title="Notes"
              subtitle="Thinking that is not tied to a position. Only you can see this."
            />
            <NewEntryForm />
            {entries.length > 0 && (
              <ul className="divide-y divide-border border-t border-border">
                {entries.map((entry) => (
                  <li key={entry.id} className="px-5 py-4">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="text-[0.9375rem] font-semibold">{entry.title}</span>
                      {entry.symbol && (
                        <Link
                          href={`/stock/${encodeURIComponent(entry.symbol)}`}
                          className="text-xs font-bold tracking-tight text-accent hover:underline"
                        >
                          {entry.symbol}
                        </Link>
                      )}
                      <Badge>{KIND_LABEL[entry.kind] ?? entry.kind}</Badge>
                      {entry.conviction != null && (
                        <span className="text-xs text-muted">
                          conviction {entry.conviction}/5
                        </span>
                      )}
                      <span className="ml-auto text-xs text-faint">
                        <LocalTime value={`${entry.entryDate}T00:00:00Z`} mode="date" />
                      </span>
                    </div>

                    {entry.body && (
                      <p className="mt-2 max-w-2xl whitespace-pre-wrap text-sm leading-relaxed text-muted-strong">
                        {entry.body}
                      </p>
                    )}

                    <div className="mt-2">
                      <DeleteEntryButton id={entry.id} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  );
}

/**
 * Every position, open ones first.
 *
 * A table because these are the same eight facts about each trade, and the
 * useful reading is straight down a column — which of these lost money, which
 * hit its stop, which were taken without one.
 */
function TradeLog({ trades, names }: { trades: Trade[]; names: Map<number, string> }) {
  if (trades.length === 0) {
    return (
      <Card>
        <CardHeader title="Your trades" subtitle="Nothing logged yet" />
        <EmptyState
          title="No trades yet"
          description="Log one above. The ones worth recording are the ones you might otherwise remember wrongly — and it is easier while the position is still open."
        />
      </Card>
    );
  }

  // Open positions lead: those are the ones with a decision still attached.
  const ordered = [...trades].sort((a, b) => {
    const openA = isClosed(a) ? 1 : 0;
    const openB = isClosed(b) ? 1 : 0;
    return openA - openB || b.openedAt.localeCompare(a.openedAt) || b.id - a.id;
  });

  return (
    <Card>
      <CardHeader
        title="Your trades"
        subtitle={`${trades.length} logged, oldest at the bottom`}
      />
      <div className="scroll-x">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
              <th scope="col" className="px-5 py-2.5 font-medium">Trade</th>
              <th scope="col" className="px-3 py-2 font-medium">Strategy</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Entry</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">Exit</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">R</th>
              <th scope="col" className="px-3 py-2 text-right font-medium">P&amp;L</th>
              <th scope="col" className="px-3 py-2 font-medium">Rules</th>
              <th scope="col" className="px-3 py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {ordered.map((t) => {
              const pnl = realisedPnl(t);
              const r = realisedR(t);
              const planned = plannedR(t);
              return (
                <tr key={t.id} className="align-top transition-colors hover:bg-surface-2">
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/stock/${encodeURIComponent(t.symbol)}`}
                        className="text-[0.9375rem] font-bold tracking-tight hover:text-accent"
                      >
                        {t.symbol}
                      </Link>
                      <Badge tone={t.side === "short" ? "poor" : "accent"}>
                        {t.side === "short" ? "Short" : "Long"}
                      </Badge>
                      <ResultBadge pnl={pnl} />
                    </div>
                    <p className="tnum mt-0.5 text-xs text-faint">
                      {num(t.quantity, 0)} @ {t.openedAt}
                      {t.closedAt && ` → ${t.closedAt}`}
                    </p>
                    {t.notes && (
                      <p className="mt-1 max-w-md text-xs leading-relaxed text-muted">
                        {t.notes}
                      </p>
                    )}
                  </td>
                  <td className="px-3 py-3 text-xs text-muted">
                    {t.playbookId != null ? (names.get(t.playbookId) ?? "Retired strategy") : "—"}
                  </td>
                  <td className="tnum px-3 py-3 text-right">
                    {money(t.entryPrice, "USD")}
                    {t.stopPrice != null && (
                      <span className="block text-xs text-faint">
                        stop {money(t.stopPrice, "USD")}
                      </span>
                    )}
                  </td>
                  <td className="tnum px-3 py-3 text-right">
                    {t.exitPrice != null ? money(t.exitPrice, "USD") : <span className="text-faint">open</span>}
                    {t.targetPrice != null && (
                      <span className="block text-xs text-faint">
                        target {money(t.targetPrice, "USD")}
                      </span>
                    )}
                  </td>
                  <td className="tnum px-3 py-3 text-right">
                    {r != null ? (
                      <span className={cn(r >= 0 ? "text-up" : "text-down")}>
                        {r >= 0 ? "+" : "−"}
                        {num(Math.abs(r), 2)}R
                      </span>
                    ) : (
                      <span className="text-faint" title="No stop was set, so this trade has no defined risk to measure against.">
                        —
                      </span>
                    )}
                    {planned != null && (
                      <span className="block text-xs text-faint">
                        planned {num(planned, 1)}R
                      </span>
                    )}
                  </td>
                  <td
                    className={cn(
                      "tnum px-3 py-3 text-right font-medium",
                      pnl == null ? "" : pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "",
                    )}
                  >
                    {pnl == null
                      ? "—"
                      : `${pnl > 0 ? "+" : pnl < 0 ? "−" : ""}${money(Math.abs(pnl), "USD")}`}
                  </td>
                  <td className="px-3 py-3 text-xs">
                    {t.followedRules === true && <span className="text-up">Kept</span>}
                    {t.followedRules === false && <span className="text-down">Broke</span>}
                    {t.followedRules == null && <span className="text-faint">—</span>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex flex-col items-start gap-2">
                      {!isClosed(t) && <CloseTradeForm id={t.id} />}
                      <DeleteTradeButton id={t.id} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
