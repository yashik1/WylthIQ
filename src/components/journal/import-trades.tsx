"use client";

import { useRef, useState, useTransition } from "react";
import { parseDelimited, type Sheet } from "@/lib/journal/delimited";
import { canReadXlsx, readXlsx } from "@/lib/journal/xlsx";
import {
  buildPreview,
  detectColumns,
  FIELD_LABEL,
  FIELDS,
  REQUIRED,
  type ImportPreview,
  type Mapping,
} from "@/lib/journal/import-map";
import { importTrades } from "@/lib/journal/trade-actions";
import { money, num } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Importing a file of trades.
 *
 * The file is read in the browser and never uploaded. That is worth doing for
 * its own sake — a broker export is a complete record of somebody's positions,
 * and there is no reason for this server to hold one — but it also makes the
 * mapping step immediate: change a column and the preview updates without a
 * round trip. Only the rows the reader confirms are sent, and they are
 * re-validated on arrival.
 *
 * Nothing is written until the reader has seen what will be written. Column
 * detection is a guess and is allowed to be wrong; the preview is where being
 * wrong gets caught, which is why it shows the actual parsed values rather
 * than a row count.
 */

const MAX_BYTES = 8 * 1024 * 1024;
const PREVIEW_ROWS = 6;

type Stage =
  | { kind: "idle" }
  | { kind: "reading" }
  | { kind: "error"; message: string }
  | { kind: "mapping"; sheet: Sheet; mapping: Mapping; fileName: string };

export function ImportTrades() {
  const [stage, setStage] = useState<Stage>({ kind: "idle" });
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  async function onFile(file: File) {
    setDone(null);

    if (file.size > MAX_BYTES) {
      setStage({ kind: "error", message: "That file is over 8MB. Split it and import in parts." });
      return;
    }

    setStage({ kind: "reading" });

    try {
      const isSpreadsheet = /\.xlsx$/i.test(file.name);

      if (/\.xls$/i.test(file.name)) {
        // The old binary .xls is a completely different format — a compound
        // document, not a zip — and reading it is a project of its own.
        throw new Error(
          "That is the older .xls format. Open it and save as .xlsx or CSV, and this will read it.",
        );
      }

      let sheet: Sheet;
      if (isSpreadsheet) {
        if (!canReadXlsx()) {
          throw new Error(
            "This browser cannot unpack a spreadsheet. Save the file as CSV and try again.",
          );
        }
        sheet = await readXlsx(await file.arrayBuffer());
      } else {
        sheet = parseDelimited(await file.text());
      }

      if (sheet.headers.length === 0 || sheet.rows.length === 0) {
        throw new Error("That file has no rows under its headings.");
      }

      setStage({
        kind: "mapping",
        sheet,
        mapping: detectColumns(sheet.headers),
        fileName: file.name,
      });
    } catch (err) {
      const message =
        err instanceof Error && err.message && !/not-a-zip|no-worksheet/.test(err.message)
          ? err.message
          : "That file could not be read. A CSV export usually works when a spreadsheet does not.";
      setStage({ kind: "error", message });
    }
  }

  function reset() {
    setStage({ kind: "idle" });
    if (inputRef.current) inputRef.current.value = "";
  }

  return (
    <div className="space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-3">
        <label
          className="cursor-pointer rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent"
          htmlFor="trade-import"
        >
          Choose a file
        </label>
        <input
          ref={inputRef}
          id="trade-import"
          type="file"
          accept=".csv,.tsv,.txt,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void onFile(file);
          }}
        />
        <span className="text-xs text-muted">
          CSV, TSV or .xlsx — from your broker, or your own spreadsheet.
        </span>
      </div>

      <p className="text-xs leading-relaxed text-faint">
        {/* Worth saying plainly: people are reasonably wary of uploading a
            complete record of their positions to a website. */}
        The file is read in your browser and never uploaded. Only the rows you
        confirm are sent, and you see exactly what those are first.
      </p>

      {stage.kind === "reading" && <p className="text-sm text-muted">Reading…</p>}

      {stage.kind === "error" && (
        <p className="border border-poor px-3.5 py-2.5 text-sm text-poor-fg" role="alert">
          {stage.message}
        </p>
      )}

      {done && (
        <p className="border border-good px-3.5 py-2.5 text-sm text-good-fg" role="status">
          {done}
        </p>
      )}

      {stage.kind === "mapping" && (
        <MappingStep
          sheet={stage.sheet}
          mapping={stage.mapping}
          fileName={stage.fileName}
          pending={pending}
          onChange={(mapping) => setStage({ ...stage, mapping })}
          onCancel={reset}
          onConfirm={(preview) => {
            startTransition(async () => {
              const result = await importTrades(preview.drafts);
              if (result.ok) {
                setDone(result.message);
                reset();
              } else {
                setStage({ kind: "error", message: result.message });
              }
            });
          }}
        />
      )}
    </div>
  );
}

