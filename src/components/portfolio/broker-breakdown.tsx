"use client";

import Link from "next/link";
import { useState } from "react";
import { calendarDate, money, percent } from "@/lib/format";
import type { BrokerAccount, BrokerHoldingRow, BrokerSummary } from "@/lib/portfolio/brokers";
import { cn } from "@/lib/utils";
import { Ring, type RingSegment } from "./ring";

/**
 * What is held at each broker, and how much — as a ring to explore.
 *
 * The first ring splits the portfolio by broker, with the list of brokers
 * beside it saying which are connected and what each is worth. Choosing a
 * broker, in the ring or the list, opens a second ring of what that broker
 * holds, company by company, with the holdings beside it. Choosing it again
 * closes it. A broker with more than one account — a TFSA and an RRSP, say —
 * lists them above its holdings, and choosing one narrows the ring and the
 * table to that account. Amounts are in one currency, the same as the other
 * charts.
 *
 * Six segments at most per ring, each in its own colour in the palette's
 * fixed order, the rest folded into a grey "Other" — the same rule as the
 * allocation ring, so colours stay distinguishable for colour-blind readers.
 */

/** Rows shown before the rest fold away, so a broker with forty holdings does not push everything else down. */
const SHOWN = 8;
const MAX_SEGMENTS = 6;
const OTHER = "__other__";
/** A broker with nothing priced has no slice; its swatch in the list is plain. */
const NO_SLICE = "var(--surface-3)";

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

/**
 * Ring segments from items already sorted largest first: all of them when
 * six or fewer, else the five largest and a grey "Other" that cannot be chosen.
 */
function segmentsOf(items: { key: string; label: string; value: number }[], otherLabel: string): RingSegment[] {
  const priced = items.filter((item) => item.value > 0);
  const total = priced.reduce((sum, item) => sum + item.value, 0);
  if (total <= 0) return [];
  const kept = priced.length <= MAX_SEGMENTS ? priced : priced.slice(0, MAX_SEGMENTS - 1);
  const segments: RingSegment[] = kept.map((item, index) => ({
    key: item.key,
    label: item.label,
    value: item.value,
    share: item.value / total,
    color: `var(--series-${index + 1})`,
  }));
  const rest = priced.slice(kept.length);
  if (rest.length > 0) {
    const value = rest.reduce((sum, item) => sum + item.value, 0);
    segments.push({ key: OTHER, label: otherLabel, value, share: value / total, color: "var(--faint)", selectable: false });
  }
  return segments;
}

function colourOf(segments: RingSegment[], key: string): string {
  return segments.find((s) => s.key === key)?.color ?? (segments.some((s) => s.key === OTHER) ? "var(--faint)" : NO_SLICE);
}

function Swatch({ color }: { color: string }) {
  return <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-[3px]" style={{ background: color }} />;
}

