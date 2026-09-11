"use client";

import { useState, useTransition, type FormEvent } from "react";
import { setWatchlistGroup } from "@/lib/watchlist/actions";
import { MAX_GROUP_NAME, SUGGESTED_GROUPS } from "@/lib/watchlist/groups";
import { cn } from "@/lib/utils";

const NEW_GROUP = "__new__";

/**
 * Files one saved company under a group.
 *
 * Updated at once and put back if the write fails, like the save button: a
 * dropdown that pauses before accepting a choice feels broken. The server
 * action cleans the name and scopes the row by account; nothing here decides
 * what a valid group is.
 */
export function GroupPicker({
  symbol,
  group,
  groups,
}: {
  symbol: string;
  group: string | null;
  /** Every group this reader already uses, so a custom one is offered again. */
  groups: string[];
}) {
  const [value, setValue] = useState(group ?? "");
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const options = [...new Set<string>([...SUGGESTED_GROUPS, ...groups, ...(value ? [value] : [])])];

  function save(next: string) {
    const previous = value;
    setValue(next);
    setError(null);
    startTransition(async () => {
      const result = await setWatchlistGroup(symbol, next || null);
      if (!result.ok) {
        setValue(previous);
        setError(result.message ?? "Could not change that group.");
      }
    });
  }

  function onAdd(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = draft.replace(/\s+/g, " ").trim();
    if (!name) return;
    setAdding(false);
    setDraft("");
    save(name);
  }

  if (adding) {
    return (
      <form onSubmit={onAdd} className="flex items-center gap-1">
        <label htmlFor={`new-group-${symbol}`} className="sr-only">
          New group for {symbol}
        </label>
        <input
          id={`new-group-${symbol}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          maxLength={MAX_GROUP_NAME}
          autoFocus
          placeholder="Group name"
          className="w-28 rounded-md border border-border bg-surface px-2 py-1 text-xs"
        />
        <button
          type="submit"
          className="rounded-md bg-accent px-2 py-1 text-xs font-medium text-accent-fg"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => setAdding(false)}
          className="rounded-md px-1.5 py-1 text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </form>
    );
  }

  return (
    <div>
      <label htmlFor={`group-${symbol}`} className="sr-only">
        Group for {symbol}
      </label>
      <select
        id={`group-${symbol}`}
        value={value}
        disabled={pending}
        onChange={(e) => {
          if (e.target.value === NEW_GROUP) setAdding(true);
          else save(e.target.value);
        }}
        className={cn(
          "w-full max-w-[9.5rem] rounded-md border border-border bg-surface px-2 py-1 text-xs",
          pending && "opacity-60",
        )}
      >
        <option value="">No group</option>
        {options.map((name) => (
          <option key={name} value={name}>
            {name}
          </option>
        ))}
        <option value={NEW_GROUP}>New group…</option>
      </select>
      {error && (
        <p role="alert" className="mt-1 max-w-[12rem] text-[11px] leading-snug text-poor">
          {error}
        </p>
      )}
    </div>
  );
}
