import type { Metadata } from "next";
import Link from "next/link";
import { HoldingForm, RemoveHoldingButton } from "@/components/portfolio/holding-form";
import { LocalTime } from "@/components/local-time";
import { Badge, Card, CardHeader, EmptyState, MeterBar, PageHeader, RatingBadge } from "@/components/ui";
import { getEntitlement } from "@/lib/billing/entitlement";
import { calendarDate, percent, price as fmtPrice } from "@/lib/format";
import { listHoldings } from "@/lib/portfolio/actions";
import type { PortfolioIntelligence } from "@/lib/portfolio/intelligence";
import { loadPortfolio } from "@/lib/portfolio/load";
import type { CurrencyTotal } from "@/lib/portfolio/math";
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
        described with the same figures the company pages use. Nothing here connects to a
        brokerage, and nothing here is a recommendation.
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

  const [saved, theses] = await Promise.all([listHoldings(), listTheses()]);
  const view = await loadPortfolio(
    saved,
    theses.map((thesis) => ({ symbol: thesis.symbol, status: thesis.status })),
  );

  return (
    <div className="space-y-5">
      {header}

      <Card>
        <CardHeader title="Add or update a holding" subtitle="Kept on your account. Only you can see it." />
        <HoldingForm />
      </Card>

      {view.holdings.length === 0 ? (
        <Card>
          <EmptyState
            title="No holdings yet"
            description="Add a holding above to see its value, gain, allocation and what it is exposed to."
          />
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,260px),1fr))] gap-3">
            {view.totals.map((total) => (
              <TotalCard key={total.currency} total={total} />
            ))}
          </div>

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
              <table className="w-full min-w-[60rem] text-sm">
                <caption className="sr-only">Your holdings</caption>
                <thead>
                  <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
                    <th scope="col" className="px-5 py-2.5 font-medium">Company</th>
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
                      <tr key={holding.symbol} className="align-top">
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
                          {holding.purchaseDate && (
                            <span className="block text-xs text-faint">
                              Bought {calendarDate(holding.purchaseDate) ?? holding.purchaseDate}
                            </span>
                          )}
                        </th>
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
                          <RemoveHoldingButton symbol={holding.symbol} />
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
              <dt className="text-sm font-medium">
                Average company health
                <span className="block text-xs font-normal text-faint">
                  Value-weighted, over {percent(intelligence.healthMeasured, 0)} of the portfolio with a score
                </span>
              </dt>
              <dd className="tnum text-lg font-semibold">
                {intelligence.averageHealth != null ? intelligence.averageHealth.toFixed(1) : "—"}
              </dd>
            </div>
            {intelligence.exposures.map((exposure) => (
              <div key={exposure.key} className="flex items-baseline justify-between gap-3 py-2.5">
                <dt className="min-w-0 text-sm font-medium">
                  {exposure.label}
                  <span className="block text-xs font-normal leading-relaxed text-faint">
                    {exposure.definition} Measured over {percent(exposure.measured, 0)} of the portfolio.
                  </span>
                </dt>
                <dd className="tnum shrink-0 text-lg font-semibold">
                  {exposure.share != null ? percent(exposure.share, 0) : "—"}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="space-y-5">
          <section aria-labelledby="sector-concentration">
            <h3 id="sector-concentration" className="text-sm font-semibold">Sector concentration</h3>
            <ul className="mt-2 space-y-2">
              {intelligence.sectors.map((sector) => (
                <li key={sector.sector}>
                  <div className="flex justify-between text-xs">
                    <span>{sector.sector}</span>
                    <span className="tnum text-muted">{percent(sector.share, 0)}</span>
                  </div>
                  <MeterBar value={sector.share} max={1} label={`${sector.sector} ${percent(sector.share, 0)}`} />
                </li>
              ))}
            </ul>
            {intelligence.largestHolding && (
              <p className="mt-2 text-xs text-muted">
                The largest holding, {intelligence.largestHolding.symbol}, is{" "}
                {percent(intelligence.largestHolding.share, 0)} of the portfolio.
              </p>
            )}
          </section>

          <section aria-labelledby="portfolio-flags">
            <h3 id="portfolio-flags" className="text-sm font-semibold">Flags</h3>
            {intelligence.flags.length === 0 ? (
              <p className="mt-1 text-sm text-muted">
                No accounting or distress flags, and no thesis marked at risk.
              </p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {intelligence.flags.map((flag, index) => (
                  <li key={`${flag.symbol}-${index}`} className="text-sm">
                    <Link href={`/stock/${encodeURIComponent(flag.symbol)}`} className="font-bold hover:text-accent">
                      {flag.symbol}
                    </Link>{" "}
                    <Badge tone="poor">{flag.label}</Badge>
                    <span className="mt-0.5 block text-xs text-muted">{flag.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <p className="text-xs text-muted">
            {intelligence.theses.withThesis} of {intelligence.theses.holdings} holdings have a written
            thesis{thesesCount > intelligence.theses.withThesis ? `, and you have ${thesesCount} in all` : ""}.{" "}
            <Link href="/research" className="text-accent underline underline-offset-2">
              Thesis updates
            </Link>
          </p>
        </div>
      </div>
      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
        Each figure describes the companies held; none is a target or a suggestion to change
        anything. Holdings outside the scored universe, or without a price, are left out of the
        measures they cannot be tested on rather than counted either way.
        {unconverted.length > 0 &&
          ` Holdings in ${unconverted.join(", ")} are left out of these measures because no exchange rate was available.`}
      </p>
    </Card>
  );
}
