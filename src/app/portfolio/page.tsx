import type { Metadata } from "next";
import Link from "next/link";
import { AllocationChart } from "@/components/portfolio/allocation-chart";
import { BrokerBreakdown } from "@/components/portfolio/broker-breakdown";
import { HoldingForm, RemoveHoldingButton } from "@/components/portfolio/holding-form";
import { HoldingsMap } from "@/components/portfolio/holdings-map";
import { LocalTime } from "@/components/local-time";
import { Badge, Card, CardHeader, EmptyState, MeterBar, PageHeader, RatingBadge } from "@/components/ui";
import { canAccess, getEntitlement } from "@/lib/billing/entitlement";
import { listBrokerHoldings } from "@/lib/brokers/queries";
import { calendarDate, percent, price as fmtPrice } from "@/lib/format";
import { accountTypeLabel } from "@/lib/portfolio/account-types";
import { listHoldings } from "@/lib/portfolio/actions";
import { mapCompanies, type PortfolioChart } from "@/lib/portfolio/charts";
import type { PortfolioIntelligence } from "@/lib/portfolio/intelligence";
import { loadPortfolio } from "@/lib/portfolio/load";
import type { CurrencyTotal, ValuedHolding } from "@/lib/portfolio/math";
import { toPortfolioInputs } from "@/lib/portfolio/sources";
import { healthRating } from "@/lib/scoring/ratings";
import { listTheses } from "@/lib/thesis/actions";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Portfolio",
  description: "What you hold, what it is worth, and what it is exposed to — described from company filings.",
  robots: { index: false, follow: false },
};

function signedAmount(value: number, currency: string): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${fmtPrice(Math.abs(value), currency)}`;
}

function signedPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(1)}%`;
}

