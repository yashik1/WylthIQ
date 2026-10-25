import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui";
import { Paywall } from "@/components/billing/paywall";
import { TradeChart } from "@/components/journal/trade-chart";
import { TradeScreenshots } from "@/components/journal/trade-screenshots";
import { ResultBadge } from "@/components/journal/trade-stats";
import { LocalTime } from "@/components/local-time";
import { getEntitlement, hasAccess } from "@/lib/billing/entitlement";
import { syncedTradeBadges } from "@/lib/brokers/queries";
import { manualFills, readFills, type TradeFill } from "@/lib/journal/fills";
import { toTrade } from "@/lib/journal/trade-actions";
import { averagePrice, timeframeLabel } from "@/lib/journal/trade-chart";
import { plannedR, realisedPnl, realisedR, type Trade } from "@/lib/journal/trade-math";
import { loadTradePage } from "@/lib/journal/trade-page";
import { money, num } from "@/lib/format";
import type { Bar } from "@/lib/providers/types";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Trade",
  // Somebody's own trades are never indexed.
  robots: { index: false, follow: false },
};

/** A trade's fills as stored, or for a trade from before they were kept, its entry and exit by date. */
function fillsOf(row: { fills: unknown }, trade: Trade): TradeFill[] {
  const stored = readFills(row.fills);
  if (stored.length > 0) return stored;
  return manualFills({
    side: trade.side,
    quantity: trade.quantity,
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    openedAt: trade.openedAt,
    closedAt: trade.closedAt,
    openedTime: null,
    closedTime: null,
    zone: null,
  });
}

