"use client";

import Link from "next/link";
import { useState } from "react";
import { MeterBar } from "@/components/ui";
import { calendarDate, money, percent } from "@/lib/format";
import type { BrokerHoldingRow, BrokerSummary } from "@/lib/portfolio/brokers";
import { cn } from "@/lib/utils";

/**
 * What is held at each broker, and how much.
 *
 * A row of tiles, one per broker — and one for what was typed in by hand —
 * each with its value and share of the portfolio. Selecting a tile opens that
 * broker's holdings below the row: every company held there, with the
 * shares, the value and that company's share of the broker. One opens at a
 * time, and selecting it again closes it. Amounts are in one currency, the
 * same as the charts, so a broker's holdings add up and brokers compare.
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

/** A broker's name as an element id. */
function idFor(name: string): string {
  return `broker-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
}

function HoldingsTable({ rows, currency, caption }: { rows: BrokerHoldingRow[]; currency: string; caption: string }) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col />
        <col className="w-[4.5rem]" />
        <col className="w-[5.5rem]" />
        <col className="w-[4.5rem]" />
        <col className="w-[3.5rem]" />
      </colgroup>
      <thead className="text-xs text-muted">
        <tr className="border-b border-border">
          <th scope="col" className="py-1.5 pr-2 text-left font-medium">Company</th>
          <th scope="col" className="py-1.5 pr-2 text-right font-medium">Shares</th>
          <th scope="col" className="py-1.5 pr-2 text-right font-medium">Value</th>
          <th scope="col" className="py-1.5 pr-2 text-right font-medium">Gain</th>
          <th scope="col" className="py-1.5 text-right font-medium">Share</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
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
            <td
              className={cn(
                "tnum py-1.5 pr-2 text-right",
                row.gainPercent != null && row.gainPercent > 0 && "text-up",
                row.gainPercent != null && row.gainPercent < 0 && "text-down",
              )}
            >
              {signedPercent(row.gainPercent)}
            </td>
            <td className="tnum py-1.5 text-right text-muted">{row.share != null ? percent(row.share, 0) : "—"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Tile({
  broker,
  currency,
  open,
  onSelect,
}: {
  broker: BrokerSummary;
  currency: string;
  open: boolean;
  onSelect: () => void;
}) {
  const count = broker.holdings.length;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-expanded={open}
      aria-controls={`${idFor(broker.name)}-holdings`}
      className={cn(
        "flex flex-col gap-2 rounded-lg border px-4 py-3 text-left transition-colors",
        open ? "border-accent bg-accent-soft/40" : "border-border hover:border-accent/60 hover:bg-surface-2/60",
      )}
    >
      <span className="flex w-full items-start justify-between gap-3">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            {broker.synced && <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-good" />}
            <span className="truncate">{broker.name}</span>
          </span>
          <span className="block text-xs text-muted">
            {broker.synced ? "Connected" : "Typed in by you"} · {count} holding{count === 1 ? "" : "s"}
          </span>
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-base font-semibold tracking-tight">{money(broker.value, currency)}</span>
          <span className="tnum block text-xs text-muted">{broker.share != null ? percent(broker.share) : "—"}</span>
        </span>
      </span>
      <MeterBar value={broker.share} max={1} label={`${broker.name}: ${percent(broker.share)} of the portfolio`} />
      <span className="flex w-full items-center justify-between text-xs">
        {broker.connectedTwice.length > 0 ? (
          <span className="font-medium text-poor-fg">Connected twice</span>
        ) : (
          <span className="text-faint">
            {broker.synced && broker.reportedAt ? `As of ${calendarDate(broker.reportedAt) ?? broker.reportedAt}` : ""}
          </span>
        )}
        <span className="font-medium text-accent">{open ? "Hide holdings" : "Show holdings"}</span>
      </span>
    </button>
  );
}

function Holdings({ broker, currency }: { broker: BrokerSummary; currency: string }) {
  const [expanded, setExpanded] = useState(false);
  const rows = expanded ? broker.holdings : broker.holdings.slice(0, SHOWN);
  const hidden = broker.holdings.length - rows.length;

  return (
    <section
      id={`${idFor(broker.name)}-holdings`}
      aria-label={`Held at ${broker.name}`}
      className="rounded-lg border border-border px-4 py-3"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">Held at {broker.name}</h3>
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

      {broker.connectedTwice.length > 0 && (
        <p className="mt-2 rounded-md bg-poor-soft px-2.5 py-1.5 text-xs leading-relaxed text-poor-fg">
          Connected twice — through {broker.connectedTwice.join(" and ")} — so the same shares are probably counted
          twice. Disconnect one on your account page.
        </p>
      )}

      <div className="mt-2">
        <HoldingsTable rows={rows} currency={currency} caption={`Held at ${broker.name}`} />
      </div>
      {(hidden > 0 || expanded) && broker.holdings.length > SHOWN && (
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="py-1.5 text-xs font-medium text-accent"
        >
          {expanded ? "Show fewer" : `Show ${hidden} more`}
        </button>
      )}
      {broker.uncounted > 0 && (
        <p className="pt-1.5 text-xs text-faint">
          {broker.uncounted} without a price or exchange rate {broker.uncounted === 1 ? "is" : "are"} listed but not
          counted in the total.
        </p>
      )}
    </section>
  );
}

export function BrokerBreakdown({
  brokers,
  currency,
  defaultOpen = null,
}: {
  brokers: BrokerSummary[];
  currency: string;
  /** The broker open at first; none, unless a test or a link asks for one. */
  defaultOpen?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(defaultOpen);
  const selected = brokers.find((b) => b.name === open) ?? null;

  return (
    <div className="space-y-3 p-5">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,240px),1fr))] gap-3">
        {brokers.map((broker) => (
          <Tile
            key={broker.name}
            broker={broker}
            currency={currency}
            open={broker.name === open}
            onSelect={() => setOpen(broker.name === open ? null : broker.name)}
          />
        ))}
      </div>
      {selected && <Holdings key={selected.name} broker={selected} currency={currency} />}
    </div>
  );
}
