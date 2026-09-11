"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { deleteThesis, saveThesis } from "@/lib/thesis/actions";
import {
  MAX_CONDITIONS,
  MAX_THESIS_TEXT,
  OPERATOR_LABEL,
  OPERATORS_FOR,
  THESIS_METRICS,
  THESIS_STATUSES,
  TIME_HORIZONS,
  type ConditionOperator,
  type ThesisMetricKey,
} from "@/lib/thesis/metrics";
import { cn } from "@/lib/utils";

export interface ThesisDraft {
  thesis: string;
  mustGoRight: string;
  couldBreak: string;
  horizon: string;
  status: string;
  conditions: { metric: ThesisMetricKey; operator: ConditionOperator; target: string }[];
}

const EMPTY: ThesisDraft = {
  thesis: "",
  mustGoRight: "",
  couldBreak: "",
  horizon: "",
  status: "active",
  conditions: [],
};

const METRIC_KEYS = Object.keys(THESIS_METRICS) as ThesisMetricKey[];

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted/60";

/**
 * Writing and editing a thesis.
 *
 * Every field is the reader's own. The form offers no suggested thesis, no
 * default target and no status beyond "Active"; it only checks, through the
 * server action, that each condition can be measured.
 */
export function ThesisEditor({
  symbol,
  companyName,
  initial,
}: {
  symbol: string;
  companyName: string;
  initial: ThesisDraft | null;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<ThesisDraft>(initial ?? EMPTY);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const update = <K extends keyof ThesisDraft>(key: K, value: ThesisDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  const setCondition = (index: number, patch: Partial<ThesisDraft["conditions"][number]>) =>
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    }));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    startTransition(async () => {
      const result = await saveThesis(symbol, {
        thesis: draft.thesis,
        mustGoRight: draft.mustGoRight,
        couldBreak: draft.couldBreak,
        horizon: draft.horizon || null,
        status: draft.status,
        conditions: draft.conditions.map((c) => ({
          metric: c.metric,
          operator: c.operator,
          target: c.target.trim() === "" ? null : Number(c.target),
        })),
      });
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) setOpen(false);
    });
  }

  function onDelete() {
    setMessage(null);
    startTransition(async () => {
      const result = await deleteThesis(symbol);
      setMessage({ ok: result.ok, text: result.message });
      setConfirmDelete(false);
    });
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            setDraft(initial ?? EMPTY);
            setMessage(null);
            setOpen(true);
          }}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90"
        >
          {initial ? "Edit thesis" : `Write a thesis for ${companyName}`}
        </button>
        {initial &&
          (confirmDelete ? (
            <>
              <button
                type="button"
                onClick={onDelete}
                disabled={pending}
                className="rounded-lg bg-poor px-3 py-2 text-sm font-medium text-poor-fg disabled:opacity-60"
              >
                Delete this thesis
              </button>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-strong hover:bg-surface-2"
              >
                Keep it
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-muted-strong hover:bg-surface-2"
            >
              Delete
            </button>
          ))}
        {message && (
          <p role="status" className={cn("text-xs", message.ok ? "text-good-fg" : "text-poor")}>
            {message.text}
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <TextField
        id={`thesis-${symbol}`}
        label="My thesis"
        value={draft.thesis}
        onChange={(v) => update("thesis", v)}
        placeholder={`Why you are following ${companyName}, in your own words.`}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 md:grid-cols-2">
        <TextField
          id={`must-${symbol}`}
          label="What must go right?"
          value={draft.mustGoRight}
          onChange={(v) => update("mustGoRight", v)}
        />
        <TextField
          id={`break-${symbol}`}
          label="What could break the thesis?"
          value={draft.couldBreak}
          onChange={(v) => update("couldBreak", v)}
        />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 sm:grid-cols-2">
        <div>
          <label htmlFor={`horizon-${symbol}`} className="text-xs text-muted">Time horizon</label>
          <select
            id={`horizon-${symbol}`}
            value={draft.horizon}
            onChange={(e) => update("horizon", e.target.value)}
            className={inputClass}
          >
            <option value="">Not set</option>
            {Object.entries(TIME_HORIZONS).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor={`status-${symbol}`} className="text-xs text-muted">Status</label>
          <select
            id={`status-${symbol}`}
            value={draft.status}
            onChange={(e) => update("status", e.target.value)}
            className={inputClass}
          >
            {Object.entries(THESIS_STATUSES).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-xs text-muted">
          Conditions to check against each annual report (optional, up to {MAX_CONDITIONS})
        </legend>
        {draft.conditions.map((condition, index) => {
          const unit = THESIS_METRICS[condition.metric].unit;
          const needsTarget = condition.operator === "above" || condition.operator === "below";
          return (
            <div key={index} className="flex flex-wrap items-end gap-2 rounded-lg border border-border p-2.5">
              <div className="min-w-0 flex-1 basis-48">
                <label htmlFor={`metric-${symbol}-${index}`} className="sr-only">Metric</label>
                <select
                  id={`metric-${symbol}-${index}`}
                  value={condition.metric}
                  onChange={(e) => {
                    const metric = e.target.value as ThesisMetricKey;
                    const operators = OPERATORS_FOR[THESIS_METRICS[metric].unit];
                    setCondition(index, {
                      metric,
                      operator: operators.includes(condition.operator) ? condition.operator : operators[0],
                    });
                  }}
                  className="w-full rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
                >
                  {METRIC_KEYS.map((key) => (
                    <option key={key} value={key}>{THESIS_METRICS[key].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor={`operator-${symbol}-${index}`} className="sr-only">Comparison</label>
                <select
                  id={`operator-${symbol}-${index}`}
                  value={condition.operator}
                  onChange={(e) => setCondition(index, { operator: e.target.value as ConditionOperator })}
                  className="rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
                >
                  {OPERATORS_FOR[unit].map((op) => (
                    <option key={op} value={op}>{OPERATOR_LABEL[op]}</option>
                  ))}
                </select>
              </div>
              {needsTarget && (
                <div className="flex items-center gap-1">
                  <label htmlFor={`target-${symbol}-${index}`} className="sr-only">Target</label>
                  <input
                    id={`target-${symbol}-${index}`}
                    type="number"
                    step="any"
                    inputMode="decimal"
                    required
                    value={condition.target}
                    onChange={(e) => setCondition(index, { target: e.target.value })}
                    className="w-24 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-sm"
                  />
                  <span className="text-sm text-muted">{unit === "percent" ? "%" : "x"}</span>
                </div>
              )}
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    conditions: current.conditions.filter((_, i) => i !== index),
                  }))
                }
                aria-label={`Remove the ${THESIS_METRICS[condition.metric].label} condition`}
                className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-poor"
              >
                <X aria-hidden className="size-4" />
              </button>
            </div>
          );
        })}
        <button
          type="button"
          disabled={draft.conditions.length >= MAX_CONDITIONS}
          onClick={() =>
            setDraft((current) => ({
              ...current,
              conditions: [...current.conditions, { metric: "revenueGrowth", operator: "above", target: "" }],
            }))
          }
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs font-medium text-muted-strong transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          <Plus aria-hidden className="size-3.5" />
          Add a condition
        </button>
      </fieldset>

      <p className="text-xs leading-relaxed text-muted">
        Conditions are checked against each annual report as it is filed. The status stays as you
        set it — WylthIQ never changes it or suggests what to believe.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save thesis"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted-strong hover:bg-surface-2"
        >
          Cancel
        </button>
        {message && (
          <p role="status" className={cn("text-xs", message.ok ? "text-good-fg" : "text-poor")}>
            {message.text}
          </p>
        )}
      </div>
    </form>
  );
}

function TextField({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted">{label}</label>
      <textarea
        id={id}
        rows={3}
        maxLength={MAX_THESIS_TEXT}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
    </div>
  );
}
