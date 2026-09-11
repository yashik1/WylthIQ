import type { Metadata } from "next";
import Link from "next/link";
import { CompareChart } from "@/components/compare-chart";
import { Badge, Card, CardHeader, Change, NotReported, PageHeader, RatingBadge } from "@/components/ui";
import { loadComparison, MAX_COMPARE, parseSymbols, type CompareItem } from "@/lib/compare";
import { money, multiple, percent, price as fmtPrice } from "@/lib/format";
import { describeAgainstPeers, median, type PeerFigures } from "@/lib/peer-context";
import { ASSET_CLASS_LABEL } from "@/lib/instruments";
import type { Rating } from "@/lib/scoring/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Compare stocks and ETFs",
  description:
    "Compare companies and funds side by side — financial health, valuation, growth and performance.",
  // `?symbols=` makes a fresh URL for every pair anybody has ever compared.
  alternates: { canonical: "/compare" },
};

const SUGGESTIONS = [
  { label: "Big tech", symbols: "AAPL,MSFT,GOOGL,NVDA" },
  { label: "Canadian banks", symbols: "RY,TD,BNS,BMO" },
  { label: "Index ETFs", symbols: "SPY,QQQ,VTI" },
  { label: "Retail", symbols: "WMT,COST,TGT" },
];

function healthRating(score: number | null | undefined): Rating {
  if (score == null) return "unknown";
  if (score >= 7.5) return "good";
  if (score >= 5) return "fair";
  return "poor";
}

