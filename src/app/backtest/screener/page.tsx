import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, Metric, PageHeader, RatingBadge } from "@/components/ui";
import { EquityChart } from "@/components/backtest/equity-chart";
import { LocalTime } from "@/components/local-time";
import { runFullScreenerBacktest } from "@/lib/backtest/run-screener";
import { money, signedPercent } from "@/lib/format";
import type { Rating } from "@/lib/scoring/types";
import { getEntitlement, hasAccess } from "@/lib/billing/entitlement";
import { Paywall } from "@/components/billing/paywall";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Backtest the screener",
  description:
    "What buying this app's healthiest-rated companies and rebalancing every year would have returned.",
  alternates: { canonical: "/backtest/screener" },
};

const SUGGESTIONS = [
  { label: "Since 2020, top 10", start: "2020-01-01", topN: "10" },
  { label: "Since 2015, top 5", start: "2015-01-01", topN: "5" },
];

function suggestionHref(s: (typeof SUGGESTIONS)[number]) {
  return `/backtest/screener?start=${s.start}&amount=10000&topN=${s.topN}`;
}

function healthRating(score: number): Rating {
  if (score >= 7.5) return "good";
  if (score >= 5) return "fair";
  return "poor";
}

export default async function ScreenerBacktestPage({
  searchParams,
}: PageProps<"/backtest/screener">) {
  const params = await searchParams;
  const start = typeof params.start === "string" ? params.start : "";
  const amountParam = typeof params.amount === "string" ? Number(params.amount) : 10_000;
  const amount = Number.isFinite(amountParam) && amountParam > 0 ? amountParam : 10_000;
  const topNParam = typeof params.topN === "string" ? Number(params.topN) : 10;
  const topN = Number.isFinite(topNParam) ? Math.max(1, Math.min(25, topNParam)) : 10;

  const hasQuery = Boolean(start);
  const startDate = hasQuery ? new Date(start) : null;
  const validDate = startDate && !Number.isNaN(startDate.getTime());

  // Same reasoning as the single-stock page: this one fetches price history
  // for the entire universe, so running it for somebody who cannot see it is
  // most expensive way possible to render a paywall.
  const entitlement = await getEntitlement();

  const run =
    hasAccess(entitlement) && hasQuery && validDate
      ? await runFullScreenerBacktest(startDate!, amount, topN)
      : null;

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Backtest" title="What the healthiest returned">
        <p>
          Ranks today&apos;s screening universe by health score at each rebalance date, using only
          what was actually filed by then, and buys the top scorers. This is the one test that
          actually checks whether a higher score on this app has meant anything.
        </p>
        <p>
          To judge this against the market, put the same window into{" "}
          <Link href="/compare?symbols=SPY,QQQ" className="text-accent underline">
            Compare
          </Link>
          {" "}— that is where an index is charted properly, against as many symbols as you like.
        </p>
        <p>
          Want to test one stock instead?{" "}
          <Link href="/backtest" className="text-accent underline">
            Try the single-stock version
          </Link>
          .
        </p>
      </PageHeader>

      <Card>
        <form method="get" className="grid grid-cols-[minmax(0,1fr)] gap-3 p-5 @md:grid-cols-2 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div>
            <label htmlFor="start" className="text-xs text-muted">
              Starting from
            </label>
            <input
              id="start"
              name="start"
              type="date"
              defaultValue={start}
              max={new Date().toISOString().slice(0, 10)}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="amount" className="text-xs text-muted">
              Amount
            </label>
            <input
              id="amount"
              name="amount"
              type="number"
              min={1}
              step="any"
              defaultValue={amount}
              className="tnum mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="topN" className="text-xs text-muted">
              How many to hold
            </label>
            <input
              id="topN"
              name="topN"
              type="number"
              min={1}
              max={25}
              defaultValue={topN}
              className="tnum mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            />
          </div>
          <button
            type="submit"
            className="h-fit self-end rounded-lg border border-transparent bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            Run
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <span className="text-xs text-muted">Try:</span>
          {SUGGESTIONS.map((s) => (
            <Link
              key={s.label}
              href={suggestionHref(s)}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:border-accent hover:text-accent"
            >
              {s.label}
            </Link>
          ))}
          <span className="ml-auto text-xs text-faint">
            This fetches price history for the whole universe and can take a minute or so.
          </span>
        </div>
      </Card>

      {!hasAccess(entitlement) ? (
        <Paywall
          entitlement={entitlement}
          feature="Screener backtesting"
          description="See what buying this app's highest-scoring companies would actually have returned, scored point-in-time at every rebalance date."
          returnTo="/backtest/screener"
        />
      ) : !hasQuery ? (
        <Card>
          <EmptyState
            title="Nothing to show yet"
            description="Pick a starting date above, or try one of the suggestions."
          />
        </Card>
      ) : !validDate ? (
        <Card>
          <EmptyState title="That date didn't parse" description="Pick a date and try again." />
        </Card>
      ) : (
        <ScreenerResults run={run!} amount={amount} topN={topN} />
      )}

      <Card className="p-5">
        <p className="max-w-2xl text-xs leading-relaxed text-muted">
          Educational only, not investment advice. Several real limitations apply, and are worth
          weighing before reading much into the result: the universe is fixed at today&apos;s
          ~500 screened companies rather than whoever was actually screenable on each historical
          date, so a company that has since been delisted or acquired cannot appear in an old
          basket even if it would have qualified — a form of survivorship bias. No fees, spreads
          or taxes are modelled. Point-in-time correctness depends on each filing&apos;s recorded
          date being accurate and present; a company ingested before that tracking began, or
          sourced from a fallback provider that carries no filing date, is excluded from scoring
          entirely rather than assumed available from day one. And this rule — buy the highest
          health score — was chosen because it is this app&apos;s own central claim, which is
          exactly the kind of rule that can look better on the data it was built to explain than
          it will on data that has not happened yet.
        </p>
      </Card>
    </div>
  );
}

