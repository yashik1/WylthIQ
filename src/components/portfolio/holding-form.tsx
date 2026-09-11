"use client";

import { useState, useTransition, type FormEvent } from "react";
import { deleteHolding, saveHolding } from "@/lib/portfolio/actions";
import { parseHoldingInput } from "@/lib/portfolio/input";
import { cn } from "@/lib/utils";

const EMPTY = { symbol: "", quantity: "", averageCost: "", purchaseDate: "" };

const inputClass =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted/60";

/**
 * Adding or updating a holding.
 *
 * Checked in the browser first, with the same rules the server action applies,
 * so a mistyped number is caught before anything is sent. Entering a ticker
 * already held replaces that holding's quantity and cost.
 */
export function HoldingForm() {
  const [values, setValues] = useState(EMPTY);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const set = (key: keyof typeof EMPTY) => (value: string) =>
    setValues((current) => ({ ...current, [key]: value }));

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parseHoldingInput(values);
    if (!parsed.ok) {
      setMessage({ ok: false, text: parsed.message });
      return;
    }
    setMessage(null);
    startTransition(async () => {
      const result = await saveHolding(values);
      setMessage({ ok: result.ok, text: result.message });
      if (result.ok) setValues(EMPTY);
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-3 p-5">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field id="holding-symbol" label="Ticker" value={values.symbol} onChange={set("symbol")} placeholder="AAPL or RY.TO" autoCapitalize="characters" />
        <Field id="holding-quantity" label="Shares held" value={values.quantity} onChange={set("quantity")} placeholder="e.g. 25" inputMode="decimal" />
        <Field id="holding-cost" label="Average cost per share" value={values.averageCost} onChange={set("averageCost")} placeholder="e.g. 182.40" inputMode="decimal" />
        <div>
          <label htmlFor="holding-date" className="text-xs text-muted">
            Purchase date (optional)
          </label>
          <input
            id="holding-date"
            type="date"
            value={values.purchaseDate}
            onChange={(e) => set("purchaseDate")(e.target.value)}
            className={inputClass}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save holding"}
        </button>
        <p className="text-xs text-muted">
          Entering a ticker you already hold replaces its quantity and cost. Enter the cost in the
          currency the shares trade in.
        </p>
      </div>
      {message && (
        <p role={message.ok ? "status" : "alert"} className={cn("text-sm", message.ok ? "text-good-fg" : "text-poor")}>
          {message.text}
        </p>
      )}
    </form>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  placeholder,
  inputMode,
  autoCapitalize,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  inputMode?: "decimal";
  autoCapitalize?: string;
}) {
  return (
    <div>
      <label htmlFor={id} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        inputMode={inputMode}
        autoCapitalize={autoCapitalize}
        autoComplete="off"
        required
        className={inputClass}
      />
    </div>
  );
}

/** Removes one holding, after a second click. */
export function RemoveHoldingButton({ symbol }: { symbol: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="rounded-md px-2 py-1 text-xs text-muted transition-colors hover:bg-surface-2 hover:text-poor"
      >
        Remove<span className="sr-only"> {symbol}</span>
      </button>
    );
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await deleteHolding(symbol);
            if (!result.ok) setError(result.message);
          })
        }
        className="rounded-md bg-poor px-2 py-1 text-xs font-medium text-poor-fg disabled:opacity-60"
      >
        Remove {symbol}
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="rounded-md px-2 py-1 text-xs text-muted hover:bg-surface-2"
      >
        Keep
      </button>
      {error && <span role="alert" className="text-xs text-poor">{error}</span>}
    </span>
  );
}
