import Link from "next/link";
import { MeterBar } from "@/components/ui";
import { calendarDate, money, percent } from "@/lib/format";
import type { BrokerHoldingRow, BrokerSummary } from "@/lib/portfolio/brokers";
import { cn } from "@/lib/utils";

/**
 * What is held at each broker, and how much.
 *
 * One panel per broker — and one for what was typed in by hand — with its
 * value, its share of the portfolio and its gain on cost, then every company
 * held there with the shares, the value and that company's share of the
 * broker. Amounts are in one currency, the same as the charts, so a broker's
 * holdings add up and the brokers can be compared.
 */

/** Rows shown before the rest fold away, so a broker with forty holdings does not push everything else down. */
const SHOWN = 8;

function signedMoney(value: number, currency: string): string {
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${money(Math.abs(value), currency)}`;
}

function signedPercent(value: number | null): string {
  if (value == null) return "—";
  return `${value > 0 ? "+" : value < 0 ? "−" : ""}${Math.abs(value * 100).toFixed(1)}%`;
}

function Rows({ rows, currency }: { rows: BrokerHoldingRow[]; currency: string }) {
  return (
    <>
      {rows.map((row) => (
        <tr key={row.key} className="align-top">
          <th scope="row" className="py-1.5 pr-2 text-left font-normal">
            <Link href={`/stock/${encodeURIComponent(row.symbol)}`} className="font-semibold hover:text-accent">
              {row.symbol}
            </Link>
            {row.name && <span className="block truncate text-xs text-muted">{row.name}</span>}
          </th>
          <td className="tnum py-1.5 pr-2 text-right">
            {row.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}
          </td>
          <td className="tnum py-1.5 pr-2 text-right">
            {row.value != null ? money(row.value, currency) : <span className="text-xs text-faint">no price</span>}
          </td>
          <td className="tnum py-1.5 text-right text-muted">{row.share != null ? percent(row.share, 0) : "—"}</td>
        </tr>
      ))}
    </>
  );
}

function HoldingsTable({ rows, currency, caption }: { rows: BrokerHoldingRow[]; currency: string; caption: string }) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col />
        <col className="w-[3.75rem]" />
        <col className="w-[4.75rem]" />
        <col className="w-[3rem]" />
      </colgroup>
      <tbody className="divide-y divide-border">
        <Rows rows={rows} currency={currency} />
      </tbody>
    </table>
  );
}

function BrokerPanel({ broker, currency }: { broker: BrokerSummary; currency: string }) {
  const count = broker.holdings.length;
  const shown = broker.holdings.slice(0, SHOWN);
  const rest = broker.holdings.slice(SHOWN);

  return (
    <section aria-labelledby={`broker-${broker.name}`} className="flex flex-col rounded-lg border border-border">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div className="min-w-0">
          <h3 id={`broker-${broker.name}`} className="truncate text-sm font-semibold">
            {broker.name}
          </h3>
          <p className="text-xs text-muted">
            {count} holding{count === 1 ? "" : "s"}
            {broker.synced && broker.reportedAt && ` · as of ${calendarDate(broker.reportedAt) ?? broker.reportedAt}`}
            {!broker.synced && " · typed in on this page"}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-lg font-semibold tracking-tight">{money(broker.value, currency)}</p>
          <p
            className={cn(
              "tnum text-xs",
              broker.gain > 0 && "text-up",
              broker.gain < 0 && "text-down",
              broker.gain === 0 && "text-muted",
            )}
          >
            {signedMoney(broker.gain, currency)} ({signedPercent(broker.gainPercent)}) on cost
          </p>
        </div>
      </div>

      <div className="space-y-1 px-4 pt-3">
        <div className="flex justify-between text-xs">
          <span className="text-muted">Share of the portfolio</span>
          <span className="tnum font-medium">{broker.share != null ? percent(broker.share) : "—"}</span>
        </div>
        <MeterBar value={broker.share} max={1} label={`${broker.name}: ${percent(broker.share)} of the portfolio`} />
      </div>

      {broker.connectedTwice.length > 0 && (
        <p className="mx-4 mt-3 rounded-md bg-poor-soft px-2.5 py-1.5 text-xs leading-relaxed text-poor-fg">
          Connected twice — through {broker.connectedTwice.join(" and ")} — so the same shares are probably counted
          twice. Disconnect one on your account page.
        </p>
      )}

      <div className="px-4 pb-3 pt-2">
        <HoldingsTable rows={shown} currency={currency} caption={`Held at ${broker.name}`} />
        {rest.length > 0 && (
          <details className="group">
            <summary className="cursor-pointer py-1.5 text-xs font-medium text-accent">
              <span className="group-open:hidden">Show {rest.length} more</span>
              <span className="hidden group-open:inline">Show fewer</span>
            </summary>
            <HoldingsTable rows={rest} currency={currency} caption={`More held at ${broker.name}`} />
          </details>
        )}
        {broker.uncounted > 0 && (
          <p className="pt-1.5 text-xs text-faint">
            {broker.uncounted} without a price or exchange rate {broker.uncounted === 1 ? "is" : "are"} listed but not
            counted in the total.
          </p>
        )}
      </div>
    </section>
  );
}

export function BrokerBreakdown({ brokers, currency }: { brokers: BrokerSummary[]; currency: string }) {
  return (
    <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,320px),1fr))] gap-3 p-5">
      {brokers.map((broker) => (
        <BrokerPanel key={broker.name} broker={broker} currency={currency} />
      ))}
    </div>
  );
}
