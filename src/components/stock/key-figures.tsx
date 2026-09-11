import { Card, CardHeader, Metric } from "@/components/ui";
import { MetricGuideBody } from "@/components/metric-guide-body";
import type { KeyFigures } from "@/lib/scoring/key-figures";
import { money, multiple, num, percent, signedPercent } from "@/lib/format";

/**
 * The at-a-glance figures.
 *
 * Sits below the five questions rather than above them: the questions are
 * what this app is for, and a reader who wants the sentence should meet it
 * first. But somebody comparing this company against one they looked up
 * somewhere else needs the standard numbers to be here at all, and until now
 * several of them were being stored in the database and never shown.
 *
 * Every figure opens the same five-part explanation from the shared metric
 * guide — what it is, how it is worked out, why it matters, where it
 * misleads, and where it came from — with `filing` naming the exact document.
 * Anything that cannot be computed says so rather than showing a zero.
 */
export function KeyFiguresPanel({
  figures,
  currency,
  filing = null,
}: {
  figures: KeyFigures;
  currency: string;
  /** "Apple's FY2025 10-K, filed Oct 31, 2025", when known. */
  filing?: string | null;
}) {
  const {
    freeCashFlow, fcfMargin, grossMargin, operatingMargin, netMargin,
    returnOnEquity, returnOnAssets, eps, interestCoverage,
    shareCountChange, priceToFreeCashFlow,
  } = figures;

  // Nothing computable means nothing to show. An empty grid of dashes makes a
  // claim about the company; an absent panel does not.
  const anything = [
    freeCashFlow, grossMargin, operatingMargin, netMargin,
    returnOnEquity, returnOnAssets, eps, interestCoverage,
    shareCountChange,
  ].some((v) => v != null);
  if (!anything) return null;

  const from = filing ? `From ${filing}` : null;

  return (
    <Card>
      <CardHeader
        title="The standard figures"
        subtitle="What it earns, what it keeps, and what it costs to run — all from the same filing"
      />

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-4 p-5">
        {/* Leads the panel because it is the number most fundamental analysis
            is built on, and the one this app was not computing at all. */}
        <Metric
          label="Free cash flow"
          value={freeCashFlow == null ? "—" : money(freeCashFlow, currency)}
          tone={freeCashFlow == null ? undefined : freeCashFlow > 0 ? "up" : "down"}
          hint={<MetricGuideBody id="free-cash-flow" filing={from} />}
          size="lg"
        />
        <Metric
          label="Earnings per share"
          value={eps == null ? "—" : money(eps, currency)}
          hint={<MetricGuideBody id="eps" filing={from} />}
        />
        <Metric
          label="Free cash flow margin"
          value={percent(fcfMargin)}
          hint={<MetricGuideBody id="fcf-margin" filing={from} />}
        />
        <Metric
          label="Price to free cash flow"
          value={multiple(priceToFreeCashFlow)}
          hint={<MetricGuideBody id="price-to-fcf" />}
        />
      </dl>

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,150px),1fr))] gap-4 border-t border-border bg-surface-2/40 px-5 py-3.5">
        <Metric label="Gross margin" value={percent(grossMargin)} size="sm"
          hint={<MetricGuideBody id="gross-margin" filing={from} />} />
        <Metric label="Operating margin" value={percent(operatingMargin)} size="sm"
          hint={<MetricGuideBody id="operating-margin" filing={from} />} />
        <Metric label="Profit margin" value={percent(netMargin)} size="sm"
          hint={<MetricGuideBody id="net-margin" filing={from} />} />
        <Metric label="Return on equity" value={percent(returnOnEquity)} size="sm"
          hint={<MetricGuideBody id="roe" filing={from} />} />
        <Metric label="Return on assets" value={percent(returnOnAssets)} size="sm"
          hint={<MetricGuideBody id="roa" filing={from} />} />
        <Metric
          label="Interest cover"
          value={
            interestCoverage == null
              ? "no debt costs"
              : `${num(interestCoverage, 1)}×`
          }
          size="sm"
          tone={interestCoverage != null && interestCoverage < 1.5 ? "down" : undefined}
          hint={
            <MetricGuideBody
              id="interest-cover"
              note="Under about 1.5 leaves very little room, which is why it is marked down here."
              filing={from}
            />
          }
        />
        <Metric
          label="Share count"
          value={shareCountChange == null ? "—" : signedPercent(shareCountChange, 1)}
          size="sm"
          // Down is good here, which is the opposite of most figures on the
          // page — so the tone is inverted deliberately rather than by slip.
          tone={
            shareCountChange == null
              ? undefined
              : shareCountChange < 0
                ? "up"
                : shareCountChange > 0
                  ? "down"
                  : "muted"
          }
          hint={
            <MetricGuideBody
              id="share-count"
              note="Shown as the change against last year: falling means shares were bought back, rising means new shares were issued."
              filing={from}
            />
          }
        />
      </dl>
    </Card>
  );
}
