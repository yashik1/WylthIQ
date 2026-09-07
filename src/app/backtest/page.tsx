import type { Metadata } from "next";
import Link from "next/link";
import { Card, CardHeader, EmptyState, Metric, PageHeader } from "@/components/ui";
import { EquityChart } from "@/components/backtest/equity-chart";
import { LocalTime } from "@/components/local-time";
import {
  bestByAnnualised,
  runHorizonSweep,
  runOpeningRange,
  runSingleStockBacktest,
  runStrategyComparison,
  type HorizonResult,
  type OpeningRangeRun,
} from "@/lib/backtest/run";
import type { StrategyResult } from "@/lib/backtest/strategies";
import {
  OpeningRangeCard,
  StrategyComparison,
} from "@/components/backtest/strategy-comparison";
import { Paywall } from "@/components/billing/paywall";
import { isInvestmentError, type InvestmentResult } from "@/lib/backtest/single-stock";
import { money, signedPercent } from "@/lib/format";
import { getEntitlement, hasAccess } from "@/lib/billing/entitlement";
import { classify, findInstrument } from "@/lib/instruments";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "What if I had invested…",
  description:
    "See what an investment in any stock, crypto or commodity would be worth today, " +
    "how the same holding did over one, three, five and ten years, and how well-known " +
    "trading rules would have done with it.",
  // One URL per symbol, per date range, per rule — none of them worth indexing
  // separately, and the form is the same page underneath.
  alternates: { canonical: "/backtest" },
};

const SUGGESTIONS = [
  { label: "AAPL since 2015", symbol: "AAPL", start: "2015-01-01" },
  { label: "SPY since 2010", symbol: "SPY", start: "2010-01-01" },
  { label: "Bitcoin since 2017", symbol: "BTC-USD", start: "2017-01-01" },
  { label: "Gold since 2010", symbol: "GC=F", start: "2010-01-01" },
  { label: "Oil since 2019", symbol: "CL=F", start: "2019-01-01" },
];

function suggestionHref(s: (typeof SUGGESTIONS)[number]) {
  // encodeURIComponent matters here: futures carry an "=" in the ticker, and
  // an unencoded GC=F splits the query string into the wrong parameters.
  return `/backtest?symbol=${encodeURIComponent(s.symbol)}&start=${s.start}&amount=10000`;
}

