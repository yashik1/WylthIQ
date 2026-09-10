import { Card, CardHeader, Metric } from "@/components/ui";
import { count, percent, price } from "@/lib/format";
import type { EtfProfile } from "@/lib/providers/alphavantage";
import type { Quote } from "@/lib/providers/types";

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
export function FundFacts({ profile, quote }: { profile: EtfProfile; quote: Quote | null }) {
  const range = dayRange(quote);

  return (
    <Card>
      <CardHeader
        title="What it costs, and how it trades"
        subtitle="The fee is the one figure under your control — it is charged whether the fund rises or falls, every year you hold it."
      />

      {profile.leveraged && (
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

      <dl className="grid grid-cols-2 gap-x-4 gap-y-4 px-5 py-4 sm:grid-cols-4">
        <Metric
          label="Expense ratio"
          value={profile.expenseRatio == null ? "—" : percent(profile.expenseRatio, 2)}
          size="lg"
          hint="Charged annually as a share of what you hold, taken out of the fund's value rather than billed. On £10,000 held for ten years, the difference between 0.03% and 0.75% is roughly £750 before any effect on compounding."
        />
        <Metric
          label="Dividend yield"
          value={profile.dividendYield == null ? "—" : percent(profile.dividendYield, 2)}
          size="lg"
        />
        <Metric label="Launched" value={launched(profile.inceptionDate)} size="lg" />
        <Metric
          label="Turnover"
          value={profile.turnover == null ? "—" : percent(profile.turnover, 0)}
          size="lg"
          hint="How much of the portfolio was replaced over a year. A low figure is what an index fund should show; a high one means trading costs the expense ratio does not include."
        />
      </dl>

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

      {sectorsAreComplete(profile.sectors) && (
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

      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-faint">
        Figures on this card come from Alpha Vantage; the holdings below come from the
        fund&rsquo;s own SEC filing. Check the fund&rsquo;s factsheet before acting on a fee
        — this one is a provider&rsquo;s figure, not the prospectus.
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
function launched(date: string | null): string {
  if (!date) return "—";
  const [y, m] = date.split("-").map(Number);
  if (!y || !m) return date;
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    year: "numeric",
  });
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
