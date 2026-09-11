"use client";

import Link from "next/link";
import { useId, useState, type KeyboardEvent } from "react";
import { ExternalLink } from "lucide-react";
import { Card, CardHeader } from "@/components/ui";
import { calendarDate, money, price } from "@/lib/format";
import { describeChange, type StatementRowKind } from "@/lib/fundamentals/statement-change";
import type { StatementData, StatementKey } from "@/lib/fundamentals/statements";
import { cn } from "@/lib/utils";

/**
 * The income statement, balance sheet and cash flow, annual or quarterly.
 *
 * Every column names the filing it came from and links to it. "Show sources"
 * puts the XBRL concept under each figure, so a reader can check any number
 * against the filing itself; calculated rows carry their formula instead.
 */
export function StatementExplorer({ data }: { data: StatementData }) {
  const baseId = useId();
  const [tab, setTab] = useState<StatementKey>("income");
  const [period, setPeriod] = useState<"annual" | "quarterly">("annual");
  const [showSources, setShowSources] = useState(false);

  const hasQuarters = data.quarterly.length > 0;
  const columns = period === "annual" ? data.annual : data.quarterly;
  const base = period === "annual" ? data.annualBase : data.quarterlyBase;
  const table = data.tables.find((t) => t.key === tab) ?? data.tables[0];
  const rows = table.rows.filter((row) => columns.some((column) => column.cells[row.key]?.value != null));

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    const index = data.tables.findIndex((t) => t.key === tab);
    const next = (index + (event.key === "ArrowRight" ? 1 : -1) + data.tables.length) % data.tables.length;
    setTab(data.tables[next].key);
    document.getElementById(`${baseId}-tab-${data.tables[next].key}`)?.focus();
  }

  const format = (value: number | null | undefined, kind: StatementRowKind) =>
    value == null ? "—" : formatFigure(value, kind, data.currency);

  return (
    <Card>
      <CardHeader
        title="Financial statements"
        subtitle={`As reported to the SEC, in ${data.currency}. Hover or show sources to see where each figure came from.`}
      />

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <div role="tablist" aria-label="Statement" className="flex flex-wrap gap-1">
          {data.tables.map((t) => (
            <button
              key={t.key}
              id={`${baseId}-tab-${t.key}`}
              type="button"
              role="tab"
              aria-selected={t.key === tab}
              aria-controls={`${baseId}-panel`}
              tabIndex={t.key === tab ? 0 : -1}
              onClick={() => setTab(t.key)}
              onKeyDown={onTabKey}
              className={cn(
                "rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors",
                t.key === tab
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-muted hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Period">
            {(["annual", "quarterly"] as const).map((p) => (
              <button
                key={p}
                type="button"
                aria-pressed={period === p}
                disabled={p === "quarterly" && !hasQuarters}
                title={p === "quarterly" && !hasQuarters ? "No quarterly reports on file — this company files annually." : undefined}
                onClick={() => setPeriod(p)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs font-medium capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-50",
                  period === p ? "bg-surface-2 text-foreground" : "text-muted hover:text-foreground",
                )}
              >
                {p}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={showSources}
              onChange={(e) => setShowSources(e.target.checked)}
              className="accent-[var(--accent)]"
            />
            Show sources
          </label>
        </div>
      </div>

      <div id={`${baseId}-panel`} role="tabpanel" aria-labelledby={`${baseId}-tab-${tab}`} className="scroll-x">
        {rows.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-muted">
            No {table.label.toLowerCase()} figures were reported for these periods.
          </p>
        ) : (
          <table className="w-full min-w-[44rem] text-sm">
            <caption className="sr-only">
              {table.label}, {period}, {data.currency}
            </caption>
            <thead>
              <tr className="border-b border-border bg-surface-2/50 align-bottom text-xs text-muted">
                <th scope="col" className="sticky left-0 z-10 bg-surface px-5 py-2.5 text-left font-medium">
                  {table.label}
                </th>
                {columns.map((column) => (
                  <th key={column.key} scope="col" className="px-3 py-2.5 text-right font-medium">
                    <span className="block text-foreground">{column.label}</span>
                    <span className="block font-normal text-faint">
                      {column.form}
                      {column.filedAt ? ` · ${calendarDate(column.filedAt) ?? column.filedAt}` : ""}
                    </span>
                    {column.sourceUrl && (
                      <a
                        href={column.sourceUrl}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-0.5 font-normal text-accent hover:underline"
                      >
                        Filing <ExternalLink aria-hidden className="size-3" />
                        <span className="sr-only"> for {column.label}</span>
                      </a>
                    )}
                  </th>
                ))}
                {base != null && (
                  <th scope="col" className="px-5 py-2.5 text-right font-medium">
                    <span className="block text-foreground">Change</span>
                    <span className="block font-normal text-faint">
                      {columns[0].label} vs {columns[base].label}
                    </span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.key} className="group align-top transition-colors hover:bg-surface-2/60">
                  <th
                    scope="row"
                    className={cn(
                      "sticky left-0 z-10 bg-surface px-5 py-2 text-left text-[0.8125rem] transition-colors group-hover:bg-surface-2/60",
                      row.emphasis ? "font-semibold" : "font-normal text-muted-strong",
                    )}
                  >
                    {row.label}
                    {row.formula && <span className="block text-[11px] font-normal text-faint">{row.formula}</span>}
                    {row.guide && (
                      <Link href={`/learn#${row.guide}`} className="block text-[11px] font-normal text-accent hover:underline">
                        What is this?
                      </Link>
                    )}
                  </th>
                  {columns.map((column) => {
                    const cell = column.cells[row.key];
                    const source = cell?.concept
                      ? `${cell.concept}${cell.derived ? " (calculated from other reported figures)" : ""}`
                      : cell?.value != null
                        ? "Calculated"
                        : "Not reported";
                    return (
                      <td
                        key={column.key}
                        title={source}
                        className={cn("tnum px-3 py-2 text-right", row.emphasis && "font-semibold")}
                      >
                        {format(cell?.value, row.kind)}
                        {cell?.concept && cell.derived && (
                          <span aria-label=" calculated" className="text-faint">†</span>
                        )}
                        {showSources && cell?.value != null && (
                          <span className="block max-w-[11rem] truncate text-[10px] font-normal text-faint" title={source}>
                            {cell.concept ?? "calculated"}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {base != null && (
                    <td className="tnum px-5 py-2 text-right text-muted-strong">
                      {describeChange(
                        columns[0].cells[row.key]?.value ?? null,
                        columns[base].cells[row.key]?.value ?? null,
                        row.kind,
                      ) ?? "—"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <p className="border-t border-border px-5 py-3 text-xs leading-relaxed text-muted">
        † calculated from other reported figures, such as total liabilities as assets minus equity.
        {period === "quarterly" &&
          " Quarters come from 10-Q filings. A fourth quarter is never filed on its own, and a 10-Q's cash flow statement is cumulative for the year to date, so most quarters show no cash flow figures."}
        {period === "annual" && base == null && " There is no consecutive earlier year to compare with."}
        {period === "quarterly" && base == null && " There is no same quarter a year earlier on file to compare with."}
      </p>
    </Card>
  );
}

function formatFigure(value: number, kind: StatementRowKind, currency: string): string {
  switch (kind) {
    case "money":
      return money(value, currency);
    case "percent":
      return `${(value * 100).toFixed(1)}%`;
    case "multiple":
      return `${value.toFixed(2)}x`;
    case "perShare":
      return price(value, currency);
    case "shares": {
      const abs = Math.abs(value);
      if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
      if (abs >= 1e6) return `${(value / 1e6).toFixed(1)}M`;
      return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
    }
  }
}