export default async function BacktestPage({ searchParams }: PageProps<"/backtest">) {
  const params = await searchParams;
  const symbol = typeof params.symbol === "string" ? params.symbol.trim().toUpperCase() : "";
  const start = typeof params.start === "string" ? params.start : "";
  const amountParam = typeof params.amount === "string" ? Number(params.amount) : 10_000;
  const amount = Number.isFinite(amountParam) && amountParam > 0 ? amountParam : 10_000;
  const reinvest = params.reinvest !== "cash";

  const hasQuery = Boolean(symbol && start);
  const startDate = hasQuery ? new Date(start) : null;
  const validDate = startDate && !Number.isNaN(startDate.getTime());

  /*
    The backtest itself is free. Entitlement decides only the moving averages.

    This is the question that brings people to the app at all — what would
    £10,000 in Apple be worth now — and putting it behind a sign-up asks
    somebody to pay before they have seen the thing work once. What is worth
    charging for is the analysis laid over the answer, not the answer.
  */
  const entitlement = await getEntitlement();

  /*
    All four run together rather than one after another.

    They cannot share a fetch — the headline backtest starts from the reader's
    own date, the sweep needs the full ten years, and the opening-range test
    needs intraday bars entirely — but they are independent, so there is no
    reason to pay for them serially. The strategy and intraday runs are only
    started for readers who can actually see them, since fetching for someone
    who will be shown a sign-in prompt instead is pure waste.
  */
  const wantsPaidWork = hasQuery && validDate && hasAccess(entitlement);

  const [backtest, horizons, strategies, openingRange] =
    hasQuery && validDate
      ? await Promise.all([
          runSingleStockBacktest(symbol, startDate!, amount, reinvest),
          runHorizonSweep(symbol, amount, reinvest).catch((): HorizonResult[] => []),
          wantsPaidWork
            ? runStrategyComparison(symbol, amount).catch(() => ({
                source: null,
                results: [] as StrategyResult[],
              }))
            : Promise.resolve({ source: null, results: [] as StrategyResult[] }),
          wantsPaidWork
            ? runOpeningRange(symbol, amount).catch((): OpeningRangeRun | null => null)
            : Promise.resolve(null),
        ])
      : [null, [], { source: null, results: [] as StrategyResult[] }, null];

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Textbook parameters, deliberately untuned" title="Backtest">
        <p>
          Pick a stock, crypto, commodity or futures contract, a date and an amount. This
          shows what that money would be worth today, using the actual price history —
          nothing here is a prediction about what happens next.
        </p>
        <p>
          Want to test the screener itself, not one stock?{" "}
          <Link href="/backtest/screener" className="text-accent underline">
            Backtest buying the healthiest companies
          </Link>
          .
        </p>
      </PageHeader>

      <Card>
        <form method="get" className="grid grid-cols-[minmax(0,1fr)] gap-3 p-5 @md:grid-cols-2 @4xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
          <div>
            <label htmlFor="symbol" className="text-xs text-muted">
              Ticker
            </label>
            <input
              id="symbol"
              name="symbol"
              defaultValue={symbol}
              placeholder="AAPL"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm uppercase placeholder:normal-case placeholder:text-muted/60"
            />
          </div>
          <div>
            <label htmlFor="start" className="text-xs text-muted">
              Invested on
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
            <label htmlFor="reinvest" className="text-xs text-muted">
              Dividends
            </label>
            {/*
              A checkbox only appears in the submitted query string when it is
              checked, so reading "was it unchecked" from a GET form is
              genuinely ambiguous — and a hidden field sharing the checkbox's
              name does not fix that, it just submits the name twice, which
              Next.js hands back as an array rather than a single value. A
              select always submits exactly one of two named values, so there
              is nothing to get wrong.
            */}
            <select
              id="reinvest"
              name="reinvest"
              defaultValue={reinvest ? "reinvest" : "cash"}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
            >
              <option value="reinvest">Reinvested</option>
              <option value="cash">Paid out as cash</option>
            </select>
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
        </div>
      </Card>

      {!hasQuery ? (
        <Card>
          <EmptyState
            title="Nothing to show yet"
            description="Enter a ticker and a date above, or pick one of the suggestions."
          />
        </Card>
      ) : !validDate ? (
        <Card>
          <EmptyState title="That date didn't parse" description="Pick a date and try again." />
        </Card>
      ) : (
        <>
          <BacktestResults
            backtest={backtest!}
            horizons={horizons}
            amount={amount}
            reinvest={reinvest}
            canUseAverages={hasAccess(entitlement)}
          />

          {hasAccess(entitlement) ? (
            <>
              <StrategyComparison symbol={symbol} results={strategies.results} amount={amount} />
              {openingRange && (
                <OpeningRangeCard symbol={symbol} run={openingRange} amount={amount} />
              )}
            </>
          ) : (
            <Paywall
              entitlement={entitlement}
              feature="Trading strategies"
              description="Run mean reversion, RSI dip buying, the golden cross, a 200-day trend rule and an intraday opening-range breakout over the same stock — each against simply buying and holding it."
              returnTo={`/backtest?symbol=${encodeURIComponent(symbol)}&start=${start}&amount=${amount}`}
            />
          )}
        </>
      )}

      <Card className="p-5">
        <p className="max-w-2xl text-xs leading-relaxed text-muted">
          Educational only, not investment advice. This uses real historical prices and, where
          available, real dividend payments — but it assumes a lump sum invested on one day and
          held without ever selling, which is rarely how anyone actually invests. No fees,
          spreads or taxes are modelled, and no correction is made for surviving to be listed
          today — a company that failed along the way would not appear here to be picked at all.
        </p>
      </Card>
    </div>
  );
}

