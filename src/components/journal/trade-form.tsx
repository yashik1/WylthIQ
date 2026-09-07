"use client";

import { useActionState, useState } from "react";
import {
  closeTrade,
  createPlaybook,
  createTrade,
  deleteTrade,
  type TradeResult,
} from "@/lib/journal/trade-actions";
import type { Playbook } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

const FIELD =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";
const LABEL = "text-xs text-muted";

function Feedback({ state }: { state: TradeResult | null }) {
  if (!state) return null;
  return (
    <p className={cn("text-xs", state.ok ? "text-up" : "text-poor")} role="status">
      {state.message}
    </p>
  );
}

/**
 * Logging a trade.
 *
 * Only four fields are required — symbol, side, size, entry — because a
 * journal nobody fills in is worth nothing, and the moment to capture a trade
 * is while it is still open and you have no idea how it ends. Everything that
 * makes the analysis richer is optional and can be added on the way out.
 *
 * The stop is the one optional field worth pressing on, and the form says so:
 * without it there is no defined risk, and without risk there is no R-multiple
 * on this trade or in any average that includes it.
 */
export function NewTradeForm({ playbooks }: { playbooks: Playbook[] }) {
  const [state, action, pending] = useActionState(createTrade, null);
  const [closing, setClosing] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={action} className="space-y-4 p-5">
      <div className="grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-5">
        <div>
          <label htmlFor="t-symbol" className={LABEL}>Symbol</label>
          <input id="t-symbol" name="symbol" required maxLength={20} placeholder="AAPL"
            className={cn(FIELD, "uppercase placeholder:normal-case")} />
        </div>
        <div>
          <label htmlFor="t-side" className={LABEL}>Direction</label>
          <select id="t-side" name="side" className={FIELD} defaultValue="long">
            <option value="long">Long — bought first</option>
            <option value="short">Short — sold first</option>
          </select>
        </div>
        <div>
          <label htmlFor="t-qty" className={LABEL}>Size</label>
          <input id="t-qty" name="quantity" required type="number" step="any" min="0"
            placeholder="100" className={FIELD} />
        </div>
        <div>
          <label htmlFor="t-entry" className={LABEL}>Entry price</label>
          <input id="t-entry" name="entryPrice" required type="number" step="any" min="0"
            placeholder="184.50" className={FIELD} />
        </div>
        <div>
          <label htmlFor="t-opened" className={LABEL}>Opened</label>
          <input id="t-opened" name="openedAt" type="date" defaultValue={today} className={FIELD} />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 border-t border-border pt-4 @md:grid-cols-2 @4xl:grid-cols-5">
        <div>
          <label htmlFor="t-stop" className={LABEL}>Stop</label>
          <input id="t-stop" name="stopPrice" type="number" step="any" min="0"
            placeholder="180.00" className={FIELD} />
        </div>
        <div>
          <label htmlFor="t-target" className={LABEL}>Target</label>
          <input id="t-target" name="targetPrice" type="number" step="any" min="0"
            placeholder="196.00" className={FIELD} />
        </div>
        <div>
          <label htmlFor="t-fees" className={LABEL}>Fees</label>
          <input id="t-fees" name="fees" type="number" step="any" min="0"
            placeholder="0" className={FIELD} />
        </div>
        <div className="@4xl:col-span-2">
          <label htmlFor="t-playbook" className={LABEL}>Strategy</label>
          <select id="t-playbook" name="playbookId" className={FIELD} defaultValue="">
            <option value="">No strategy</option>
            {playbooks.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Setting a stop is what makes every R figure on the page possible, so
          the form says what leaving it blank costs rather than staying silent
          and quietly reporting "no stops set" later. */}
      <p className="text-xs leading-relaxed text-faint">
        A stop is optional, but it is what defines the risk on a trade — without one,
        this trade has no R-multiple and sits out of your average R.
      </p>

      <div className="border-t border-border pt-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" checked={closing} onChange={(e) => setClosing(e.target.checked)}
            className="size-4 accent-[var(--accent)]" />
          Already closed
        </label>

        {closing && (
          <div className="mt-3 grid grid-cols-1 gap-3 @md:grid-cols-2 @4xl:grid-cols-5">
            <div>
              <label htmlFor="t-exit" className={LABEL}>Exit price</label>
              <input id="t-exit" name="exitPrice" type="number" step="any" min="0"
                placeholder="191.20" className={FIELD} />
            </div>
            <div>
              <label htmlFor="t-closed" className={LABEL}>Closed</label>
              <input id="t-closed" name="closedAt" type="date" defaultValue={today} className={FIELD} />
            </div>
            <div className="@4xl:col-span-3">
              <label htmlFor="t-followed" className={LABEL}>Did you follow your rules?</label>
              <select id="t-followed" name="followedRules" className={FIELD} defaultValue="">
                <option value="">Not saying</option>
                <option value="yes">Yes</option>
                <option value="no">No</option>
              </select>
            </div>
          </div>
        )}
      </div>

      <div>
        <label htmlFor="t-notes" className={LABEL}>Why you took it</label>
        <textarea id="t-notes" name="notes" rows={3}
          placeholder="What you saw, and what would make you wrong."
          className={cn(FIELD, "resize-y")} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending}
          className="rounded-lg border border-transparent bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60">
          {pending ? "Saving…" : "Log trade"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}

