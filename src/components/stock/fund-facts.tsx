import { Card, CardHeader, Metric } from "@/components/ui";
import { count, num, percent, price } from "@/lib/format";
import { feeOn, type IncomeSummary } from "@/lib/etf/income";
import { describeBeta } from "@/lib/etf/beta";
import type { FundAnalytics } from "@/lib/etf/fund-analytics";
import type { EtfProfile } from "@/lib/providers/alphavantage";
import type { Quote } from "@/lib/providers/types";

/** The sum a fee is quoted against. Round, so the arithmetic stays visible. */
const FEE_BASIS = 10_000;

/**
 * What a fund costs, and how it trades.
 *
 * The companion to the holdings panel, and deliberately a separate card
 * because it comes from somewhere else. Holdings are the fund's own statement
 * to its regulator; none of this is. A prospectus carries the expense ratio as
 * prose in an HTML fee table, which is not extractable at sensible cost, so
 * the single number every fund reader looks at first had to come from a data
 * provider — and a panel that mixed the two sources under one heading would
 * quietly extend the filing's authority to figures that do not have it. The
 * footer says which is which.
 *
 * Ratios arrive as fractions: 0.0018 is 0.18%. That is what `percent()`
 * expects, so unlike the N-PORT panel next door nothing is divided here.
 */
