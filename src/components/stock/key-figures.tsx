import { Card, CardHeader, Metric } from "@/components/ui";
import { MetricGuideBody } from "@/components/metric-guide-body";
import type { KeyFigures } from "@/lib/scoring/key-figures";
import type { ValuationMetric } from "@/lib/scoring/valuation";
import { money, multiple, percent } from "@/lib/format";

function multipleValue(item: ValuationMetric): string {
  if (item.status === "not_meaningful") return "N/M";
  if (item.value == null) return item.status === "stale" ? "—*" : "—";
  return multiple(item.value);
}

function statusHint(item: ValuationMetric): string {
  if (item.status === "not_meaningful") return item.basis;
  if (item.status === "stale") return `${item.basis}. The latest annual figure is older than eighteen months.`;
  if (item.status === "unavailable") return `Unavailable because the underlying inputs were not available. Basis: ${item.basis}.`;
  return `${item.basis}. Calculated locally from the latest annual filing and current market value.`;
}

/** Standard reference metrics plus valuation metrics that are calculated locally when needed. */
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
    valuation,
  } = figures;

  const anything = [
    fcfMargin,
    grossMargin,
    operatingMargin,
    returnOnEquity,
    eps,
    priceToFreeCashFlow,
    valuation.trailingPE.value,
    valuation.priceToSales.value,
    valuation.priceToBook.value,
    valuation.priceToFreeCashFlow.value,
    valuation.fcfYield.value,
  ].some((v) => v != null);
  if (!anything) return null;

  const from = filing ? `From ${filing}` : null;

  return (
    <Card>
      <CardHeader
        title="The standard figures"
        subtitle="Reference metrics, with valuation calculated from the same underlying data when a provider is missing a ratio"
      />

      <dl className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,160px),1fr))] gap-4 p-5">
        <Metric
          label="Trailing P/E"
          value={multipleValue(valuation.trailingPE)}
          hint={statusHint(valuation.trailingPE)}
        />
        <Metric
          label="Price / sales"
          value={multipleValue(valuation.priceToSales)}
          hint={statusHint(valuation.priceToSales)}
        />
        <Metric
          label="Price / book"
          value={multipleValue(valuation.priceToBook)}
          hint={statusHint(valuation.priceToBook)}
        />
        <Metric
          label="Price / free cash flow"
          value={multipleValue(valuation.priceToFreeCashFlow)}
          hint={statusHint(valuation.priceToFreeCashFlow)}
        />
        <Metric
          label="FCF yield"
          value={percent(valuation.fcfYield.value)}
          hint={statusHint(valuation.fcfYield)}
        />
        <Metric
          label="EV / revenue"
          value={multipleValue(valuation.enterpriseValueToRevenue)}
          hint={statusHint(valuation.enterpriseValueToRevenue)}
        />
        <Metric
          label="EV / EBITDA"
          value={multipleValue(valuation.enterpriseValueToEbitda)}
          hint={statusHint(valuation.enterpriseValueToEbitda)}
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

      {valuation.trailingPE.status === "stale" ||
      valuation.priceToSales.status === "stale" ||
      valuation.priceToBook.status === "stale" ? (
        <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-faint">
          * Valuation inputs marked stale are based on an annual filing older than eighteen months. The market value is current, but the denominator is not.
        </p>
      ) : null}
    </Card>
  );
}
