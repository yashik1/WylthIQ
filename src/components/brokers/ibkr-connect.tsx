"use client";

import { useActionState } from "react";
import { LocalTime } from "@/components/local-time";
import {
  connectIbkr,
  disconnectIbkr,
  syncIbkrNow,
  type BrokerActionResult,
} from "@/lib/brokers/actions";
import { calendarDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Connecting Interactive Brokers, read-only, on the account page.
 *
 * The token is typed into a password field, sent once, checked against IBKR
 * and stored encrypted. It is never sent back to the browser: this card only
 * ever sees its last four characters.
 */

export interface ConnectionView {
  queryId: string;
  tokenHint: string;
  status: "ok" | "needs-attention" | "error";
  lastErrorCode: string | null;
  statementToDate: string | null;
  lastSyncedAt: string | null;
  accounts: string[];
  positions: number;
  linkedTrades: number;
  journalSince: string;
  skipped: { symbol: string; reason: string }[];
}

const button =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-60";
const input =
  "mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none transition-colors focus:border-accent";

function Result({ state }: { state: BrokerActionResult | null }) {
  if (!state) return null;
  return (
    <div role="status" className="space-y-1">
      <p className={cn("text-xs", state.ok ? "text-up" : "text-poor")}>{state.message}</p>
      {state.notes?.map((note) => (
        <p key={note} className="text-xs leading-relaxed text-muted">
          {note}
        </p>
      ))}
    </div>
  );
}

function SetupSteps() {
  return (
    <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
      <li>
        In IBKR&apos;s Client Portal, open <strong>Performance &amp; Reports → Flex Queries</strong>.
      </li>
      <li>
        Create an <strong>Activity Flex Query</strong> with two sections: <strong>Open Positions</strong>{" "}
        at Summary level and <strong>Trades</strong> at Execution level, with every field selected in
        each. Set the format to <strong>XML</strong>, the period to{" "}
        <strong>Last 365 Calendar Days</strong>, and leave the date format as{" "}
        <strong>yyyyMMdd</strong>. Save it and note its <strong>Query ID</strong>.
      </li>
      <li>
        On the same page, open <strong>Flex Web Service Configuration</strong>, switch it on, and
        generate a token that expires after <strong>1 year</strong>. Leave &ldquo;Valid for IP
        address&rdquo; empty.
      </li>
      <li>Paste the token and the query ID below.</li>
    </ol>
  );
}

function ConnectForm({ replacing }: { replacing: boolean }) {
  const [state, action, pending] = useActionState(connectIbkr, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ibkr-token" className="text-xs text-muted">
            Flex Web Service token
          </label>
          <input
            id="ibkr-token"
            name="token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            className={input}
          />
        </div>
        <div>
          <label htmlFor="ibkr-query" className="text-xs text-muted">
            Flex query ID
          </label>
          <input id="ibkr-query" name="queryId" inputMode="numeric" autoComplete="off" required className={input} />
        </div>
      </div>

      <fieldset className="space-y-1 text-sm">
        <legend className="text-xs text-muted">Add past trades to the journal</legend>
        <label className="flex items-center gap-2">
          <input type="radio" name="history" value="year" defaultChecked />
          The last year of trades
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="history" value="new" />
          Only trades from today on
        </label>
      </fieldset>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Checking with IBKR…" : replacing ? "Replace token" : "Connect"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

function SyncButton() {
  const [state, action, pending] = useActionState(syncIbkrNow, null);
  return (
    <form action={action} className="space-y-2">
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Syncing…" : "Sync now"}
      </button>
      <Result state={state} />
    </form>
  );
}

function DisconnectForm({ linkedTrades }: { linkedTrades: number }) {
  const [state, action, pending] = useActionState(disconnectIbkr, null);
  return (
    <form action={action} className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={cn(button, "hover:border-poor hover:text-poor")}>
          {pending ? "Disconnecting…" : "Disconnect"}
        </button>
        {linkedTrades > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="removeTrades" />
            and remove the {linkedTrades} trade{linkedTrades === 1 ? "" : "s"} added from IBKR
          </label>
        )}
      </div>
      <Result state={state} />
    </form>
  );
}

export function IbkrConnect({
  connection,
  available,
}: {
  connection: ConnectionView | null;
  /** False when the server has no key to encrypt tokens with. */
  available: boolean;
}) {
  const readOnly = (
    <p className="text-sm leading-relaxed text-muted">
      Connects with IBKR&apos;s Flex Web Service. Its token can only download reports: it cannot
      place an order, move money, or change anything in your account. The token is stored
      encrypted and never shown again. Holdings appear on your portfolio and trades in your
      journal, refreshed once a day after IBKR&apos;s daily statement.
    </p>
  );

  if (!available) {
    return (
      <div className="space-y-3 p-5">
        {readOnly}
        <p className="text-sm text-muted">Connecting a broker is not set up on this server yet.</p>
      </div>
    );
  }

  if (!connection) {
    return (
      <div className="space-y-4 p-5">
        {readOnly}
        <SetupSteps />
        <ConnectForm replacing={false} />
      </div>
    );
  }

  const asOf = calendarDate(connection.statementToDate);

  return (
    <div className="space-y-4 p-5">
      <div className="space-y-1 text-sm">
        <p>
          <span className="font-medium">Interactive Brokers</span>{" "}
          <span className="text-muted">
            · query {connection.queryId} · token ending {connection.tokenHint}
            {connection.accounts.length > 0 && ` · ${connection.accounts.join(", ")}`}
          </span>
        </p>
        <p className="text-muted">
          {connection.positions} holding{connection.positions === 1 ? "" : "s"} and{" "}
          {connection.linkedTrades} journal trade{connection.linkedTrades === 1 ? "" : "s"}
          {asOf && `, as of IBKR's statement for ${asOf}`}.
          {connection.lastSyncedAt && (
            <>
              {" "}
              Last synced <LocalTime value={connection.lastSyncedAt} mode="relative" />.
            </>
          )}
        </p>
        <p className="text-xs text-faint">
          Trades opened from {calendarDate(connection.journalSince) ?? connection.journalSince} on are
          added to the journal.
        </p>
        {connection.status === "needs-attention" && (
          <p className="text-poor">
            IBKR stopped accepting this connection{connection.lastErrorCode ? ` (code ${connection.lastErrorCode})` : ""}.
            Its token has probably expired — generate a new one and replace it below.
          </p>
        )}
        {connection.status === "error" && (
          <p className="text-fair-fg">The last sync did not complete. It will be tried again.</p>
        )}
      </div>

      {connection.skipped.length > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted">
            {connection.skipped.length} item{connection.skipped.length === 1 ? "" : "s"} in the report not shown
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {connection.skipped.map((item) => (
              <li key={`${item.symbol}|${item.reason}`}>
                <span className="font-medium text-foreground">{item.symbol}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="flex flex-wrap items-start gap-4">
        <SyncButton />
        <DisconnectForm linkedTrades={connection.linkedTrades} />
      </div>

      <details open={connection.status === "needs-attention"} className="border-t border-border pt-4">
        <summary className="cursor-pointer text-sm text-muted">Replace the token or query</summary>
        <div className="mt-3 space-y-4">
          <SetupSteps />
          <ConnectForm replacing />
        </div>
      </details>
    </div>
  );
}