function BacktestResults({
  backtest,
  horizons,
  amount,
  reinvest,
  canUseAverages,
}: {
  backtest: Awaited<ReturnType<typeof runSingleStockBacktest>>;
  horizons: HorizonResult[];
  amount: number;
  reinvest: boolean;
  canUseAverages: boolean;
}) {
  const { result } = backtest;
  const assetClass = classify(backtest.symbol);
  const instrument = findInstrument(backtest.symbol);

  if (isInvestmentError(result)) {
    return (
      <Card>
        <EmptyState title="Couldn't run that one" description={result.error} />
      </Card>
    );
  }

  // Only splits inside the window actually held. One before the purchase date
  // is already baked into the starting price and is not this holding's story.
  const splitsInWindow = backtest.splits
    .filter((s) => s.time >= result.startTime && s.time <= result.endTime)
    .sort((a, b) => a.time - b.time);

  return (
    <div className="space-y-4">
      {/*
        Two different reasons a window starts late, and they used to share one
        sentence that was false for the commoner of them. Backtesting Apple
        from 2015 announced that Apple "has no price history back to your
        chosen date", of a company listed since 1980 — the ten-year fetch
        ceiling was ours, and the wording blamed the data.
      */}
      {backtest.startedLateBecause === "fetch-limit" && (
        <Caveat>
          This app fetches at most ten years of daily prices, so the test starts from{" "}
          <LocalTime value={result.startTime * 1000} mode="date" /> rather than the date you
          chose. {backtest.symbol} may well have traded before then.
        </Caveat>
      )}
      {backtest.startedLateBecause === "history" && (
        <Caveat>
          {backtest.symbol} has no price history back to your chosen date — this starts from{" "}
          <LocalTime value={result.startTime * 1000} mode="date" /> instead, the earliest price
          available for it.
        </Caveat>
      )}
      {/*
        The dividend caveat is for things that pay dividends.

        Shown unconditionally, it told a reader that "any dividends BTC-USD
        paid are not included" — inviting them to mentally add a yield that
        does not exist and never did. A caveat that describes absent data is
        only honest when the data could have been there.
      */}
      {reinvest && !backtest.dividendDataAvailable && assetClass === null && (
        <Caveat>
          Dividend data isn&apos;t available on this deployment, so this shows price return only
          — any dividends {backtest.symbol} paid are not included.
        </Caveat>
      )}
      {/*
        A futures curve is not a thing anybody could have bought and held.

        The series is stitched from each front-month contract in turn, so a
        ten-year "investment" in wheat is really a decade of rolling positions,
        each roll with its own cost and its own gap between the expiring and
        the next contract. The number above is a fair record of how the
        commodity's price moved; it is not a record of what a holder would have
        ended up with, and the difference compounds.
      */}
      {(assetClass === "commodity" || assetClass === "future") && (
        <Caveat>
          This tracks the front-month futures price, stitched across contracts as each one
          expires. Nobody can actually buy and hold that — a real position has to be rolled
          into the next contract again and again, and the cost of doing so is not modelled
          here. Read it as how the price moved, not as what a holder would have made.
        </Caveat>
      )}
      {assetClass === "crypto" && (
        <Caveat>
          Crypto trades every day of the year, including weekends, so this curve has roughly
          40% more points than a stock over the same window. Returns are still annualised on
          calendar days, so the yearly average is on the same footing as a share&apos;s.
        </Caveat>
      )}
      {/*
        Without this, a split makes a correct result look broken. NVDA split
        10:1 in June 2024, so a 2022 purchase is priced here at about $30 a
        share where a reader remembers roughly $300 — the return is right
        either way, because a split hands you ten times the shares at a tenth
        the price, but the arithmetic only reads as honest once somebody says
        that out loud.
      */}
      {splitsInWindow.length > 0 && (
        <Caveat>
          {backtest.symbol} split its shares{" "}
          {splitsInWindow.map((s, i) => (
            <span key={s.time}>
              {i > 0 && (i === splitsInWindow.length - 1 ? " and " : ", ")}
              <strong className="font-semibold">{s.ratio}</strong> on{" "}
              <LocalTime value={s.time * 1000} mode="date" />
            </span>
          ))}
          . Prices and share counts here are adjusted for that, so every figure is on
          today&apos;s footing and comparable across the whole period — which means they
          will not match the headline price you remember from before the split. Your money
          was unaffected either way: a split hands you more shares at a proportionally
          lower price.
        </Caveat>
      )}

      {/* "Gold" reads better than "GC=F" on the headline card. */}
      <ResultCard
        label={instrument?.name ?? backtest.symbol}
        amount={amount}
        result={result}
        reinvest={reinvest}
        dividendsBakedIn={backtest.dividendsBakedIn}
      />

      <Card>
        <CardHeader title="Value over time" subtitle={`Starting from ${money(amount)}`} />
        <div className="p-5">
          <EquityChart
            target={{ label: backtest.symbol, series: result.series }}
            benchmark={null}
            canUseAverages={canUseAverages}
          />
        </div>
      </Card>

      <HorizonTable
        symbol={instrument?.name ?? backtest.symbol}
        horizons={horizons}
        amount={amount}
      />

      <Card className="p-5">
        <p className="text-sm text-muted">
          Want to see this against the market, or against anything else?{" "}
          <Link
            href={`/compare?symbols=${encodeURIComponent(backtest.symbol)},SPY`}
            className="text-accent underline"
          >
            Compare {backtest.symbol} with SPY
          </Link>
          {" "}— that page charts any set of symbols side by side, which is the job it
          does properly.
        </p>
      </Card>
    </div>
  );
}

/**
 * The same holding over several standard windows, all ending today.
 *
 * One start date answers one question, and it is the question the reader
 * happened to type. This answers the more useful one: was the result
 * consistent, or did a single window carry it? A stock that returned 30% a
 * year over five and 4% over ten made almost all of it recently, and someone
 * deciding what to expect next should see both rather than whichever the date
 * field defaulted to.
 */