function MappingStep({
  sheet,
  mapping,
  fileName,
  pending,
  onChange,
  onCancel,
  onConfirm,
}: {
  sheet: Sheet;
  mapping: Mapping;
  fileName: string;
  pending: boolean;
  onChange: (m: Mapping) => void;
  onCancel: () => void;
  onConfirm: (preview: ImportPreview) => void;
}) {
  const preview = buildPreview(sheet.rows, mapping);
  const ready = preview.missingRequired.length === 0 && preview.drafts.length > 0;

  return (
    <div className="space-y-4 border-t border-border pt-4">
      <p className="text-sm">
        <span className="font-semibold">{fileName}</span>{" "}
        <span className="text-muted">
          — {sheet.rows.length} {sheet.rows.length === 1 ? "row" : "rows"},{" "}
          {sheet.headers.length} columns
        </span>
      </p>

      {/* The guess, shown as something to correct rather than announced as
          correct. Required fields are marked so an unmapped one reads as a
          thing to fix rather than an omission. */}
      <div>
        <p className="eyebrow mb-2">Which column is which</p>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,11rem),1fr))] gap-3">
          {FIELDS.map((field) => (
            <div key={field}>
              <label htmlFor={`map-${field}`} className="text-xs text-muted">
                {FIELD_LABEL[field]}
                {REQUIRED.includes(field) && <span className="text-poor"> *</span>}
              </label>
              <select
                id={`map-${field}`}
                value={mapping[field] ?? ""}
                onChange={(e) =>
                  onChange({ ...mapping, [field]: e.target.value || undefined })
                }
                className={cn(
                  "mt-1 w-full border bg-surface px-2 py-1.5 text-xs outline-none focus:border-accent",
                  preview.missingRequired.includes(field) ? "border-poor" : "border-border",
                )}
              >
                <option value="">— not in this file —</option>
                {sheet.headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
            </div>
          ))}
        </div>
      </div>

      {preview.missingRequired.length > 0 && (
        <p className="border border-poor px-3.5 py-2.5 text-sm text-poor-fg">
          Pick a column for{" "}
          {preview.missingRequired.map((f) => FIELD_LABEL[f].toLowerCase()).join(", ")}. A
          trade cannot be recorded without them.
        </p>
      )}

      {preview.drafts.length > 0 && (
        <div>
          <p className="eyebrow mb-2">
            What will be imported — first {Math.min(PREVIEW_ROWS, preview.drafts.length)} of{" "}
            {preview.drafts.length}
          </p>
          <div className="scroll-x border border-border">
            <table className="w-full min-w-[40rem] text-xs">
              <thead>
                <tr className="border-b border-border bg-surface-2/50 text-left text-muted">
                  <th scope="col" className="px-3 py-2 font-medium">Symbol</th>
                  <th scope="col" className="px-3 py-2 font-medium">Side</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Size</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Entry</th>
                  <th scope="col" className="px-3 py-2 text-right font-medium">Exit</th>
                  <th scope="col" className="px-3 py-2 font-medium">Opened</th>
                  <th scope="col" className="px-3 py-2 font-medium">Closed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {preview.drafts.slice(0, PREVIEW_ROWS).map((d, i) => (
                  <tr key={i}>
                    <td className="px-3 py-1.5 font-semibold">{d.symbol}</td>
                    <td className="px-3 py-1.5">{d.side}</td>
                    <td className="tnum px-3 py-1.5 text-right">{num(d.quantity, 0)}</td>
                    <td className="tnum px-3 py-1.5 text-right">{money(d.entryPrice, "USD")}</td>
                    <td className="tnum px-3 py-1.5 text-right">
                      {d.exitPrice == null ? <span className="text-faint">open</span> : money(d.exitPrice, "USD")}
                    </td>
                    <td className="px-3 py-1.5">{d.openedAt}</td>
                    <td className="px-3 py-1.5">{d.closedAt ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Named against the spreadsheet's own line numbers, because the next
          thing the reader does is open the file and look. */}
      {preview.problems.length > 0 && (
        <details className="border border-fair px-3.5 py-2.5">
          <summary className="cursor-pointer text-sm font-medium">
            {preview.problems.length}{" "}
            {preview.problems.length === 1 ? "row will be skipped" : "rows will be skipped"}
          </summary>
          <ul className="mt-2 space-y-1">
            {preview.problems.slice(0, 20).map((p, i) => (
              <li key={i} className="text-xs text-muted">
                Line {p.line}: {p.reason}
              </li>
            ))}
            {preview.problems.length > 20 && (
              <li className="text-xs text-faint">
                …and {preview.problems.length - 20} more.
              </li>
            )}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          disabled={!ready || pending}
          onClick={() => onConfirm(preview)}
          className="rounded-lg border border-transparent bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending
            ? "Importing…"
            : `Import ${preview.drafts.length} ${preview.drafts.length === 1 ? "trade" : "trades"}`}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-2 text-sm text-muted transition-colors hover:text-foreground"
        >
          Cancel
        </button>
        {/*
          Imports are not matched against what is already there. Saying so is
          better than a dedupe that guesses: two genuine trades in the same
          symbol on the same day at the same price do happen, and silently
          dropping the second would be the harder error to notice.
        */}
        <span className="text-xs text-faint">
          Rows are added, not matched — importing the same file twice will duplicate it.
        </span>
      </div>
    </div>
  );
}
