"use client";

import { useActionState, useRef } from "react";
import { changeUsername } from "@/lib/auth/actions";
import { cn } from "@/lib/utils";

/**
 * Changing your username.
 *
 * Its own small form rather than a field inside the shared AuthShell: this
 * one sits on a page somebody is already signed in to, is pre-filled with
 * what they have now, and its success case is a change rather than a journey
 * to another page.
 *
 * The suggestion chips work the same way the sign-up form's do — written
 * straight into the input, because the field is uncontrolled and adding
 * state for it alone would let the two disagree after a failed submit.
 */
export function UsernameForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState(changeUsername, null);
  const inputRef = useRef<HTMLInputElement>(null);

  function applySuggestion(value: string) {
    const field = inputRef.current;
    if (!field) return;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
  }

  return (
    <form action={action} className="space-y-3 p-5">
      <div>
        <label htmlFor="account-username" className="text-xs text-muted">
          Username
        </label>
        <input
          ref={inputRef}
          id="account-username"
          name="name"
          defaultValue={current}
          autoComplete="username"
          maxLength={30}
          placeholder="Not set"
          className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent"
        />
        <p className="mt-1 text-xs text-faint">
          Letters, numbers, dots, dashes and underscores — no spaces. Leave it empty
          to go back to being shown by your email address.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save username"}
        </button>

        {state && (
          <span
            role="status"
            className={cn("text-xs", state.ok ? "text-up" : "text-poor")}
          >
            {state.message}
          </span>
        )}
      </div>

      {state?.suggestions && state.suggestions.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {state.suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => applySuggestion(suggestion)}
                className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:border-accent hover:text-accent"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </form>
  );
}