function HoldingsTable({
  rows,
  currency,
  caption,
  colours,
  active,
  onActive,
  accountOf,
}: {
  rows: BrokerHoldingRow[];
  currency: string;
  caption: string;
  colours: RingSegment[];
  active: string | null;
  onActive: (key: string | null) => void;
  /** The account a row sits in, in words, when the table spans more than one. */
  accountOf?: (row: BrokerHoldingRow) => string | null;
}) {
  return (
    <table className="w-full table-fixed text-sm">
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col />
        <col className="w-[4rem]" />
        <col className="w-[5rem]" />
        {/* Gain gives way on a phone, so the company keeps room for its name. */}
        <col className="hidden w-[4.25rem] sm:table-column" />
        <col className="w-[3.25rem]" />
      </colgroup>
      <thead className="text-xs text-muted">
        <tr className="border-b border-border">
          <th scope="col" className="py-1.5 pr-2 text-left font-medium">Company</th>
          <th scope="col" className="py-1.5 pr-2 text-right font-medium">Shares</th>
          <th scope="col" className="py-1.5 pr-2 text-right font-medium">Value</th>
          <th scope="col" className="hidden py-1.5 pr-2 text-right font-medium sm:table-cell">Gain</th>
          <th scope="col" className="py-1.5 text-right font-medium">Share</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border">
        {rows.map((row) => (
          <tr
            key={row.key}
            onPointerEnter={() => onActive(row.key)}
            onPointerLeave={() => onActive(null)}
            className={cn("align-top transition-colors", active === row.key && "bg-surface-2")}
          >
            <th scope="row" className="py-1.5 pr-2 text-left font-normal">
              <span className="flex min-w-0 items-start gap-2">
                <span className="mt-1.5">
                  <Swatch color={row.value != null ? colourOf(colours, row.key) : NO_SLICE} />
                </span>
                <span className="min-w-0">
                  <Link href={`/stock/${encodeURIComponent(row.symbol)}`} className="font-semibold hover:text-accent">
                    {row.symbol}
                  </Link>
                  {row.name && <span className="block truncate text-xs text-muted">{row.name}</span>}
                  {accountOf?.(row) && <span className="block truncate text-[11px] font-medium text-muted-strong">{accountOf(row)}</span>}
                </span>
              </span>
            </th>
            <td className="tnum py-1.5 pr-2 text-right">
              {row.quantity.toLocaleString("en-US", { maximumFractionDigits: 4 })}
            </td>
            <td className="tnum py-1.5 pr-2 text-right">
              {row.value != null ? money(row.value, currency) : <span className="text-xs text-faint">no price</span>}
            </td>
            <td
              className={cn(
                "tnum hidden py-1.5 pr-2 text-right sm:table-cell",
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

/** A broker's accounts, each with its kind and value; choosing one narrows the holdings to it. */
function AccountChoice({
  broker,
  currency,
  chosen,
  onChoose,
}: {
  broker: BrokerSummary;
  currency: string;
  chosen: string | null;
  onChoose: (key: string | null) => void;
}) {
  const option = (key: string | null, label: string, detail: string | null, value: number, share: number | null) => (
    <button
      key={key ?? "all"}
      type="button"
      aria-pressed={chosen === key}
      onClick={() => onChoose(key)}
      className={cn(
        "rounded-lg border px-2.5 py-1.5 text-left text-xs transition-colors",
        chosen === key ? "border-accent bg-accent-soft/40" : "border-border hover:bg-surface-2/70",
      )}
    >
      <span className="block font-medium">
        {label}
        {detail && <span className="font-normal text-faint"> · {detail}</span>}
      </span>
      <span className="tnum block text-muted">
        {money(value, currency)}
        {share != null && ` · ${percent(share, 0)}`}
      </span>
    </button>
  );
  return (
    <div role="group" aria-label={`Accounts at ${broker.name}`} className="mt-3 flex flex-wrap gap-2">
      {option(null, "All accounts", null, broker.value, null)}
      {broker.accounts.map((account) => option(account.key, account.label, account.description, account.value, account.share))}
    </div>
  );
}

/** One broker opened: a ring of what it holds, and the holdings beside it. */
function Holdings({ broker, currency }: { broker: BrokerSummary; currency: string }) {
  const [expanded, setExpanded] = useState(false);
  const [active, setActive] = useState<string | null>(null);
  const [accountKey, setAccountKey] = useState<string | null>(null);

  const several = broker.accounts.length > 1;
  const account: BrokerAccount | null = broker.accounts.find((a) => a.key === accountKey) ?? null;
  // The one account a broker has is named in the heading; several are offered to choose from.
  const only = !several ? (broker.accounts[0] ?? null) : null;
  const inView = account
    ? broker.holdings
        .filter((h) => h.account === account.key)
        .map((h) => ({ ...h, share: h.value != null && account.value > 0 ? h.value / account.value : null }))
    : broker.holdings;
  const value = account ? account.value : broker.value;
  const where = account ? `${broker.name}, ${account.label}` : broker.name;
  const labelOf = new Map(broker.accounts.map((a) => [a.key, a.label]));

  const rows = expanded ? inView : inView.slice(0, SHOWN);
  const hidden = inView.length - rows.length;
  const segments = segmentsOf(
    inView.map((h) => ({ key: h.key, label: h.symbol, value: h.value ?? 0 })),
    "Other holdings",
  );
  const choose = (key: string | null) => {
    setAccountKey(key);
    setExpanded(false);
    setActive(null);
  };

  return (
    <section
      id={`${idFor(broker.name)}-holdings`}
      aria-label={`Held at ${broker.name}`}
      className="rounded-lg border border-border px-4 py-4"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">
          Held at {broker.name}
          {only?.type && <span className="font-normal text-muted"> · {only.label}</span>}
        </h3>
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

      {several && <AccountChoice broker={broker} currency={currency} chosen={accountKey} onChoose={choose} />}

      <div className="mt-3 grid grid-cols-[minmax(0,1fr)] items-center gap-5 md:grid-cols-[minmax(0,190px)_minmax(0,1fr)]">
        {segments.length > 0 ? (
          <Ring
            segments={segments}
            currency={currency}
            ariaLabel={`What ${where} holds`}
            active={active}
            onActive={setActive}
            className="max-w-[190px]"
            idle={
              <>
                <span className="text-xl font-semibold tracking-tight">{money(value, currency)}</span>
                <span className="mt-0.5 max-w-full truncate text-xs text-muted">
                  {account ? `in ${account.label}` : `at ${broker.name}`}
                </span>
              </>
            }
          />
        ) : (
          <p className="text-sm text-muted">Nothing here has a price yet.</p>
        )}

        <div>
          <HoldingsTable
            rows={rows}
            currency={currency}
            caption={`Held at ${where}`}
            colours={segments}
            active={active}
            onActive={setActive}
            accountOf={several && !account ? (row) => labelOf.get(row.account) ?? null : undefined}
          />
          {inView.length > SHOWN && (
            <button type="button" onClick={() => setExpanded(!expanded)} className="py-1.5 text-xs font-medium text-accent">
              {expanded ? "Show fewer" : `Show ${hidden} more`}
            </button>
          )}
          {broker.uncounted > 0 && (
            <p className="pt-1.5 text-xs text-faint">
              {broker.uncounted} without a price or exchange rate {broker.uncounted === 1 ? "is" : "are"} listed but not
              counted in the total.
            </p>
          )}
        </div>
      </div>
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
  const [active, setActive] = useState<string | null>(null);
  const selected = brokers.find((b) => b.name === open) ?? null;
  const toggle = (name: string) => setOpen(name === open ? null : name);

  const segments = segmentsOf(
    brokers.map((b) => ({ key: b.name, label: b.name, value: b.value })),
    "Other brokers",
  );
  const total = brokers.reduce((sum, b) => sum + b.value, 0);
  const connected = brokers.filter((b) => b.synced).length;

  return (
    <div className="space-y-4 p-5">
      {/* One column that may shrink on a phone: a long line in the list must truncate, not widen the card. */}
      <div className="grid grid-cols-[minmax(0,1fr)] items-center gap-6 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
        <Ring
          segments={segments}
          currency={currency}
          ariaLabel="Value by broker"
          active={active}
          onActive={setActive}
          selected={open}
          onSelect={toggle}
          idle={
            <>
              <span className="text-2xl font-semibold tracking-tight">{money(total, currency)}</span>
              <span className="mt-0.5 text-xs text-muted">
                {connected} broker{connected === 1 ? "" : "s"} connected
              </span>
            </>
          }
        />

        <ul className="space-y-1.5">
          {brokers.map((broker) => {
            const isOpen = broker.name === open;
            const count = broker.holdings.length;
            return (
              <li key={broker.name}>
                <button
                  type="button"
                  onClick={() => toggle(broker.name)}
                  onPointerEnter={() => setActive(broker.name)}
                  onPointerLeave={() => setActive(null)}
                  aria-expanded={isOpen}
                  aria-controls={`${idFor(broker.name)}-holdings`}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors",
                    isOpen ? "border-accent bg-accent-soft/40" : "border-transparent hover:bg-surface-2/70",
                    active === broker.name && !isOpen && "bg-surface-2/70",
                  )}
                >
                  <Swatch color={colourOf(segments, broker.name)} />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 text-sm font-medium">
                      <span className="truncate">{broker.name}</span>
                      {broker.connectedTwice.length > 0 && (
                        <span className="shrink-0 rounded-full bg-poor-soft px-1.5 text-[10px] font-medium text-poor-fg">
                          connected twice
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {broker.synced ? (
                        <>
                          <span aria-hidden className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-good align-middle" />
                          Connected
                        </>
                      ) : (
                        "Typed in by you"
                      )}
                      {broker.accounts.length > 1 && ` · ${broker.accounts.length} accounts`}
                      {` · ${count} holding${count === 1 ? "" : "s"}`}
                      {broker.synced &&
                        broker.reportedAt &&
                        ` · as of ${calendarDate(broker.reportedAt) ?? broker.reportedAt}`}
                    </span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="tnum block text-sm font-semibold">{money(broker.value, currency)}</span>
                    <span className="tnum block text-xs text-muted">
                      {broker.share != null ? percent(broker.share) : "—"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {selected ? (
        <Holdings key={selected.name} broker={selected} currency={currency} />
      ) : (
        <p className="text-xs text-muted">Select a broker, in the ring or the list, to see what it holds.</p>
      )}
    </div>
  );
}
