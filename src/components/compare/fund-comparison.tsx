import Link from "next/link";
import type { ReactNode } from "react";
import { Badge, Card, CardHeader } from "@/components/ui";
import { calendarDate, count, money, percent, price as fmtPrice, signedPercent } from "@/lib/format";
import { leadingIndexes, type FundComparison, type FundFacts } from "@/lib/etf/compare-funds";
import { cn } from "@/lib/utils";

/**
 * Funds side by side, on the rows a fund can answer.
 *
 * The company table below this one asks about revenue, margins and debt, and
 * a fund has none of those, so comparing three ETFs filled a screen with
 * dashes. This asks what a fund is actually chosen on: cost, income, spread,
 * and record.
 *
 * A mark says which fund leads a row, because that is the question a reader
 * came with. It is a statement about the figure and nothing more — the
 * cheapest fund, the highest yield and the strongest past return are rarely
 * the same fund, and picking between those is the reader's call, not this
 * table's. So there is no overall winner here, and no "best for you": those
 * would be advice, and this app does not give it.
 */

interface FundRow {
  label: string;
  hint?: string;
  /**
   * Which end of the row leads, where that is a fact rather than a taste.
   *
   * Concentration has no direction — holding ten names is a different bet
   * from holding two hundred, not a worse one — so that row leaves it unset
   * and is never marked.
   */
  leads?: { direction: "highest" | "lowest"; word: string };
  /** The figure the leader is decided on. */
  value: (f: FundFacts) => number | null;
  render: (f: FundFacts) => ReactNode;
}

const NONE = <span className="text-faint">—</span>;

function returnOf(f: FundFacts, label: string) {
  return f.returns.find((r) => r.label === label);
}

/** A return, with the pace it works out at under it where the window is years. */
function ReturnCell({ f, label }: { f: FundFacts; label: string }) {
  const window = returnOf(f, label);
  if (!window || window.total == null) return NONE;

  return (
    <div>
      <span className={cn("tnum font-medium", window.total >= 0 ? "text-up" : "text-down")}>
        {signedPercent(window.total, 1)}
      </span>
      {window.perYear != null && (window.years == null || window.years > 1) && (
        <span className="tnum mt-0.5 block text-xs text-muted">
          {signedPercent(window.perYear, 1)} a year
        </span>
      )}
      {/* Whole history is a different length for each fund, so it says which. */}
      {window.years == null && window.from && (
        <span className="block text-xs text-faint">from {calendarDate(window.from)}</span>
      )}
    </div>
  );
}

const RETURN_LABELS = ["1 year", "3 years", "5 years", "10 years", "Whole history"];

function rowsFor(): FundRow[] {
  const dated = (iso: string | null) => (iso ? Date.parse(`${iso}T00:00:00Z`) : null);

  return [
    {
      label: "Price",
      // Per-unit price says nothing about which fund is better value — a fund
      // can split its units tomorrow — so nothing leads this row.
      value: () => null,
      render: (f) =>
        f.price == null ? NONE : (
          <span className="tnum font-medium">{fmtPrice(f.price, f.currency ?? "USD")}</span>
        ),
    },
    {
      label: "Fee, a year",
      hint: "Charged as a share of what you hold, taken out of the fund's value rather than billed.",
      leads: { direction: "lowest", word: "Cheapest" },
      value: (f) => f.fee,
      render: (f) =>
        f.fee == null ? (
          NONE
        ) : (
          <div>
            <span className="tnum font-medium">{percent(f.fee, 2)}</span>
            {f.feeSource && <span className="block text-xs text-muted">{f.feeSource}</span>}
          </div>
        ),
    },
    {
      label: "Yield, last 12 months",
      hint:
        "The payments actually made over the last twelve months against today's price. Computed the same way for every fund here, which is why it can differ from the yield a manager advertises.",
      leads: { direction: "highest", word: "Highest" },
      value: (f) => f.trailingYield,
      render: (f) =>
        f.trailingYield == null ? (
          NONE
        ) : (
          <div>
            <span className="tnum font-medium">{percent(f.trailingYield, 2)}</span>
            <span className="block text-xs text-muted">
              {f.paymentsCounted} payment{f.paymentsCounted === 1 ? "" : "s"}
            </span>
          </div>
        ),
    },
    {
      label: "Pays",
      value: () => null,
      render: (f) => (f.frequency ? <span>{f.frequency}</span> : NONE),
    },
    {
      label: "Record starts",
      hint:
        "The fund's launch date where its manager publishes one, otherwise the earliest price on record — which is usually within weeks of the launch.",
      leads: { direction: "lowest", word: "Longest record" },
      value: (f) => dated(f.launched ?? f.firstPriced),
      render: (f) => {
        const date = f.launched ?? f.firstPriced;
        if (!date) return NONE;

        /*
          A launch date and the prices can be a long way apart — XEI launched
          in April 2011 and the price history on record starts in January
          2012. Saying only the launch date would make the whole-history
          return look like it covered nine months it does not.
        */
        const pricesLater =
          f.launched != null &&
          f.firstPriced != null &&
          Date.parse(f.firstPriced) - Date.parse(f.launched) > 120 * 86_400_000;

        return (
          <div>
            <span className="font-medium">{calendarDate(date)}</span>
            {!f.launched && <span className="block text-xs text-muted">first price on record</span>}
            {pricesLater && (
              <span className="block text-xs text-muted">
                prices from {calendarDate(f.firstPriced)}
              </span>
            )}
          </div>
        );
      },
    },
    {
      label: "Holdings",
      hint: "Positions held, cash left out, where the manager publishes a count.",
      leads: { direction: "highest", word: "Most" },
      value: (f) => f.holdingCount,
      render: (f) => (f.holdingCount == null ? NONE : <span className="tnum">{count(f.holdingCount)}</span>),
    },
    {
      label: "Top 10 weight",
      hint:
        "How much of the fund sits in its ten largest positions. Concentrated is not worse than spread — it is a different bet, which is why no fund leads this row.",
      value: (f) => f.topTenWeight,
      render: (f) => (f.topTenWeight == null ? NONE : <span className="tnum">{percent(f.topTenWeight, 1)}</span>),
    },
    {
      label: "Fund size",
      hint: "The whole fund's net assets, across every unit class, as its manager reports it.",
      leads: { direction: "highest", word: "Largest" },
      value: (f) => f.netAssets,
      render: (f) =>
        f.netAssets == null ? NONE : (
          <span className="tnum">{money(f.netAssets, f.netAssetsCurrency ?? f.currency ?? "USD")}</span>
        ),
    },
    ...RETURN_LABELS.map((label): FundRow => ({
      label,
      leads: { direction: "highest", word: "Highest" },
      value: (f) => returnOf(f, label)?.total ?? null,
      render: (f) => <ReturnCell f={f} label={label} />,
    })),
  ];
}