export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  const params = await searchParams;
  const symbols = parseSymbols(params.symbols);
  const items = symbols.length > 0 ? await loadComparison(symbols) : [];
  const chartable = items.filter((i) => !i.error).map((i) => i.symbol);

  return (
    <div className="space-y-5">
      <PageHeader eyebrow="Side by side" title="Compare">
        <p>
          Put up to {MAX_COMPARE} companies, funds, commodities or coins next to each
          other — health, valuation, growth and performance.
        </p>
      </PageHeader>

      <Card>
        {/*
          The same grid the backtest form uses: fields take the row, the submit
          button sits flush against the card's own padding.

          This field used to be capped at `sm:max-w-md`, on the reasoning that
          four tickers is about thirty characters and a 1099px box for thirty
          characters is absurd. That is true on its own terms, and it produced
          something worse: on a 1304px card the controls stopped after 570px
          and left 734px of empty panel — 56% of a card with nothing in it,
          while the identically-shaped bar on /backtest ran edge to edge. A
          field wider than its content reads as a search box; a card mostly
          empty reads as a layout that broke.
        */}
        <form
          method="get"
          className="grid grid-cols-[minmax(0,1fr)] gap-3 p-5 @md:grid-cols-[minmax(0,1fr)_auto]"
        >
          <div className="min-w-0">
            <label htmlFor="symbols" className="text-xs text-muted">
              Tickers, separated by commas
            </label>
            <input
              id="symbols"
              name="symbols"
              defaultValue={symbols.join(", ")}
              placeholder="AAPL, MSFT, SPY"
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted/60"
            />
          </div>
          <button
            type="submit"
            className="h-fit self-end rounded-lg border border-transparent bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
          >
            Compare
          </button>
        </form>

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-5 py-3">
          <span className="text-xs text-muted">Try:</span>
          {SUGGESTIONS.map((s) => (
            <Link
              key={s.label}
              href={`/compare?symbols=${encodeURIComponent(s.symbols)}`}
              className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:border-accent hover:text-accent"
            >
              {s.label}
            </Link>
          ))}
        </div>
      </Card>

      {items.length === 0 ? (
        <Card>
          <div className="px-6 py-12 text-center">
            <p className="text-sm font-medium">Nothing to compare yet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted">
              Enter two or more tickers above, or pick one of the suggestions.
            </p>
          </div>
        </Card>
      ) : (
        <>
          {chartable.length > 0 && (
            <Card>
              <CardHeader
                title="Relative performance"
                subtitle="Rebased so every symbol starts at 0%"
              />
              <div className="p-5">
                <CompareChart symbols={chartable} />
              </div>
            </Card>
          )}

          <Card>
            <CardHeader title="Side by side" subtitle="Latest annual figures from each company's filings" />
            <ComparisonTable items={items} />
          </Card>

          <PeerContextCard items={items} />

          {items.some(
            (i) =>
              i.assetClass === "crypto" ||
              i.assetClass === "commodity" ||
              i.assetClass === "future",
          ) && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold">
                Why crypto, commodities and futures show no financial scores
              </h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
                There is no company behind them. Bitcoin has no revenue, gold owes nothing,
                and a futures contract is an agreement rather than a business — so the
                profitability, debt and accounting scores are inapplicable here rather than
                missing. Their price performance above is directly comparable with any share
                or fund; every row below it is not.
              </p>
            </Card>
          )}

          {items.some((i) => i.type === "etf") && (
            <Card className="p-5">
              <h2 className="text-sm font-semibold">Why funds show no financial scores</h2>
              <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">
                An ETF is a basket of other holdings, not a business. It has no revenue, no
                balance sheet and files no annual report, so profitability, debt and accounting
                scores have nothing to measure. Comparing a fund on price performance is
                meaningful; comparing it on profit margin is not, so those cells are left blank
                rather than filled with zeros.
              </p>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Why a row has no health score.
 *
 * "not reported" is a statement about a company that filed something and left
 * a figure out. Applied to Bitcoin it is simply false — nothing was reported
 * because nothing reports — and the distinction is the whole difference
 * between missing data and an inapplicable question.
 */
function noScoreReason(i: CompareItem): string {
  switch (i.assetClass) {
    case "crypto":
      return "n/a — no company behind it";
    case "commodity":
      return "n/a for commodities";
    case "future":
      return "n/a for futures";
    case "etf":
      return "n/a for funds";
    default:
      return i.type === "etf" ? "n/a for funds" : "not reported";
  }
}

type ComparisonRow = {
  label: string;
  hint?: string;
  render: (item: CompareItem) => React.ReactNode;
  /** The row's figure as a number, for the median column. */
  value?: (item: CompareItem) => number | null;
  format?: (value: number) => string;
};

function metricRow(
  label: string,
  hint: string | undefined,
  pick: (item: CompareItem) => number | null,
  kind: "percent" | "multiple",
): ComparisonRow {
  const format = (value: number | null) => (kind === "percent" ? percent(value) : multiple(value));
  return {
    label,
    hint,
    value: pick,
    format,
    render: (i) => <span className="tnum">{format(pick(i))}</span>,
  };
}

function peerFigures(item: CompareItem): PeerFigures {
  return {
    symbol: item.symbol,
    healthScore: item.report?.score ?? null,
    revenueGrowth: item.metrics.revenueGrowth,
    operatingMargin: item.metrics.operatingMargin,
    netMargin: item.metrics.netMargin,
    peRatio: item.metrics.peRatio,
    debtToEquity: item.metrics.debtToEquity,
  };
}

/**
 * Where the first company entered sits against the rest, in plain sentences.
 * Companies only: a fund or a coin has no margins to describe.
 */
function PeerContextCard({ items }: { items: CompareItem[] }) {
  const [subject, ...rest] = items;
  const others = rest.filter((item) => item.report && !item.error);
  if (!subject?.report || others.length === 0) return null;

  const sentences = describeAgainstPeers(peerFigures(subject), others.map(peerFigures));
  if (sentences.length === 0) return null;

  return (
    <Card className="p-5">
      <h2 className="text-sm font-semibold">How {subject.symbol} compares with the others</h2>
      <ul className="mt-2 space-y-1.5">
        {sentences.map((sentence) => (
          <li key={sentence} className="max-w-3xl text-sm leading-relaxed text-muted-strong">
            {sentence}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        Measured against the other companies entered, from each one&apos;s latest annual filing.
        A difference describes the companies; it does not rank them.
      </p>
    </Card>
  );
}

function ComparisonTable({ items }: { items: CompareItem[] }) {
  const [first, ...rest] = items;
  const others = rest.filter((item) => !item.error);
  // A median of one company is just that company, so the column needs two.
  const showMedian = Boolean(first?.report) && others.filter((item) => item.report).length >= 2;

  const rows: ComparisonRow[] = [
    {
      label: "Type",
      render: (i) =>
        i.assetClass === "crypto" ||
        i.assetClass === "commodity" ||
        i.assetClass === "future" ? (
          <Badge tone="accent">{ASSET_CLASS_LABEL[i.assetClass]}</Badge>
        ) : i.type === "etf" ? (
          <Badge tone="accent">Fund / ETF</Badge>
        ) : i.type === "stock" ? (
          <Badge>Company</Badge>
        ) : (
          <span className="text-muted">—</span>
        ),
    },
    {
      label: "Price",
      render: (i) =>
        i.quote?.price != null ? (
          <div>
            {/* The quote's own currency. Without it wheat renders as "$695.50"
                rather than "695.50¢", overstating a bushel a hundredfold. */}
            <span className="tnum font-medium">
              {fmtPrice(i.quote.price, i.quote.currency ?? "USD")}
            </span>
            <Change
              value={i.quote.change}
              percent={i.quote.changePercent}
              className="ml-2 text-xs"
            />
          </div>
        ) : (
          <NotReported />
        ),
    },
    {
      label: "Health score",
      hint: "Composite of profitability, growth, debt and accounting quality.",
      value: (i) => i.report?.score ?? null,
      format: (v) => `${v.toFixed(1)}/10`,
      render: (i) =>
        i.report?.score != null ? (
          <RatingBadge
            rating={healthRating(i.report.score)}
            label={`${i.report.score.toFixed(1)}/10`}
          />
        ) : (
          <span className="text-xs text-faint">{noScoreReason(i)}</span>
        ),
    },
    {
      label: "Market value",
      render: (i) => <span className="tnum">{money(i.marketCap)}</span>,
    },
    { label: "Revenue", render: (i) => <span className="tnum">{money(i.metrics.revenue)}</span> },
    { label: "Profit", render: (i) => <span className="tnum">{money(i.metrics.netIncome)}</span> },
    metricRow("Revenue growth", "Change in sales versus the prior year.", (i) => i.metrics.revenueGrowth, "percent"),
    metricRow("Gross margin", "Share of sales left after the direct cost of producing them.", (i) => i.metrics.grossMargin, "percent"),
    metricRow("Operating margin", "Share of sales left after running the business, before interest and tax.", (i) => i.metrics.operatingMargin, "percent"),
    metricRow("Profit margin", "Profit kept from each dollar of sales.", (i) => i.metrics.netMargin, "percent"),
    metricRow("Free cash flow margin", "Cash left after capital spending, as a share of sales.", (i) => i.metrics.fcfMargin, "percent"),
    metricRow("Return on equity", "Profit against the owners' stake in the company.", (i) => i.metrics.returnOnEquity, "percent"),
    metricRow(
      "Return on invested capital (approx.)",
      "Operating profit after tax against equity plus debt, less cash. Cash here excludes short-term investments, so this runs low for cash-rich companies.",
      (i) => i.metrics.returnOnInvestedCapital,
      "percent",
    ),
    metricRow("P/E ratio", "Price paid per dollar of annual profit.", (i) => i.metrics.peRatio, "multiple"),
    metricRow(
      "EV / EBITDA (approx.)",
      "Market value plus debt less cash, against operating profit before depreciation. Cash excludes short-term investments, so this runs high for cash-rich companies.",
      (i) => i.metrics.evToEbitda,
      "multiple",
    ),
    metricRow("Price to book", undefined, (i) => i.metrics.pbRatio, "multiple"),
    metricRow("Debt to equity", "Total liabilities compared with owners' stake.", (i) => i.metrics.debtToEquity, "multiple"),
    {
      label: "Piotroski F-Score",
      hint: "Nine checks of financial strength. Higher is stronger.",
      value: (i) => (i.report?.piotroski.maxScore ? i.report.piotroski.score : null),
      format: (v) => v.toFixed(1),
      render: (i) =>
        i.report?.piotroski.maxScore
          ? `${i.report.piotroski.score}/${i.report.piotroski.maxScore}`
          : <NotReported />,
    },
    {
      label: "Bankruptcy risk",
      hint: "Altman Z-Score zone.",
      render: (i) =>
        i.report?.altman.value ? (
          <span className="capitalize">{i.report.altman.value.zone}</span>
        ) : (
          <span className="text-xs text-faint">
            {i.sector === "financial"
              ? "n/a for banks"
              : i.type === "etf"
                ? "n/a for funds"
                : "not reported"}
          </span>
        ),
    },
  ];

  return (
    <div className="scroll-x">
      <table className="w-full min-w-[42rem] text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2/50">
            <th
              scope="col"
              className="sticky left-0 z-10 bg-surface px-5 py-3 text-left text-xs font-medium text-muted"
            >
              Metric
            </th>
            {items.map((i) => (
              <th key={i.symbol} scope="col" className="px-4 py-3 text-left">
                <Link
                  href={`/stock/${encodeURIComponent(i.symbol)}`}
                  className="block transition-colors hover:text-accent"
                >
                  <span className="text-base font-bold tracking-tight">{i.symbol}</span>
                  <span className="block max-w-[12rem] truncate text-xs font-normal text-muted">
                    {i.name}
                  </span>
                </Link>
              </th>
            ))}
            {showMedian && (
              <th scope="col" className="px-4 py-3 text-left">
                <span className="text-sm font-semibold">Median of the rest</span>
                <span className="block text-xs font-normal text-muted">excluding {first.symbol}</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.some((i) => i.error) && (
            <tr>
              <td className="px-5 py-2 text-xs text-muted">Status</td>
              {items.map((i) => (
                <td key={i.symbol} className="px-4 py-2 text-xs text-poor">
                  {i.error ?? "OK"}
                </td>
              ))}
              {showMedian && <td />}
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.label} className="group transition-colors hover:bg-surface-2/60">
              <th
                scope="row"
                className="sticky left-0 z-10 bg-surface px-5 py-2.5 text-left text-xs font-medium text-muted transition-colors group-hover:bg-surface-2/60"
                title={row.hint}
              >
                {row.label}
                {row.hint && (
                  <>
                    <span aria-hidden className="ml-1 cursor-help opacity-60">ⓘ</span>
                    <span className="sr-only">{row.hint}</span>
                  </>
                )}
              </th>
              {items.map((i) => (
                <td key={i.symbol} className="px-4 py-2.5">
                  {row.render(i)}
                </td>
              ))}
              {showMedian && (
                <td className="tnum px-4 py-2.5 text-muted-strong">
                  {row.value && row.format
                    ? (() => {
                        const value = median(others.map(row.value));
                        return value == null ? "—" : row.format(value);
                      })()
                    : ""}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
