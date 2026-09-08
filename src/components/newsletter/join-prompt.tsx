"use client";

import { useEffect, useRef } from "react";
import { NewsletterSubscribeForm } from "./subscribe-form";

/**
 * The newsletter offer, made once, right after an account is created.
 *
 * This is the moment somebody has just decided they want this site, and it is
 * also the only moment the app knows their address without having asked for
 * it twice. Anywhere later is a worse offer to a colder reader.
 *
 * Deliberately an offer and not a consequence. Creating an account is consent
 * to run the account, never consent to be marketed at, and the newsletter's
 * own double opt-in would refuse to treat it as such anyway — nothing is sent
 * until a confirmation link is clicked. So this asks, with the answer left
 * genuinely open: dismissing it subscribes nobody and is one click, the same
 * as accepting.
 *
 * A native `<dialog>` rather than a hand-built overlay. It gives focus
 * containment, an inert page behind it and the top layer for free — all of
 * which a div would have to reimplement, and most hand-built modals
 * reimplement the first one wrongly.
 *
 * Mounted means open. There is no `open` prop, because two sources of truth
 * for whether a dialog is showing is exactly how one ends up closed on screen
 * and open in state.
 */
export function NewsletterJoinPrompt({
  email,
  onDismiss,
}: {
  /** Pre-fills the field. The address they just signed up with. */
  email: string;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    /*
      `showModal()` rather than the `open` attribute, which renders the
      element inline and modal in name only — no top layer, no focus
      containment, and the page behind it still tabbable.
    */
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);

  /*
    Every way out calls `onDismiss` directly, and none of them listens for the
    element's own `close` event.

    That event is the obvious way to write this and it is not reliable: a
    plain, React-free dialog in Chrome 148 here closes on `close()` without
    dispatching `close` at all. Built on it, the dialog disappeared from the
    screen while the component that owns it still believed it was open — the
    worst shape of bug, because everything looks right until the state is read
    again. Driving dismissal explicitly costs three small handlers and cannot
    drift from what is on screen.

    `preventDefault` on cancel is the other half: Escape would otherwise close
    the element natively, behind React, leaving the same disagreement. The
    keydown handler is the belt to that braces — `cancel` is dispatched by the
    same machinery `close` is, and this dialog no longer trusts it.
  */
  return (
    <dialog
      ref={ref}
      aria-labelledby="newsletter-prompt-title"
      onCancel={(e) => {
        e.preventDefault();
        onDismiss();
      }}
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.preventDefault();
        onDismiss();
      }}
      onClick={(e) => {
        // The backdrop. A modal dialog's own box is the only thing that can be
        // the target here; anything visible inside it is a child.
        if (e.target === ref.current) onDismiss();
      }}
      /*
        `backdrop:` needs the variant because the pseudo-element is not a
        child — there is nothing else to put the overlay colour on. `m-auto`
        centres it: a dialog in the top layer is positioned by margin, not by
        flex on any ancestor.
      */
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-[var(--radius)] border border-border bg-surface p-5 text-foreground shadow-[var(--shadow-sm)] backdrop:bg-black/40"
    >
      <p className="eyebrow mb-2">Weekly newsletter</p>
      <h2 id="newsletter-prompt-title" className="font-display text-2xl leading-tight">
        One email a week?
      </h2>
      <p className="mt-2 max-w-[40ch] text-[0.8125rem] leading-relaxed text-muted">
        What the companies we score actually filed that week — from their SEC
        filings. No prices, no tips, one email. Unsubscribe from any of them.
      </p>

      <NewsletterSubscribeForm defaultEmail={email} className="mt-4" />

      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 text-xs text-muted underline transition-colors hover:text-foreground"
      >
        No thanks
      </button>
    </dialog>
  );
}
