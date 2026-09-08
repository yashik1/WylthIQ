"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { ActionResult } from "@/lib/auth/actions";

/**
 * The shared shell for every account form.
 *
 * All four — sign in, sign up, request a reset, set a new password — are the
 * same shape: a heading, a few fields, one button, one message. Sharing the
 * shell keeps them consistent and means the message rendering, which is the
 * part that must never leak whether an address exists, is written once.
 */
export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-md py-10">
      <h1 className="font-display text-3xl sm:text-4xl">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">{subtitle}</p>

      <div className="mt-6 rounded-[var(--radius)] border border-border bg-surface p-5 shadow-[var(--shadow-sm)]">
        {children}
      </div>

      {footer && <div className="mt-4 text-sm text-muted">{footer}</div>}
    </div>
  );
}

export function Field({
  label,
  name,
  type = "text",
  autoComplete,
  required,
  defaultValue,
  hint,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  defaultValue?: string;
  hint?: string;
}) {
  return (
    <div className="mb-4">
      <label htmlFor={name} className="text-xs text-muted">
        {label}
      </label>
      <input
        id={name}
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        defaultValue={defaultValue}
        className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm"
      />
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function SubmitButton({ label, pending }: { label: string; pending: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending}
      className={cn(
        "w-full rounded-lg border border-transparent bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity",
        pending ? "cursor-wait opacity-60" : "hover:opacity-90",
      )}
    >
      {pending ? "Working…" : label}
    </button>
  );
}

/**
 * A form driven by one of the auth server actions.
 *
 * The message is rendered exactly as the action returned it, with no branch
 * here that adds detail. Some of those messages are deliberately identical
 * for outcomes a visitor should not be able to tell apart — the reset form
 * answers the same way for a known and an unknown address — and a
 * helpful-looking addition at this layer would undo that in every form at
 * once.
 *
 * Suggested usernames are the one exception, and they are passed through
 * rather than composed: the action decides whether there are any, and this
 * only decides how a list of them looks.
 */
export function ActionForm({
  action,
  submitLabel,
  children,
  onSuccess,
}: {
  action: (prev: ActionResult | null, form: FormData) => Promise<ActionResult>;
  submitLabel: string;
  children: React.ReactNode;
  /**
   * Called once when the action reports success, with what was submitted —
   * the same snapshot the refusal path re-fills from, so passwords are not
   * in it.
   *
   * Exists so a form can trigger something beyond its own message without
   * this component learning what that something is. Sign-up uses it to offer
   * the newsletter; nothing here knows that, which is what keeps the message
   * rendering below the single place it is written.
   */
  onSuccess?: (values: Record<string, string>) => void;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const submitted = useRef<Record<string, string>>({});

  /**
   * Remembers what was typed, so a rejection does not also erase it.
   *
   * React resets a form automatically once its action resolves. That is the
   * right default for a form that succeeded and the wrong one for a form that
   * did not: being told a username is taken is only useful if the email and
   * everything else are still there to submit again, and clicking a suggested
   * username is no help at all if it lands in an otherwise empty form.
   */
  async function run(prev: ActionResult | null, formData: FormData) {
    const snapshot: Record<string, string> = {};
    for (const [key, value] of formData.entries()) {
      // Passwords are deliberately not kept. Retyping one is a small cost;
      // holding it in memory to re-inject into the DOM is not worth paying.
      if (typeof value === "string" && key !== "password") snapshot[key] = value;
    }
    submitted.current = snapshot;
    return action(prev, formData);
  }

  const [state, formAction, pending] = useActionState(run, null);

  /*
    Fired once per success, not once per render.

    `useActionState` hands back the same object until the next submission, so
    the guard is the state object itself rather than a boolean — a second
    successful submit is a new object and gets its own call, while a re-render
    caused by anything else gets none.
  */
  const announced = useRef<ActionResult | null>(null);
  useEffect(() => {
    if (!state?.ok || announced.current === state) return;
    announced.current = state;
    onSuccess?.(submitted.current);
  }, [state, onSuccess]);

  useEffect(() => {
    // Only after a refusal — a successful sign-up should leave a clean form.
    if (!state || state.ok) return;
    const form = formRef.current;
    if (!form) return;

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;

    for (const [key, value] of Object.entries(submitted.current)) {
      const field = form.elements.namedItem(key);
      // Never clobber something typed since: only fields the reset emptied.
      if (field instanceof HTMLInputElement && field.type !== "password" && !field.value) {
        setter?.call(field, value);
        field.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }, [state]);

  /**
   * Puts a suggestion into the username field.
   *
   * Written to the input rather than held in React state, because these forms
   * are uncontrolled — every other field keeps its value in the DOM, and
   * introducing state for this one alone would mean the two disagree after a
   * failed submit. The native setter is used so React notices the change on a
   * field it is not tracking.
   */
  function applySuggestion(value: string) {
    const field = formRef.current?.elements.namedItem("name");
    if (!(field instanceof HTMLInputElement)) return;

    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    setter?.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.focus();
  }

  return (
    <form action={formAction} ref={formRef}>
      {children}
      <SubmitButton label={submitLabel} pending={pending} />

      {state && (
        <div
          role="status"
          className={cn(
            "mt-3 rounded-lg border px-3 py-2 text-xs leading-relaxed",
            state.ok
              ? "border-good/30 bg-good-soft text-good-fg"
              : "border-poor/30 bg-poor-soft text-poor-fg",
          )}
        >
          <p>{state.message}</p>

          {state.suggestions && state.suggestions.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {state.suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => applySuggestion(suggestion)}
                    className="rounded border border-current/30 px-2 py-1 font-medium transition-colors hover:bg-current/10"
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </form>
  );
}

export function AuthFooterLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="text-accent underline">
      {children}
    </Link>
  );
}
