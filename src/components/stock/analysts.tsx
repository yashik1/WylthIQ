import { Card, CardHeader, Metric } from "@/components/ui";
import { type AnalystView, targetGap } from "@/lib/signals/analysts";
import { count, percent, price as fmtPrice } from "@/lib/format";
import { LocalTime } from "@/components/local-time";

/**
 * What analysts have published, as a distribution rather than a verdict.
 *
 * The hardest panel in this section to write without crossing the line. Every
 * other site reduces this to one word — "Buy" — and that word is a
 * recommendation. Printed here it would read as WylthIQ's recommendation,
 * whoever it is attributed to, because a lone verdict in a page's own typeface
 * is the page speaking.
 *
 * So the distribution is the display. "Of 44 analysts, 31 say buy and 11 say
 * hold" is a countable fact about what other people published. It also carries
 * the information the consensus word destroys: whether they agree. Forty-four
 * analysts split evenly across buy and sell is a completely different state of
 * the world from forty-four unanimous ones, and both average out to the same
 * bland middle.
 *
 * Rating words appear here only inside attributed counts, never as an
 * assertion, which is the rule market-expects.test.tsx enforces on the rest of
 * the section.
 */

/** The five buckets, widest agreement first, with the label a reader sees. */
const BUCKETS = [
  { key: "strongBuy", label: "Strong buy", tone: "bg-good" },
  { key: "buy", label: "Buy", tone: "bg-good/60" },
  { key: "hold", label: "Hold", tone: "bg-unknown" },
  { key: "sell", label: "Sell", tone: "bg-poor/60" },
  { key: "strongSell", label: "Strong sell", tone: "bg-poor" },
] as const;

export function AnalystRatings({
  view,
  currentPrice,
  currency,
}: {
  view: AnalystView;
  currentPrice: number | null;
  currency: string;
}) {
  const gap = targetGap(view, currentPrice);
  const counts = BUCKETS.map((b) => ({ ...b, n: view[b.key] })).filter((b) => b.n > 0);

  return (
    <Card>
      <CardHeader
        title="What analysts have published"
        subtitle={
          <>
            Opinions from {count(view.total)} analysts covering this company
            {view.asOf && (
              <>
                , as of <LocalTime value={`${view.asOf}T00:00:00Z`} mode="date" />
              </>
            )}
            . Their views, not this site&apos;s.
          </>
        }
      />

      <p className="max-w-3xl px-5 pt-4 text-[0.9375rem] leading-relaxed text-muted-strong">
        Of <span className="font-semibold text-foreground">{count(view.total)}</span> analysts
        publishing on this company,{" "}
        {counts.map((b, i) => (
          <span key={b.key}>
            {i > 0 && (i === counts.length - 1 ? " and " : ", ")}
            <span className="font-semibold text-foreground">{b.n}</span> say{" "}
            {b.label.toLowerCase()}
          </span>
        ))}
        . Analysts are paid to publish a view and are wrong often; the split above says how much
        they agree with each other, which is the part a single headline rating hides.
      </p>

      {/* A proportion bar rather than five numbers, so the balance reads at a
          glance. Every segment carries its label as text too — colour alone
          would say nothing to a reader who cannot separate the hues. */}
      <div className="px-5 pt-4">
        <div className="flex h-2 w-full overflow-hidden">
          {counts.map((b) => (
            <div
              key={b.key}
              className={b.tone}
              style={{ width: `${(b.n / view.total) * 100}%` }}
              aria-hidden
            />
          ))}
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
          {counts.map((b) => (
            <div key={b.key} className="flex items-center gap-1.5">
              <span className={`inline-block size-2 ${b.tone}`} aria-hidden />
              <dt className="text-muted">{b.label}</dt>
              <dd className="tnum font-semibold">{b.n}</dd>
            </div>
          ))}
        </dl>
      </div>

      {view.targetPrice != null && (
        <dl className="mt-4 grid grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-3 border-t border-border bg-surface-2/40 px-5 py-3.5 sm:grid-cols-3">
          <Metric
            label="Average price target"
            value={fmtPrice(view.targetPrice, currency)}
            hint="The mean of the price targets these analysts have published. An average of forecasts, not a measurement of anything."
            size="sm"
          />
          <Metric
            label="Against today's price"
            value={gap == null ? "—" : `${gap > 0 ? "+" : ""}${percent(gap)}`}
            hint="How far the average target sits from the current price. Deliberately not called upside — the gap is a fact about what analysts published, not a claim the price will move to meet it."
            size="sm"
          />
          <Metric
            label="Range of targets"
            value={
              view.targetLow != null && view.targetHigh != null
                ? `${fmtPrice(view.targetLow, currency)} – ${fmtPrice(view.targetHigh, currency)}`
                : "not published"
            }
            hint="The spread between the most and least optimistic target. A wide range means the average conceals real disagreement."
            size="sm"
          />
        </dl>
      )}

      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-faint">
        Published by {view.source}. Analyst coverage skews towards larger companies and towards
        optimism — sell ratings are rare across the whole market, so a company with none is
        ordinary rather than endorsed.
      </p>
    </Card>
  );
}
