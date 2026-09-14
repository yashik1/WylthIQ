import { Card, CardHeader, Metric } from "@/components/ui";
import { MetricGuideBody } from "@/components/metric-guide-body";
import type { KeyFigures } from "@/lib/scoring/key-figures";
import { money, multiple, percent } from "@/lib/format";

/**
 * Standard reference metrics that are not already presented in the Five
 * Questions. The questions own the core operating evidence; this panel adds
 * useful comparison metrics without printing the same numbers again.
 */
export function KeyFiguresPanel({
  figures,
  currency,
  filing = null,
}: {
  figures: KeyFigures;
  currency: string;
  filing?: string | null;
}) {
  const {
    fcfMargin,
    grossMargin,
    operatingMargin,
    returnOnEquity,
    eps,
    priceToFreeCashFlow,
  } = figures;

  const anything = [
    fcfMargin,
    grossMargin,
    operatingMargin,
    returnOnEquity,
    eps,
    priceToFreeCashFlow,
  ].some((v) => v != null);
  if (!anything) return null;

  const from = filing ? `From ${filing}` : null;

  return (
    <Card>
      <CardHeader
        title="The standard figures"
        subtitle="Supplemental reference metrics not already covered by the five questions"
      />

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-4 p-5">
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
        <Metric
          label="Gross margin"
          value={percent(grossMargin)}
          hint={<MetricGuideBody id="gross-margin" filing={from} />}
        />
        <Metric
          label="Operating margin"
          value={percent(operatingMargin)}
          hint={<MetricGuideBody id="operating-margin" filing={from} />}
        />
        <Metric
          label="Return on equity"
          value={percent(returnOnEquity)}
          hint={<MetricGuideBody id="roe" filing={from} />}
        />
      </dl>
    </Card>
  );
}