function signed(value: number, format: (n: number) => string): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${format(Math.abs(value))}`;
}

export default async function TradePage({ params }: PageProps<"/journal/trades/[id]">) {
  const { id } = await params;
  const tradeId = Number(id);
  if (!Number.isInteger(tradeId) || tradeId <= 0) notFound();

  const entitlement = await getEntitlement();
  if (!hasAccess(entitlement) || !entitlement.userId) {
    return (
      <div className="w-full space-y-5">
        <PageHeader eyebrow="Your record" title="Trade" />
        <Paywall
          entitlement={entitlement}
          feature="Trade journal"
          description="Record your trades and see each one drawn on the chart it happened on."
          returnTo={`/journal/trades/${tradeId}`}
        />
      </div>
    );
  }

  const [data, synced] = await Promise.all([
    loadTradePage(tradeId, entitlement.userId),
    syncedTradeBadges(entitlement.userId),
  ]);
  if (!data) notFound();

  const trade = await toTrade(data.trade);
  const fills = fillsOf(data.trade, trade);
  const pnl = realisedPnl(trade);
  const r = realisedR(trade);
  const planned = plannedR(trade);
  const bars = (data.chart?.bars ?? []) as Bar[];
  const entrySide = trade.side === "long" ? "buy" : "sell";
  const exitSide = trade.side === "long" ? "sell" : "buy";
  const badge = synced.get(trade.id);

  return (
    <div className="w-full space-y-5">
      <Link
        href="/journal"
        className="inline-flex items-center gap-1 pt-6 text-sm text-muted transition-colors hover:text-accent"
      >
        <ChevronLeft className="size-4" aria-hidden />
        Trade journal
      </Link>

      <PageHeader
        eyebrow="Trade"
        title={
          <span className="flex flex-wrap items-center gap-2">
            <Link href={`/stock/${encodeURIComponent(trade.symbol)}`} className="hover:text-accent">
              {trade.symbol}
            </Link>
            <Badge tone={trade.side === "short" ? "poor" : "accent"}>{trade.side === "short" ? "Short" : "Long"}</Badge>
            <ResultBadge pnl={pnl} />
            {badge && <Badge tone="neutral">{badge}</Badge>}
          </span>
        }
        aside={
          <dl className="grid grid-cols-2 gap-4 text-sm sm:justify-self-end">
            <div>
              <dt className="text-xs text-muted">P&amp;L</dt>
              <dd
                className={cn(
                  "tnum text-lg font-semibold",
                  pnl == null ? "text-faint" : pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "",
                )}
              >
                {pnl == null ? "Open" : signed(pnl, (n) => money(n, "USD"))}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">R</dt>
              <dd className={cn("tnum text-lg font-semibold", r == null ? "text-faint" : r >= 0 ? "text-up" : "text-down")}>
                {r == null ? "—" : `${signed(r, (n) => num(n, 2))}R`}
              </dd>
            </div>
          </dl>
        }
      >
        <p className="tnum">
          {num(trade.quantity, trade.quantity % 1 === 0 ? 0 : 4)} shares, opened {trade.openedAt}
          {trade.closedAt ? `, closed ${trade.closedAt}` : ", still open"}.
        </p>
      </PageHeader>

      <Card>
        <CardHeader
          title="Chart"
          subtitle={
            data.chart && bars.length > 0 ? (
              <>
                {timeframeLabel(data.chart.timeframe)}, captured{" "}
                <LocalTime value={data.chart.capturedAt.toISOString()} mode="relative" />
                {data.chart.source && <> from {data.chart.source}</>}
              </>
            ) : (
              "Drawn from the price history around the trade"
            )
          }
        />
        <div className="p-4 sm:p-5">
          {data.chart && bars.length > 0 ? (
            <>
              <TradeChart
                bars={bars}
                timeframe={data.chart.timeframe}
                fills={fills}
                levels={{
                  entry: averagePrice(fills, entrySide) ?? trade.entryPrice,
                  exit: averagePrice(fills, exitSide) ?? trade.exitPrice,
                  stop: trade.stopPrice,
                  target: trade.targetPrice,
                }}
              />
              <div className="mt-3 space-y-1 text-xs leading-relaxed text-faint">
                {!trade.closedAt && <p>While the trade is open, the chart is brought up to date every few hours.</p>}
                {data.chart.includesDividends && (
                  <p>
                    These daily prices are adjusted for dividends paid since, so the fills can sit a little off
                    the candles.
                  </p>
                )}
                <p>Prices are for your own record here, and are not shared.</p>
              </div>
            </>
          ) : (
            <EmptyState
              title={data.chartUnavailable ? "The chart could not be drawn just now" : "No chart for this trade"}
              description={
                data.chartUnavailable
                  ? "No price provider answered in time. It will be tried again shortly, so check back in a little while."
                  : `No price history was available for ${trade.symbol} around these dates, so there is nothing to draw it on.`
              }
            />
          )}
        </div>
      </Card>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Fills" subtitle={`${fills.length} ${fills.length === 1 ? "fill" : "fills"}, in order`} />
          <div className="scroll-x">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
                  <th scope="col" className="px-5 py-2 font-medium">When</th>
                  <th scope="col" className="px-3 py-2 font-medium">Side</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Shares</th>
                  <th scope="col" className="px-5 py-2 text-right font-medium">Price</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {fills.map((f, i) => (
                  <tr key={i}>
                    <td className="tnum px-5 py-2.5 whitespace-nowrap">
                      {f.at ? (
                        <LocalTime value={f.at} />
                      ) : (
                        <>
                          {f.date} <span className="text-xs text-faint">time not recorded</span>
                        </>
                      )}
                    </td>
                    <td className={cn("px-3 py-2.5 font-medium", f.side === "buy" ? "text-up" : "text-down")}>
                      {f.side === "buy" ? "Buy" : "Sell"}
                    </td>
                    <td className="tnum px-3 py-2.5 text-right">{num(f.shares, f.shares % 1 === 0 ? 0 : 4)}</td>
                    <td className="tnum px-5 py-2.5 text-right">{money(f.price, "USD")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Plan and result" />
          <dl className="grid grid-cols-2 gap-x-5 gap-y-3 p-5 text-sm">
            <Figure label="Entry" value={money(trade.entryPrice, "USD")} />
            <Figure label="Exit" value={trade.exitPrice != null ? money(trade.exitPrice, "USD") : "Open"} />
            <Figure label="Stop" value={trade.stopPrice != null ? money(trade.stopPrice, "USD") : "Not set"} />
            <Figure label="Target" value={trade.targetPrice != null ? money(trade.targetPrice, "USD") : "Not set"} />
            <Figure label="Planned R" value={planned != null ? `${num(planned, 1)}R` : "—"} />
            <Figure label="Fees" value={money(trade.fees, "USD")} />
            <Figure
              label="Rules"
              value={trade.followedRules === true ? "Kept" : trade.followedRules === false ? "Broke" : "Not said"}
            />
          </dl>
          {trade.notes && (
            <div className="border-t border-border px-5 py-4">
              <h3 className="text-xs text-muted">Why you took it</h3>
              <p className="mt-1 text-sm leading-relaxed whitespace-pre-line">{trade.notes}</p>
            </div>
          )}
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Your screenshots"
          subtitle="Your own charts of the trade, with your drawings: from TradingView, your broker, anywhere"
        />
        <TradeScreenshots
          tradeId={trade.id}
          screenshots={data.screenshots.map((s) => ({ ...s, createdAt: s.createdAt.toISOString() }))}
        />
      </Card>
    </div>
  );
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="tnum mt-0.5">{value}</dd>
    </div>
  );
}