export function FundFacts({
  profile,
  quote,
  income,
  range: yearRange,
  analytics,
}: {
  profile: EtfProfile | null;
  quote: Quote | null;
  income: IncomeSummary | null;
  range: { fiftyTwoWeekLow: number | null; fiftyTwoWeekHigh: number | null } | null;
  analytics: FundAnalytics | null;
}) {
  const range = dayRange(quote);
  const currency = quote?.currency ?? "USD";
  const yearly = feeOn(profile?.expenseRatio ?? null, FEE_BASIS);

  return (
    <Card>
      <CardHeader
        title="What it costs, and how it trades"
        subtitle="The fee is the one figure under your control — it is charged whether the fund rises or falls, every year you hold it."
      />

      {profile?.leveraged && (
        /*
          Stated before the numbers, not after them.

          A leveraged fund multiplies a daily move and resets each day, so
          holding one for a year does not multiply the year's return — it
          compounds a daily bet and can lose money in a market that ended
          higher. Someone who does not already know that will not learn it
          from an expense ratio.
        */
        <p className="border-b border-border bg-poor-soft px-5 py-3 text-sm leading-relaxed text-poor-fg">
          <span className="font-semibold">This is a leveraged fund.</span> It aims to
          multiply a single day&rsquo;s move and resets daily, so returns over any longer
          period compound rather than multiply — a leveraged fund can lose money over a
          period in which its index rose.
        </p>
      )}

      {/*
        The fee in money, said before the table rather than inside it.

        This is the one line on the card most likely to change what somebody
        does. A reader compares 0.03% and 0.75% and sees two small numbers;
        they are a factor of twenty-five apart, and nobody holds a percentage.
        Stating it as a yearly sum on a round amount makes the comparison the
        arithmetic a person would actually do.
      */}
      {yearly !== null && (
        <p className="border-b border-border px-5 py-3.5 text-[0.9375rem] leading-relaxed">
          Holding {plainMoney(FEE_BASIS, currency)} of this fund costs about{" "}
          <span className="font-semibold">{plainMoney(yearly, currency)} a year</span> in fees,
          taken out of the fund&rsquo;s value rather than billed to you
          {income?.trailingTwelveMonths ? (
            <>
              . It paid {price(income.trailingTwelveMonths, currency)} per share over the
              last year
              {income.frequency ? `, ${income.frequency.toLowerCase()}` : ""}.
            </>
          ) : (
            "."
          )}
        </p>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-4 sm:grid-cols-4">
        <Metric
          label="Expense ratio"
          value={profile?.expenseRatio == null ? "—" : percent(profile.expenseRatio, 2)}
          size="lg"
          hint="Charged annually as a share of what you hold, taken out of the fund's value rather than billed."
        />
        <Metric
          label="Dividend yield"
          value={income?.yield == null ? "—" : percent(income.yield, 2)}
          size="lg"
          hint="What it paid out over the last twelve months, against today's price. Computed from the fund's own payment history rather than taken from a provider's summary, so the basis is known: trailing, not forecast."
        />
        <Metric label="Launched" value={launched(profile?.inceptionDate ?? null)} size="lg" />
        <Metric
          label="Turnover"
          value={profile?.turnover == null ? "—" : percent(profile.turnover, 0)}
          size="lg"
          hint="How much of the portfolio was replaced over a year. A low figure is what an index fund should show; a high one means trading costs the expense ratio does not include."
        />
      </dl>

      {income && (income.trailingTwelveMonths !== null || income.lastExDate) && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border px-5 py-4 sm:grid-cols-4">
          <Metric
            label="Paid last 12 months"
            value={income.trailingTwelveMonths == null ? "—" : price(income.trailingTwelveMonths, currency)}
            size="sm"
            hint={
              income.paymentsCounted > 0
                ? `Per share, from ${income.paymentsCounted} payment${income.paymentsCounted === 1 ? "" : "s"}.`
                : undefined
            }
          />
          <Metric label="Pays" value={income.frequency ?? "—"} size="sm" />
          <Metric label="Last ex-dividend" value={launched(income.lastExDate, true)} size="sm" />
          <Metric
            label="52-week range"
            value={yearRangeText(yearRange, currency)}
            size="sm"
          />
        </dl>
      )}

      {quote && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border px-5 py-4 sm:grid-cols-4">
          <Metric label="Previous close" value={price(quote.previousClose, quote.currency ?? "USD")} size="sm" />
          <Metric label="Day's range" value={range} size="sm" />
          <Metric label="Volume" value={count(quote.volume)} size="sm" />
          <Metric
            label="Change"
            value={quote.changePercent == null ? "—" : `${quote.changePercent >= 0 ? "+" : ""}${quote.changePercent.toFixed(2)}%`}
            size="sm"
            tone={quote.changePercent == null ? undefined : quote.changePercent >= 0 ? "up" : "down"}
          />
        </dl>
      )}

      {(analytics?.valuation || analytics?.beta) && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-4 border-t border-border px-5 py-4 sm:grid-cols-4">
          <Metric
            label="P/E of its holdings"
            value={analytics.valuation ? num(analytics.valuation.peRatio, 1) : "—"}
            size="sm"
            hint={
              analytics.valuation
                ? `Weighted across the ${analytics.valuation.priced} holdings this site scores from their own filings — ${percent(analytics.valuation.coverage, 0)} of the fund. Weighted the way a portfolio's multiple actually works, as total price over total earnings, so one expensive holding cannot drag the figure up beyond its share of the earnings. Loss-makers are left out rather than counted as cheap.`
                : undefined
            }
          />
          <Metric
            label="Priced from"
            value={analytics.valuation ? percent(analytics.valuation.coverage, 0) : "—"}
            size="sm"
            hint="How much of the fund that P/E covers. The rest is held in companies this site does not score."
          />
          <Metric
            label="Beta"
            value={analytics.beta ? num(analytics.beta.beta, 2) : "—"}
            size="sm"
            hint={
              analytics.beta
                ? `Five years of monthly returns against ${analytics.benchmark}, computed here so the basis is stated — providers each pick their own window and rarely say which. This fund ${describeBeta(analytics.beta.beta)}.`
                : undefined
            }
          />
          <Metric
            label="Explained by market"
            value={analytics.beta ? percent(analytics.beta.rSquared, 0) : "—"}
            size="sm"
            hint="How much of this fund's movement the benchmark accounts for. A beta near 1 means little when this is low — the slope fits, but the fund is not really tracking the market."
          />
        </dl>
      )}

      {profile && sectorsAreComplete(profile.sectors) && (
        <div className="border-t border-border px-5 py-4">
          <p className="eyebrow text-[0.625rem]">What it is invested in</p>
          <ul className="mt-2.5 grid grid-cols-[minmax(0,1fr)] gap-x-8 gap-y-1.5 sm:grid-cols-2">
            {profile.sectors.map((s) => (
              <li key={s.sector} className="flex items-baseline justify-between gap-4 text-sm">
                <span className="min-w-0 truncate text-muted-strong">{s.sector}</span>
                <span className="tnum shrink-0 font-medium">{percent(s.weight, 1)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/*
        Three sources on one card, so the card says which is which.
        The holdings panel below can point at a filing; none of this can.
      */}
      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-faint">
        Fee, launch date and turnover from Alpha Vantage. Everything else on this card is
        computed here — the payout and the year&rsquo;s range from the fund&rsquo;s own
        payment history, the beta from five years of returns against{" "}
        {analytics?.benchmark ?? "the market"}, and the P/E from this site&rsquo;s own
        scores for the companies it holds. Check the fund&rsquo;s factsheet before acting
        on a fee: that one is a provider&rsquo;s figure, not the prospectus.
      </p>
    </Card>
  );
}

/**
 * A launch date, as a year and month.
 *
 * The day a fund opened is not information anybody acts on, and a raw
 * `1999-03-10` in a row of percentages reads as a serial number. Formatted
 * from the string's own parts, so no timezone can move it.
 */
function launched(date: string | null, withDay = false): string {
  if (!date) return "—";
  const [y, m, d] = date.split("-").map(Number);
  if (!y || !m) return date;
  return new Date(Date.UTC(y, m - 1, withDay ? (d || 1) : 1)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    ...(withDay ? { day: "numeric" as const } : {}),
    month: "short",
    year: "numeric",
  });
}

/**
 * A round sum, written the way a person writes one.
 *
 * `money()` abbreviates to "$10.0K" and `price()` insists on pence, and this
 * sentence wants neither — "$10000.00 costs $18.00 a year" reads like machine
 * output in the one line on the card written to be read as a sentence.
 */
function plainMoney(value: number, currency: string): string {
  const symbol = currency === "USD" ? "$" : currency === "GBP" ? "£" : currency === "EUR" ? "€" : "";
  const rounded = Math.round(value);
  const text = rounded.toLocaleString("en-US");
  return symbol ? `${symbol}${text}` : `${text} ${currency}`;
}

/** "578.46 – 716.39", the year's low and high. */
function yearRangeText(
  range: { fiftyTwoWeekLow: number | null; fiftyTwoWeekHigh: number | null } | null,
  currency: string,
): string {
  if (!range || range.fiftyTwoWeekLow == null || range.fiftyTwoWeekHigh == null) return "—";
  return `${price(range.fiftyTwoWeekLow, currency)} – ${price(range.fiftyTwoWeekHigh, currency)}`;
}

/**
 * Whether the sector weights add up to a fund.
 *
 * They frequently do not. Alpha Vantage returns eleven sectors for QQQ that
 * sum to 38% of it, which is not a breakdown of anything — a reader would
 * take "Information Technology 24.3%" for the fund's tech exposure when the
 * real figure is more than double that. A partial breakdown presented as a
 * whole one is worse than no breakdown, and there is a complete one from the
 * fund's own filing directly below, so this shows only when the provider's
 * numbers actually account for the portfolio.
 */
function sectorsAreComplete(sectors: { weight: number }[]): boolean {
  if (sectors.length === 0) return false;
  const total = sectors.reduce((sum, s) => sum + s.weight, 0);
  return total >= 0.9 && total <= 1.1;
}

/** "699.49 – 702.71", or nothing when the quote carried only one side. */
function dayRange(quote: Quote | null): string {
  if (!quote || quote.dayLow == null || quote.dayHigh == null) return "—";
  const currency = quote.currency ?? "USD";
  return `${price(quote.dayLow, currency)} – ${price(quote.dayHigh, currency)}`;
}