export function FundComparisonCard({ comparison }: { comparison: FundComparison }) {
  const { funds, asOf, mixedCurrency, mixedBasis } = comparison;
  if (funds.length < 2) return null;

  const rows = rowsFor();
  const returnsShown = funds.some((f) => f.returns.some((r) => r.total != null));

  return (
    <Card as="section">
      <CardHeader
        title="Fund against fund"
        subtitle="What each one charges, what it pays, and what it has returned — the questions the table below cannot ask a fund"
      />

      <div className="scroll-x">
        <table className="w-full min-w-[40rem] text-sm">
          <caption className="sr-only">
            {funds.map((f) => f.symbol).join(", ")} compared on cost, income and past returns
          </caption>
          <thead>
            <tr className="border-b border-border bg-surface-2/50 text-left">
              <th scope="col" className="sticky left-0 z-10 bg-surface-2/50 px-5 py-3 text-xs font-medium text-muted">
                Metric
              </th>
              {funds.map((f) => (
                <th key={f.symbol} scope="col" className="px-4 py-3 text-left">
                  <Link
                    href={`/stock/${encodeURIComponent(f.symbol)}`}
                    className="block transition-colors hover:text-accent"
                  >
                    <span className="text-base font-bold tracking-tight">{f.symbol}</span>
                    <span className="block max-w-[12rem] truncate text-xs font-normal text-muted">
                      {f.name}
                    </span>
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const leaders = row.leads
                ? leadingIndexes(funds.map(row.value), row.leads.direction)
                : [];

              return (
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
                  {funds.map((f, i) => (
                    <td key={f.symbol} className="px-4 py-2.5 align-top">
                      <div className="flex items-start gap-2">
                        {row.render(f)}
                        {leaders.includes(i) && row.leads && (
                          <Badge tone="accent">{row.leads.word}</Badge>
                        )}
                      </div>
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="space-y-2 border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
        {returnsShown && asOf && (
          <p>
            Every return is measured to <strong className="font-medium">{calendarDate(asOf)}</strong>,
            the last date all of these funds have a price for, so each covers the same stretch of
            market. A window longer than a fund has existed is left blank rather than shortened.
          </p>
        )}

        {mixedBasis ? (
          <p className="text-fair-fg">
            These returns are not on the same basis: one of these price histories already has
            distributions reinvested and another does not, because different providers answered
            for them. The gap between them therefore includes an income stream as well as
            performance.
          </p>
        ) : (
          <p>
            Returns follow the share price only — distributions are not counted, which understates
            every fund here, and understates the highest-yielding one most.
          </p>
        )}

        {mixedCurrency && (
          <p>
            These funds are priced in different currencies. Each return is in the fund&apos;s own
            currency and leaves out the change in the exchange rate between them.
          </p>
        )}

        <p>
          A mark says which fund leads that row — nothing more. The cheapest fund, the highest
          yield and the strongest past record are rarely the same one, and past returns are a
          record rather than a forecast. A blank means the figure was not published to a source
          this page reads.
        </p>
      </div>
    </Card>
  );
}
