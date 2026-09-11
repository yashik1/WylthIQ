"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent, type ReactNode } from "react";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { LocalTime } from "@/components/local-time";
import {
  deleteSavedScreen,
  duplicateSavedScreen,
  renameSavedScreen,
  saveScreen,
} from "@/lib/saved-screens";
import { MAX_SCREEN_NAME } from "@/lib/saved-screen-names";
import type { ScreenFilters } from "@/lib/screener";
import { cn } from "@/lib/utils";

/**
 * Saving, opening and tidying saved screens.
 *
 * Every write goes through a server action that re-checks the session and
 * scopes the row by its owner; nothing here is trusted to decide whose screen
 * it is. The actions revalidate /screen, so the list re-renders from the
 * database after each change rather than from state held here.
 */

type ActionResult = { ok: boolean; error?: string };

/** Saves the filters on screen now. A name already in use updates that screen. */
export function SaveScreenForm({
  filters,
  defaultName = "",
}: {
  filters: ScreenFilters;
  /** The name of the saved screen these filters started from, if any. */
  defaultName?: string;
}) {
  const [name, setName] = useState(defaultName);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const chosen = name.trim();
    startTransition(async () => {
      const result = await saveScreen(chosen, filters);
      setMessage(
        result.ok
          ? { ok: true, text: `Saved as “${chosen}”.` }
          : { ok: false, text: result.error ?? "Could not save that screen." },
      );
    });
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-2">
      <div className="min-w-0 flex-1 basis-56">
        <label htmlFor="save-screen-name" className="text-xs text-muted">
          Save these filters as
        </label>
        <input
          id="save-screen-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={MAX_SCREEN_NAME}
          required
          placeholder="e.g. Canadian quality"
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm placeholder:text-muted/60"
        />
      </div>
      <button
        type="submit"
        disabled={pending}
        className="rounded-lg border border-transparent bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? "Saving…" : "Save screen"}
      </button>
      <p className="w-full text-xs text-muted">
        Saving under a name you already use updates that screen.
      </p>
      {message && (
        <p role="status" className={cn("w-full text-xs", message.ok ? "text-good-fg" : "text-poor")}>
          {message.text}
        </p>
      )}
    </form>
  );
}

export interface SavedScreenSummary {
  id: number;
  name: string;
  /** What it filters on, in one line. */
  summary: string;
  /** ISO timestamp of the last time it was opened. */
  lastRunAt: string | null;
  lastResultCount: number | null;
}

/** One saved screen: open it, rename it, copy it or delete it. */
export function SavedScreenItem({
  screen,
  active,
}: {
  screen: SavedScreenSummary;
  /** True when the filters on screen started from this one. */
  active: boolean;
}) {
  const [mode, setMode] = useState<"idle" | "rename" | "confirm-delete">("idle");
  const [name, setName] = useState(screen.name);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function run(action: () => Promise<ActionResult>, onDone?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (result.ok) onDone?.();
      else setError(result.error ?? "That did not work just now.");
    });
  }

  function onRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    run(
      () => renameSavedScreen(screen.id, name),
      () => setMode("idle"),
    );
  }

  const count = screen.lastResultCount;

  return (
    <li className={cn("px-5 py-3", active && "bg-accent-soft/60")}>
      {mode === "rename" ? (
        <form onSubmit={onRename} className="flex flex-wrap items-center gap-2">
          <label htmlFor={`rename-screen-${screen.id}`} className="sr-only">
            New name for {screen.name}
          </label>
          <input
            id={`rename-screen-${screen.id}`}
            value={name}
            onChange={(e) => setName(e.target.value)}
            maxLength={MAX_SCREEN_NAME}
            required
            autoFocus
            className="min-w-0 flex-1 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm"
          />
          <button
            type="submit"
            disabled={pending}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-accent-fg disabled:opacity-60"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              setMode("idle");
              setName(screen.name);
            }}
            className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-strong hover:bg-surface-2"
          >
            Cancel
          </button>
        </form>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <Link
              href={`/screen?saved=${screen.id}`}
              aria-current={active ? "true" : undefined}
              className="text-sm font-semibold transition-colors hover:text-accent hover:underline"
            >
              {screen.name}
            </Link>
            <p className="mt-0.5 text-xs text-muted">{screen.summary}</p>
            <p className="mt-0.5 text-xs text-faint">
              {screen.lastRunAt ? (
                <>
                  Last opened <LocalTime value={screen.lastRunAt} mode="relative" />
                  {count != null && ` · ${count} ${count === 1 ? "company" : "companies"} then`}
                </>
              ) : (
                "Not opened since it was saved"
              )}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            {mode === "confirm-delete" ? (
              <>
                <button
                  type="button"
                  onClick={() => run(() => deleteSavedScreen(screen.id))}
                  disabled={pending}
                  className="rounded-lg bg-poor px-3 py-1.5 text-xs font-medium text-poor-fg disabled:opacity-60"
                >
                  Delete “{screen.name}”
                </button>
                <button
                  type="button"
                  onClick={() => setMode("idle")}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-strong hover:bg-surface-2"
                >
                  Keep
                </button>
              </>
            ) : (
              <>
                <IconButton
                  label={`Rename ${screen.name}`}
                  onClick={() => setMode("rename")}
                  disabled={pending}
                >
                  <Pencil aria-hidden className="size-3.5" />
                </IconButton>
                <IconButton
                  label={`Duplicate ${screen.name}`}
                  onClick={() => run(() => duplicateSavedScreen(screen.id))}
                  disabled={pending}
                >
                  <Copy aria-hidden className="size-3.5" />
                </IconButton>
                <IconButton
                  label={`Delete ${screen.name}`}
                  onClick={() => setMode("confirm-delete")}
                  disabled={pending}
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </IconButton>
              </>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-1.5 text-xs text-poor">
          {error}
        </p>
      )}
    </li>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="rounded-md p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:opacity-50"
    >
      {children}
    </button>
  );
}
