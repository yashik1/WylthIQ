"use client";

import { useActionState } from "react";
import { createEntry, deleteEntry, type JournalResult } from "@/lib/journal/actions";
import { cn } from "@/lib/utils";

const KINDS = [
  { value: "note", label: "Note" },
  { value: "buy", label: "Bought" },
  { value: "sell", label: "Sold" },
  { value: "watch", label: "Watching" },
];

/**
 * Writing a new entry.
 *
 * Deliberately short. A journal nobody fills in is worthless, and the field
 * that actually matters months later is "why" — so that one gets the room and
 * a prompt, while everything else stays optional.
 */
export function NewEntryForm() {
  const [state, action, pending] = useActionState(createEntry, null);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-3 p-5">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 @md:grid-cols-2 @3xl:grid-cols-[minmax(0,1fr)_8rem_8rem_9rem]">
        <div>
          <label htmlFor="title" className="text-xs text-muted">
            What happened
          </label>
          <input
            id="title"
            name="title"
            required
            maxLength={200}
            placeholder="Bought AAPL after the Q3 filing"
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label htmlFor="symbol" className="text-xs text-muted">
            Ticker
          </label>
          <input
            id="symbol"
            name="symbol"
            maxLength={20}
            placeholder="AAPL"
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm uppercase placeholder:normal-case"
          />
        </div>
        <div>
          <label htmlFor="kind" className="text-xs text-muted">
            Kind
          </label>
          <select
            id="kind"
            name="kind"
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          >
            {KINDS.map((k) => (
              <option key={k.value} value={k.value}>
                {k.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="entryDate" className="text-xs text-muted">
            Date
          </label>
          <input
            id="entryDate"
            name="entryDate"
            type="date"
            defaultValue={today}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label htmlFor="body" className="text-xs text-muted">
          Why — the part worth reading back later
        </label>
        <textarea
          id="body"
          name="body"
          rows={4}
          maxLength={20000}
          placeholder="What made this look like a good idea, and what would have to be true for it not to be."
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
        />
      </div>

      {/*
        The action sits at the far end rather than tucked against the last
        field, which is where a form's submit is looked for and which stops
        the row reading as one small cluster adrift in empty space.
      */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <label htmlFor="conviction" className="text-xs text-muted">
            Conviction 1–5 (optional)
          </label>
          <input
            id="conviction"
            name="conviction"
            type="number"
            min={1}
            max={5}
            className="tnum mt-1 w-20 rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          />
        </div>
        {/*
          Grouped with the button rather than left as a third child of the
          row: under justify-between a loose third item is pushed to the
          middle, so "Saved." would have drifted away from the control that
          caused it.
        */}
        <div className="flex items-center gap-3">
          {state && (
            <span
              role="status"
              className={cn("text-xs", state.ok ? "text-good-fg" : "text-poor-fg")}
            >
              {state.message}
            </span>
          )}
          <button
            type="submit"
            disabled={pending}
            className={cn(
              "h-fit rounded-lg border border-transparent bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity",
              pending ? "cursor-wait opacity-60" : "hover:opacity-90",
            )}
          >
            {pending ? "Saving…" : "Save entry"}
          </button>
        </div>
      </div>
    </form>
  );
}

/**
 * Delete, as its own form.
 *
 * Carries nothing but the id, and the action pairs that id with the caller's
 * own userId in the WHERE clause — so a guessed number deletes nothing.
 */
export function DeleteEntryButton({ id }: { id: number }) {
  const [state, action, pending] = useActionState(deleteEntry, null);

  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-muted underline transition-colors hover:text-poor-fg"
      >
        {pending ? "Deleting…" : "Delete"}
      </button>
      {state && !state.ok && (
        <span className="ml-2 text-xs text-poor-fg">{state.message}</span>
      )}
    </form>
  );
}

export type { JournalResult };