/** Closing an open position, inline in the trade log. */
export function CloseTradeForm({ id }: { id: number }) {
  const [state, action, pending] = useActionState(closeTrade, null);
  const [open, setOpen] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium transition-colors hover:border-accent hover:text-accent">
        Close
      </button>
    );
  }

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="id" value={id} />
      <div>
        <label htmlFor={`x-${id}`} className="text-[0.6875rem] text-muted">Exit</label>
        <input id={`x-${id}`} name="exitPrice" required type="number" step="any" min="0"
          className="tnum mt-0.5 w-24 rounded-lg border border-border bg-surface px-2 py-1 text-xs" />
      </div>
      <div>
        <label htmlFor={`d-${id}`} className="text-[0.6875rem] text-muted">On</label>
        <input id={`d-${id}`} name="closedAt" type="date" defaultValue={today}
          className="mt-0.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs" />
      </div>
      <div>
        <label htmlFor={`r-${id}`} className="text-[0.6875rem] text-muted">Rules?</label>
        <select id={`r-${id}`} name="followedRules" defaultValue=""
          className="mt-0.5 rounded-lg border border-border bg-surface px-2 py-1 text-xs">
          <option value="">—</option>
          <option value="yes">Kept</option>
          <option value="no">Broke</option>
        </select>
      </div>
      <button type="submit" disabled={pending}
        className="rounded-lg border border-transparent bg-accent px-2.5 py-1 text-xs font-medium text-accent-fg disabled:opacity-60">
        {pending ? "…" : "Save"}
      </button>
      <button type="button" onClick={() => setOpen(false)}
        className="px-2 py-1 text-xs text-muted hover:text-foreground">
        Cancel
      </button>
      <Feedback state={state} />
    </form>
  );
}

export function DeleteTradeButton({ id }: { id: number }) {
  const [state, action, pending] = useActionState(deleteTrade, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="id" value={id} />
      <button type="submit" disabled={pending}
        className="text-xs text-faint transition-colors hover:text-poor disabled:opacity-50">
        {pending ? "…" : "Delete"}
      </button>
      {state && !state.ok && <span className="ml-2 text-xs text-poor">{state.message}</span>}
    </form>
  );
}

/**
 * Writing down a strategy.
 *
 * The rules field is the one that matters. A strategy without written rules
 * cannot be broken, which sounds convenient and means the discipline report
 * has nothing to measure — "did I follow it" is only answerable against
 * something written down before the trade.
 */
export function NewPlaybookForm() {
  const [state, action, pending] = useActionState(createPlaybook, null);

  return (
    <form action={action} className="space-y-3 p-5">
      <div>
        <label htmlFor="p-name" className={LABEL}>Name</label>
        <input id="p-name" name="name" required maxLength={120}
          placeholder="Breakout on earnings gap" className={FIELD} />
      </div>
      <div>
        <label htmlFor="p-desc" className={LABEL}>What the setup is</label>
        <input id="p-desc" name="description" maxLength={400}
          placeholder="Gap up over 4% on results, hold above the opening range." className={FIELD} />
      </div>
      <div>
        <label htmlFor="p-rules" className={LABEL}>Rules — one per line</label>
        <textarea id="p-rules" name="rules" rows={4}
          placeholder={"Only after a results release\nStop under the opening range low\nRisk no more than 1% of the account\nNo entry after 11am"}
          className={cn(FIELD, "resize-y font-mono text-xs")} />
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending}
          className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-60">
          {pending ? "Saving…" : "Add strategy"}
        </button>
        <Feedback state={state} />
      </div>
    </form>
  );
}