export default async function PortfolioPage() {
  const entitlement = await getEntitlement();

  const header = (
    <PageHeader eyebrow="Your holdings" title="Portfolio">
      <p>
        What you hold, what it is worth on the latest available prices, and what it is exposed to —
        described with the same figures the company pages use. Holdings come from what you enter
        here and, if you connect your broker on your{" "}
        <Link href="/account" className="text-accent underline underline-offset-2">
          account page
        </Link>
        , from what it reports — read-only, it can never trade. Nothing here is a recommendation.
      </p>
    </PageHeader>
  );

  if (!entitlement.userId) {
    return (
      <div className="space-y-5">
        {header}
        <Card className="p-5">
          <p className="max-w-2xl text-sm leading-relaxed text-muted-strong">
            Sign in to record what you hold. The portfolio is kept on your account and only you can
            see it.
          </p>
          <Link
            href="/signin?next=/portfolio"
            className="mt-3 inline-flex rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg"
          >
            Sign in
          </Link>
        </Card>
      </div>
    );
  }

  const [saved, synced, theses] = await Promise.all([
    listHoldings(),
    canAccess(entitlement, "BROKER_SYNC") ? listBrokerHoldings(entitlement.userId) : Promise.resolve([]),
    listTheses(),
  ]);
  const { inputs, overlaps } = toPortfolioInputs(saved, synced);
  const view = await loadPortfolio(
    inputs,
    theses.map((thesis) => ({ symbol: thesis.symbol, status: thesis.status })),
  );

  return (
    <div className="space-y-5">
      {header}

      <Card>
        <CardHeader title="Add or update a holding" subtitle="Kept on your account. Only you can see it." />
        <HoldingForm />
      </Card>

      {view.holdings.length > 0 && view.intelligence && <PortfolioPulse intelligence={view.intelligence} holdings={view.holdings.length} />}

      {view.holdings.length === 0 ? (
        <Card>
          <EmptyState
            title="No holdings yet"
            description={
              <>
                Add a holding above to see value, gain, allocation and what the portfolio is exposed to. Or{" "}
                <Link href="/account#connected-broker" className="text-accent underline underline-offset-2">
                  connect a broker
                </Link>{" "}
                on your account page — read-only, it can never trade.
              </>
            }
            action={
              <Link href="/screen" className="text-sm font-medium text-accent underline underline-offset-2">
                Find companies in the screener
              </Link>
            }
          />
        </Card>
      ) : (
        <>
          {overlaps.length > 0 && (
            <Card className="p-4">
              <p className="text-sm leading-relaxed text-muted-strong">
                Some companies appear more than once, and every copy is counted. If any are the same
                shares, remove the extra one — the hand-entered row here, or the extra connection on
                your account page.
              </p>
              <ul className="mt-1.5 space-y-0.5 text-sm text-muted">
                {overlaps.map((overlap) => (
                  <li key={overlap.symbol}>
                    <span className="font-semibold text-foreground">{overlap.symbol}</span> —{" "}
                    {overlap.from.join(" and ")}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
            {view.totals.map((total) => (
              <TotalCard key={total.currency} total={total} />
            ))}
          </div>

          {view.brokers.some((broker) => broker.synced) && (
            <Card>
              <CardHeader
                title="By broker"
                subtitle={`Your connected brokers and what each holds, in ${view.chart.currency}${
                  view.chart.converted ? ", other currencies converted at the latest rate" : ""
                }. Select one to see its holdings.`}
              />
              <BrokerBreakdown brokers={view.brokers} currency={view.chart.currency} />
            </Card>
          )}

          {mapCompanies(view.chart).length >= 2 && (
            <div className="grid grid-cols-[minmax(0,1fr)] gap-3 xl:grid-cols-2">
              <Card>
                <CardHeader title="Allocation" subtitle={`Where the portfolio's value sits, in ${view.chart.currency}`} />
                <AllocationChart chart={view.chart} />
                <ChartNote chart={view.chart} />
              </Card>
              <Card>
                <CardHeader
                  title="Portfolio map"
                  subtitle="Each tile is a company, sized by its value and shaded by its gain or loss on cost. Select one to open it."
                />
                <HoldingsMap chart={view.chart} />
                <ChartNote chart={view.chart} />
              </Card>
            </div>
          )}

          <Card>
            <CardHeader
              title="Holdings"
              subtitle={
                view.totals.length > 1
                  ? "Allocation is within each currency, since amounts in different currencies cannot simply be added"
                  : "Value and gain on the latest available price"
              }
            />
            <div className="scroll-x">
              <table className="w-full min-w-[66rem] text-sm">
                <caption className="sr-only">Your holdings</caption>
                <thead>
                  <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
                    <th scope="col" className="px-5 py-2.5 font-medium">Company</th>
                    <th scope="col" className="px-3 py-2 font-medium">Held at</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Shares</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Average cost</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Price</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Value</th>
                    <th scope="col" className="px-3 py-2 text-right font-medium">Gain</th>
                    <th scope="col" className="px-3 py-2 font-medium">Allocation</th>
                    <th scope="col" className="px-3 py-2 font-medium">Health</th>
                    <th scope="col" className="px-3 py-2 font-medium"><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {view.holdings.map((holding) => {
                    const scored = view.scored[holding.symbol];
                    return (
                      <tr key={holding.key} className="align-top">
                        <th scope="row" className="px-5 py-3 text-left font-normal">
                          <Link
                            href={`/stock/${encodeURIComponent(holding.symbol)}`}
                            className="font-bold tracking-tight hover:text-accent"
                          >
                            {holding.symbol}
                          </Link>
                          {holding.name && (
                            <span className="block max-w-[14rem] truncate text-xs text-muted">{holding.name}</span>
                          )}
                          {holding.source === "synced" && holding.reportedAt ? (
                            <span className="block text-xs text-faint">
                              As of {calendarDate(holding.reportedAt) ?? holding.reportedAt}
                            </span>
                          ) : (
                            holding.purchaseDate && (
                              <span className="block text-xs text-faint">
                                Bought {calendarDate(holding.purchaseDate) ?? holding.purchaseDate}
                              </span>
                            )
                          )}
                        </th>
                        <td className="px-3 py-3">
                          {holding.source === "synced" ? (
                            <Badge tone="accent" title={`Synced read-only from ${holding.sourceLabel ?? "your broker"}`}>
                              {holding.sourceLabel ?? "Your broker"}
                            </Badge>
                          ) : (
                            <span className="text-xs text-muted">Entered by hand</span>
                          )}
                          <HeldIn holding={holding} />
                        </td>
                        <td className="tnum px-3 py-3 text-right">
                          {holding.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}
                        </td>
                        <td className="tnum px-3 py-3 text-right">{fmtPrice(holding.averageCost, holding.currency)}</td>
                        <td className="tnum px-3 py-3 text-right">
                          {holding.price != null ? (
                            <>
                              {fmtPrice(holding.price, holding.currency)}
                              <span className="block text-[11px] text-faint">
                                {holding.priceSource === "stored" ? "stored quote" : "live quote"}
                                {holding.priceAsOf && (
                                  <>
                                    {", "}
                                    <LocalTime value={holding.priceAsOf} mode="relative" />
                                  </>
                                )}
                              </span>
                            </>
                          ) : (
                            <span className="text-xs text-faint">No price available</span>
                          )}
                        </td>
                        <td className="tnum px-3 py-3 text-right">
                          {holding.value != null ? fmtPrice(holding.value, holding.currency) : "—"}
                          <span className="block text-[11px] text-faint">cost {fmtPrice(holding.cost, holding.currency)}</span>
                        </td>
                        <td
                          className={cn(
                            "tnum px-3 py-3 text-right",
                            holding.gain != null && holding.gain > 0 && "text-up",
                            holding.gain != null && holding.gain < 0 && "text-down",
                          )}
                        >
                          {holding.gain != null ? signedAmount(holding.gain, holding.currency) : "—"}
                          <span className="block text-[11px]">{signedPercent(holding.gainPercent)}</span>
                        </td>
                        <td className="px-3 py-3">
                          {holding.allocation != null ? (
                            <div className="flex w-28 flex-col gap-1">
                              <span className="tnum text-xs">{percent(holding.allocation)}</span>
                              <MeterBar value={holding.allocation} max={1} label={`${holding.symbol} allocation ${percent(holding.allocation)}`} />
                            </div>
                          ) : (
                            <span className="text-xs text-faint">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {scored ? (
                            <RatingBadge
                              rating={healthRating(scored.healthScore)}
                              label={scored.healthScore != null ? `${scored.healthScore.toFixed(1)}/10` : "no data"}
                            />
                          ) : (
                            <span className="text-xs text-faint">Not scored</span>
                          )}
                        </td>
                        <td className="px-3 py-3">
                          {holding.source === "manual" && holding.holdingId != null ? (
                            <RemoveHoldingButton
                              id={holding.holdingId}
                              label={
                                holding.accountType
                                  ? `${holding.symbol} (${accountTypeLabel(holding.accountType)})`
                                  : holding.symbol
                              }
                            />
                          ) : (
                            <span className="text-xs text-faint" title="Changes when your broker's report does">
                              Synced
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
              Prices come from the stored quotes refreshed through the day where they are recent,
              otherwise from a live lookup, labelled on each row. Both are delayed, not real time.
              {view.livePriceSkipped > 0 &&
                ` ${view.livePriceSkipped} holdings were not looked up, to stay within the provider's limits.`}
              {view.holdings.some((h) => h.source === "synced") &&
                " Holdings marked with a broker are what that broker last reported; their cost is the broker's, their price is this app's."}
            </p>
          </Card>

          {view.intelligence && (
            <IntelligenceCard
              intelligence={view.intelligence}
              baseCurrency={view.baseCurrency}
              unconverted={view.unconverted}
              thesesCount={theses.length}
            />
          )}
        </>
      )}
    </div>
  );
}

function HeldIn({ holding }: { holding: ValuedHolding }) {
  const synced = holding.source === "synced";
  if (!holding.accountType && !synced) return null;
  return (
    <span className="mt-1 block text-xs">
      {holding.accountType ? (
        <span className="font-medium">{accountTypeLabel(holding.accountType)}</span>
      ) : (
        <Link href="/account#connected-broker" className="text-faint underline underline-offset-2 hover:text-accent">
          Set account type
        </Link>
      )}
      {synced && holding.account && <span className="block text-[11px] text-faint">{holding.account}</span>}
    </span>
  );
}

function ChartNote({ chart }: { chart: PortfolioChart }) {
  if (!chart.converted && chart.leftOut === 0) return null;
  return (
    <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
      {chart.converted && `Holdings in other currencies are converted to ${chart.currency} at the latest rate.`}
      {chart.converted && chart.leftOut > 0 && " "}
      {chart.leftOut > 0 &&
        `${chart.leftOut} ${chart.leftOut === 1 ? "holding is" : "holdings are"} left out, having no price or exchange rate.`}
    </p>
  );
}

function TotalCard({ total }: { total: CurrencyTotal }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">Value in {total.currency}</p>
      <p className="tnum mt-1 text-2xl font-semibold tracking-tight">{fmtPrice(total.value, total.currency)}</p>
      <p
        className={cn(
          "tnum mt-0.5 text-sm",
          total.gain > 0 && "text-up",
          total.gain < 0 && "text-down",
        )}
      >
        {signedAmount(total.gain, total.currency)} ({signedPercent(total.gainPercent)})
      </p>
      <p className="mt-1 text-xs text-faint">
        Cost {fmtPrice(total.cost, total.currency)} · {total.priced} priced
        {total.unpriced > 0 && `, ${total.unpriced} without a price`}
      </p>
    </Card>
  );
}

function IntelligenceCard({
  intelligence,
  baseCurrency,
  unconverted,
  thesesCount,
}: {
  intelligence: PortfolioIntelligence;
  baseCurrency: string;
  unconverted: string[];
  thesesCount: number;
}) {
  return (
    <Card>
      <CardHeader
        title="What the portfolio is exposed to"
        subtitle={`Shares of value, weighted in ${baseCurrency}, using each company's latest annual figures`}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 p-5 lg:grid-cols-2">
        <div>
          <dl className="divide-y divide-border">
            <div className="flex items-baseline justify-between gap-3 py-2.5">
              <dt className="text-sm font-medium">Average company health</dt>
              <dd className="tnum text-sm font-semibold">
                {intelligence.averageHealth != null ? `${intelligence.averageHealth.toFixed(1)}/10` : "—"}
              </dd>
            </div>
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-muted">
            Weighted by holding value. Companies without a score are left out of the average.
            {thesesCount > 0 && ` You have ${thesesCount} written ${thesesCount === 1 ? "thesis" : "theses"} on holdings.`}
            {unconverted.length > 0 &&
              ` Some holdings could not be converted into ${baseCurrency}: ${unconverted.join(", ")}.`}
          </p>
        </div>
      </div>
    </Card>
  );
}

function PortfolioPulse({
  intelligence,
  holdings,
}: {
  intelligence: PortfolioIntelligence;
  holdings: number;
}) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">Portfolio pulse</p>
      <p className="mt-1 text-sm text-muted-strong">
        {holdings} {holdings === 1 ? "holding" : "holdings"}
        {intelligence.averageHealth != null &&
          ` · average health ${intelligence.averageHealth.toFixed(1)}/10`}
      </p>
    </Card>
  );
}