function HorizonTable({
  symbol,
  horizons,
  amount,
}: {
  symbol: string;
  horizons: HorizonResult[];
  amount: number;
}) {
  const usable = horizons.filter(
    (h): h is HorizonResult & { result: InvestmentResult } => !isInvestmentError(h.result),
  );

  if (usable.length === 0) return null;

  const best = bestByAnnualised(usable);

  return (
    <Card>
      <CardHeader
        title={`${symbol} over different holding periods`}
        subtitle={`The same ${money(amount)}, invested that long ago and held until today`}
      />
      <div className="scroll-x">
        <table className="w-full min-w-[30rem] text-sm">
          <thead>
            <tr className="border-b border-border bg-surface-2/50 text-left text-xs text-muted">
              <th scope="col" className="px-5 py-2.5 font-medium">Held for</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Would be worth</th>
              <th scope="col" className="px-3 py-2.5 text-right font-medium">Total return</th>
              <th scope="col" className="px-5 py-2.5 text-right font-medium">Yearly average</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {usable.map((h) => (
              <tr key={h.label} className={h === best ? "bg-good-soft/40" : undefined}>
                <td className="px-5 py-3">
                  <span className="font-medium">{h.label}</span>
                  {h === best && usable.length > 1 && (
                    <span className="ml-2 text-xs text-good-fg">best annualised</span>
                  )}
                  {h.shortOfLabel && (
                    <span className="ml-2 text-xs text-faint">
                      from <LocalTime value={h.result.startTime * 1000} mode="date" /> only
                    </span>
                  )}
                </td>
                <td className="tnum px-3 py-3 text-right">{money(h.result.finalValue)}</td>
                <td
                  className={`tnum px-3 py-3 text-right ${
                    h.result.totalReturn >= 0 ? "text-good-fg" : "text-poor-fg"
                  }`}
                >
                  {signedPercent(h.result.totalReturn, 1)}
                </td>
                <td className="tnum px-5 py-3 text-right font-medium">
                  {h.result.cagr == null ? "—" : signedPercent(h.result.cagr, 1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-border px-5 py-3">
        <p className="max-w-2xl text-xs leading-relaxed text-muted">
          Each row is the same lump sum invested that far back and held to today — not a
          strategy, just a different starting date. A row marked &ldquo;from … only&rdquo; is
          shorter than its label because the price history does not reach back that far.
        </p>
      </div>
    </Card>
  );
}

function ResultCard({
  label,
  amount,
  result,
  reinvest,
  dividendsBakedIn,
}: {
  label: string;
  amount: number;
  result: InvestmentResult;
  reinvest: boolean;
  dividendsBakedIn: boolean;
}) {
  return (
    <Card>
      <CardHeader
        title={label}
        subtitle={
          <>
            <LocalTime value={result.startTime * 1000} mode="date" /> —{" "}
            <LocalTime value={result.endTime * 1000} mode="date" />
          </>
        }
      />
      {/*
        Two columns on a phone, not three. At 375px three columns left each
        metric 90px, which is enough for the figures but clips their labels —
        "Would be worth" and "Yearly average" both truncated, so the reader
        got a number with no reliable idea what it measured.
      */}
      <dl className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3">
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
          hint="Change in value over the whole period."
          tone={result.totalReturn >= 0 ? "up" : "down"}
        />
        <Metric
          label="Yearly average"
          value={result.cagr == null ? "—" : signedPercent(result.cagr, 1)}
          hint={
            result.cagr == null
              ? "The period is too short to annualise meaningfully."
              : "Annualised — the steady yearly rate that would produce the same result."
          }
        />
      </dl>
      {/*
        When the source series already carries dividends, neither caption
        below is true — the result is a total return whatever was asked for,
        and there is no way to take them back out. Saying so beats letting
        "paid out as cash" stand over a number that reinvested them.
      */}
      {dividendsBakedIn ? (
        <p className="border-t border-border px-5 py-2.5 text-xs text-muted">
          This provider&apos;s prices already have dividends reinvested into them, so this
          is a total return — the cash option cannot be applied to it.
        </p>
      ) : null}
      {!dividendsBakedIn && reinvest && result.dividendsReceived === 0 && result.totalReturn !== 0 && (
        <p className="border-t border-border px-5 py-2.5 text-xs text-muted">
          Dividends, if any, were reinvested into more shares rather than paid out as cash.
        </p>
      )}
      {!dividendsBakedIn && !reinvest && result.dividendsReceived > 0 && (
        <p className="border-t border-border px-5 py-2.5 text-xs text-muted">
          Includes {money(result.dividendsReceived)} in dividends collected as cash, not
          reinvested.
        </p>
      )}
    </Card>
  );
}

/**
 * A caveat above a result — the things the number does not account for.
 *
 * The box keeps the full width so it still reads as a notice, but its text is
 * held to the same column as every other explanatory passage in the app. Run
 * edge to edge these reached about 208 characters a line over three lines,
 * which is where a reader starts losing the return to the next line — and
 * these are precisely the sentences that stop a figure being misread.
 */
function Caveat({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface-2 px-4 py-2.5">
      <p className="max-w-2xl text-xs leading-relaxed text-muted-strong">{children}</p>
    </div>
  );
}