function ScreenerResults({
  run,
  amount,
  topN,
}: {
  run: Awaited<ReturnType<typeof runFullScreenerBacktest>>;
  amount: number;
  topN: number;
}) {
  const { result } = run;

  if ("error" in result) {
    return (
      <Card>
        <EmptyState title="Couldn't run that one" description={result.error} />
      </Card>
    );
  }

  const lastPeriod = result.periods[result.periods.length - 1];

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-xs text-muted-strong">
        Scored {run.candidatesScored} of {run.universeSize} companies in today&apos;s universe —
        the rest had no stored financial history, or no price history, to test with.
      </p>

      <div className="grid gap-4">
        <Card>
          <CardHeader
            title={`Top ${topN} by health score`}
            subtitle={
              <>
                <LocalTime value={result.periods[0].start * 1000} mode="date" /> —{" "}
                <LocalTime value={result.periods[result.periods.length - 1].end * 1000} mode="date" />
                , rebalanced yearly
              </>
            }
          />
          <dl className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-4">
            <Metric
              label="Would be worth"
              value={money(result.finalValue)}
              hint={`Starting from ${money(amount)}.`}
              size="lg"
              tone={result.totalReturn >= 0 ? "up" : "down"}
            />
            <Metric
              label="Total return"
              value={signedPercent(result.totalReturn, 1)}
              tone={result.totalReturn >= 0 ? "up" : "down"}
            />
            <Metric
              label="Yearly average"
              value={result.cagr == null ? "—" : signedPercent(result.cagr, 1)}
              hint="Annualised across the whole backtest."
            />
            <Metric
              label="Worst decline"
              value={signedPercent(-result.maxDrawdown, 1)}
              hint="The largest drop from a peak to a low point along the way."
              tone={result.maxDrawdown > 0 ? "down" : undefined}
            />
          </dl>
        </Card>

      </div>

      <Card>
        <CardHeader
          title="Value over time"
          subtitle={`Starting from ${money(amount)}`}
        />
        <div className="p-5">
          <EquityChart target={{ label: "Strategy", series: result.series }} benchmark={null} />
        </div>
      </Card>

      {lastPeriod && lastPeriod.basket.length > 0 && (
        <Card>
          <CardHeader
            title="Most recent basket"
            subtitle={
              <>
                Chosen on <LocalTime value={lastPeriod.start * 1000} mode="date" />, the last
                rebalance date in this window
              </>
            }
          />
          <div className="scroll-x">
            <table className="w-full min-w-[28rem] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
                  <th scope="col" className="px-5 py-2.5 font-medium">Company</th>
                  <th scope="col" className="px-3 py-2 font-medium">Health score at the time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {lastPeriod.basket
                  .slice()
                  .sort((a, b) => b.healthScore - a.healthScore)
                  .map((holding) => (
                    <tr key={holding.symbol}>
                      <td className="px-5 py-3">
                        <Link
                          href={`/stock/${encodeURIComponent(holding.symbol)}`}
                          className="text-[0.9375rem] font-bold tracking-tight transition-colors hover:text-accent"
                        >
                          {holding.symbol}
                        </Link>
                      </td>
                      <td className="px-3 py-3">
                        <RatingBadge
                          rating={healthRating(holding.healthScore)}
                          label={`${holding.healthScore.toFixed(1)}/10`}
                        />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
