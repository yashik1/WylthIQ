"use client";

import Link from "next/link";
import { useActionState, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { LocalTime } from "@/components/local-time";
import {
  connectIbkr,
  disconnectBroker,
  removeSnapTradeBrokerage,
  startSnapTradeConnect,
  syncBrokerNow,
  type BrokerActionResult,
} from "@/lib/brokers/actions";
import { calendarDate } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Connecting a broker, on the account page.
 *
 * Three ways in, and in the two open to everyone this app never holds a key
 * for the reader's broker: SnapTrade, where the reader connects on SnapTrade's
 * own page, and uploading a statement file. The third, pasting a Flex token,
 * is shown only to the addresses the site owner has listed.
 */

type Kind = "ibkr-flex" | "ibkr-upload" | "snaptrade";

export interface ConnectionView {
  broker: Kind;
  status: "ok" | "needs-attention" | "error";
  lastErrorCode: string | null;
  statementToDate: string | null;
  lastSyncedAt: string | null;
  positions: number;
  linkedTrades: number;
  journalSince: string;
  tokenHint: string | null;
  queryId: string | null;
  skipped: { symbol: string; reason: string }[];
  details: {
    brokerages?: { id: string; institution: string; disabled: boolean }[];
    accounts?: { id: string; institution: string; description: string }[];
    refused?: string[];
  };
}

const SNAPTRADE_TERMS = "https://snaptrade.com/terms-and-conditions";
const SNAPTRADE_PRIVACY = "https://snaptrade.com/privacy-policy";

const button =
  "rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:border-accent hover:text-accent disabled:opacity-60";
const primary =
  "rounded-lg bg-accent px-4 py-2 text-sm font-medium text-accent-fg transition-opacity hover:opacity-90 disabled:opacity-60";
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

function Section({ id, title, children }: { id?: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="space-y-3 border-t border-border p-5 first:border-t-0">
      <h3 className="text-sm font-semibold">{title}</h3>
      {children}
    </section>
  );
}

function HistoryChoice() {
  return (
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
  );
}

/** What a connection holds, when it last updated, and what it could not show. */
function Status({ connection }: { connection: ConnectionView }) {
  const asOf = calendarDate(connection.statementToDate);
  return (
    <div className="space-y-1 text-sm">
      <p className="text-muted">
        {connection.positions} holding{connection.positions === 1 ? "" : "s"} and {connection.linkedTrades} journal
        trade{connection.linkedTrades === 1 ? "" : "s"}
        {asOf && `, as of ${asOf}`}.
        {connection.lastSyncedAt && (
          <>
            {" "}
            Updated <LocalTime value={connection.lastSyncedAt} mode="relative" />.
          </>
        )}
      </p>
      <p className="text-xs text-faint">
        Trades opened from {calendarDate(connection.journalSince) ?? connection.journalSince} on are added to the
        journal.
      </p>
      {connection.status === "needs-attention" && (
        <p className="text-poor">
          This connection stopped working{connection.lastErrorCode ? ` (code ${connection.lastErrorCode})` : ""}.
          Connect it again below.
        </p>
      )}
      {connection.status === "error" && (
        <p className="text-fair-fg">The last update did not complete. It will be tried again.</p>
      )}
      {connection.skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer text-muted">
            {connection.skipped.length} item{connection.skipped.length === 1 ? "" : "s"} not shown
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {connection.skipped.map((item) => (
              <li key={item.symbol}>
                <span className="font-medium text-foreground">{item.symbol}</span> — {item.reason}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function SyncButton({ broker }: { broker: Kind }) {
  const [state, action, pending] = useActionState(syncBrokerNow, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="broker" value={broker} />
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Syncing…" : "Sync now"}
      </button>
      <Result state={state} />
    </form>
  );
}

function DisconnectForm({ broker, linkedTrades, label }: { broker: Kind; linkedTrades: number; label: string }) {
  const [state, action, pending] = useActionState(disconnectBroker, null);
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="broker" value={broker} />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" disabled={pending} className={cn(button, "hover:border-poor hover:text-poor")}>
          {pending ? "Removing…" : label}
        </button>
        {linkedTrades > 0 && (
          <label className="flex items-center gap-2 text-sm text-muted">
            <input type="checkbox" name="removeTrades" />
            and remove the {linkedTrades} trade{linkedTrades === 1 ? "" : "s"} it added
          </label>
        )}
      </div>
      <Result state={state} />
    </form>
  );
}

/* --------------------------------------------------------------- SnapTrade */

function StartSnapTrade({ again }: { again: boolean }) {
  const [state, action, pending] = useActionState(startSnapTradeConnect, null);
  useEffect(() => {
    // SnapTrade's own page, checked on the server to be SnapTrade's before it got here.
    if (state?.ok && state.url) window.location.assign(state.url);
  }, [state]);
  return (
    <form action={action} className="space-y-3">
      {!again && <HistoryChoice />}
      <button type="submit" disabled={pending || Boolean(state?.url)} className={again ? button : primary}>
        {pending || state?.url ? "Opening SnapTrade…" : again ? "Connect another broker" : "Connect a broker"}
      </button>
      {!state?.ok && <Result state={state} />}
    </form>
  );
}

/** Repairs a connection the broker has disabled, on SnapTrade's page, rather than adding a second one. */
function ReconnectBrokerage({ id, institution }: { id: string; institution: string }) {
  const [state, action, pending] = useActionState(startSnapTradeConnect, null);
  useEffect(() => {
    if (state?.ok && state.url) window.location.assign(state.url);
  }, [state]);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="reconnect" value={id} />
      <span className="text-xs text-poor">needs reconnecting</span>{" "}
      <button
        type="submit"
        disabled={pending || Boolean(state?.url)}
        className="text-xs font-medium text-accent underline underline-offset-2"
        aria-label={`Reconnect ${institution}`}
      >
        {pending || state?.url ? "Opening SnapTrade…" : "Reconnect"}
      </button>
      {state && !state.ok && <span className="ml-2 text-xs text-poor">{state.message}</span>}
    </form>
  );
}

function RemoveBrokerage({ id, institution }: { id: string; institution: string }) {
  const [state, action, pending] = useActionState(removeSnapTradeBrokerage, null);
  return (
    <form action={action} className="inline">
      <input type="hidden" name="authorizationId" value={id} />
      <button
        type="submit"
        disabled={pending}
        className="text-xs text-muted underline underline-offset-2 hover:text-poor"
        aria-label={`Remove ${institution}`}
      >
        {pending ? "Removing…" : "Remove"}
      </button>
      {state && !state.ok && <span className="ml-2 text-xs text-poor">{state.message}</span>}
    </form>
  );
}

function SnapTradeSection({
  connection,
  available,
  returned,
}: {
  connection: ConnectionView | undefined;
  available: boolean;
  returned: string | null;
}) {
  return (
    <Section id="connected-broker" title="Connect a broker">
      <p className="text-sm leading-relaxed text-muted">
        You connect on SnapTrade&apos;s page, not here, so WylthIQ never sees your broker login, password or key.
        Every connection is read-only: it cannot place an order or move money, and a connection that could trade is
        removed rather than used. For Interactive Brokers, SnapTrade asks you to switch it on in IBKR&apos;s Client
        Portal under <strong>Performance &amp; Reports → Third-Party Reports</strong>, and to paste the code IBKR shows
        into SnapTrade&apos;s page. Holdings refresh whenever you sync; trades are read once a day.
      </p>
      <p className="text-xs leading-relaxed text-muted">
        By connecting, you agree to SnapTrade&apos;s{" "}
        <a href={SNAPTRADE_TERMS} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-accent">
          End User Terms
        </a>{" "}
        and{" "}
        <a href={SNAPTRADE_PRIVACY} target="_blank" rel="noreferrer noopener" className="underline underline-offset-2 hover:text-accent">
          Privacy Policy
        </a>
        , and to WylthIQ&apos;s{" "}
        <Link href="/terms" className="underline underline-offset-2 hover:text-accent">
          terms and privacy policy
        </Link>
        .
      </p>

      {returned === "connected" && <p className="text-sm text-up">Connected. Your holdings and trades are below.</p>}
      {returned === "connected-holdings" && (
        <p className="text-sm text-up">
          Connected. Your holdings are below. Trades are read once a day, so this broker&apos;s trades reach your journal
          with the next daily sync.
        </p>
      )}
      {returned === "unavailable" && (
        <p className="text-sm text-fair-fg">That connection couldn&apos;t be completed right now. Please try again later.</p>
      )}
      {returned === "failed" && (
        <p className="text-sm text-fair-fg">Connected, but the first update did not complete. Use Sync now in a few minutes.</p>
      )}

      {!available ? (
        <p className="text-sm text-muted">Connecting through SnapTrade is not set up on this server yet.</p>
      ) : !connection ? (
        <StartSnapTrade again={false} />
      ) : (
        <div className="space-y-4">
          {(connection.details.refused?.length ?? 0) > 0 && (
            <p className="text-sm text-poor">
              {connection.details.refused!.join(", ")} was connected with permission to trade, so it was removed.
              Connect it again and choose read-only access.
            </p>
          )}
          {(connection.details.brokerages ?? []).length === 0 ? (
            <p className="text-sm text-muted">No broker is connected yet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {connection.details.brokerages!.map((brokerage) => (
                <li key={brokerage.id} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="font-medium">{brokerage.institution}</span>
                  <span className="rounded-full bg-good-soft px-2 py-0.5 text-[11px] font-medium text-good-fg">Read-only</span>
                  {brokerage.disabled && <ReconnectBrokerage id={brokerage.id} institution={brokerage.institution} />}
                  <span className="text-xs text-muted">
                    {(connection.details.accounts ?? [])
                      .filter((a) => a.institution === brokerage.institution)
                      .map((a) => a.description)
                      .join(", ")}
                  </span>
                  <RemoveBrokerage id={brokerage.id} institution={brokerage.institution} />
                </li>
              ))}
            </ul>
          )}
          <Status connection={connection} />
          <div className="flex flex-wrap items-start gap-4">
            <StartSnapTrade again />
            <SyncButton broker="snaptrade" />
          </div>
          <DisconnectForm broker="snaptrade" linkedTrades={connection.linkedTrades} label="Disconnect all" />
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ upload */

function UploadSection({ connection }: { connection: ConnectionView | undefined }) {
  const [state, setState] = useState<BrokerActionResult | null>(null);
  const [pending, setPending] = useState(false);

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setState(null);
    try {
      const res = await fetch("/api/brokers/ibkr/upload", { method: "POST", body: new FormData(event.currentTarget) });
      const result = (await res.json().catch(() => null)) as BrokerActionResult | null;
      setState(result ?? { ok: false, message: "The upload did not go through. Try again." });
      if (result?.ok) window.location.reload();
    } catch {
      setState({ ok: false, message: "The upload did not go through. Try again." });
    } finally {
      setPending(false);
    }
  }

  return (
    <Section title="Or upload an IBKR statement">
      <p className="text-sm leading-relaxed text-muted">
        No connection at all: download a statement from IBKR and upload it here. The file is read and not kept.
      </p>
      <ol className="list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-muted">
        <li>
          In IBKR&apos;s Client Portal, open <strong>Performance &amp; Reports → Flex Queries</strong> and create an{" "}
          <strong>Activity Flex Query</strong> with <strong>Open Positions</strong> (Summary level) and{" "}
          <strong>Trades</strong> (Execution level), every field selected, format <strong>XML</strong>, period{" "}
          <strong>Last 365 Calendar Days</strong>, date format left as <strong>yyyyMMdd</strong>.
        </li>
        <li>Run it, download the XML file, and upload it below. Upload a newer one whenever you want to refresh.</li>
      </ol>
      {connection && <Status connection={connection} />}
      <form onSubmit={upload} className="space-y-3">
        <input
          type="file"
          name="statement"
          accept=".xml,application/xml,text/xml"
          required
          className="block text-sm file:mr-3 file:rounded-lg file:border file:border-border file:bg-surface file:px-3 file:py-1.5 file:text-sm"
        />
        {!connection && <HistoryChoice />}
        <button type="submit" disabled={pending} className={button}>
          {pending ? "Reading the statement…" : "Upload statement"}
        </button>
        <Result state={state} />
      </form>
      {connection && <DisconnectForm broker="ibkr-upload" linkedTrades={connection.linkedTrades} label="Remove statement" />}
    </Section>
  );
}

/* ------------------------------------------------------- Flex token (owner) */

function FlexTokenForm({ replacing }: { replacing: boolean }) {
  const [state, action, pending] = useActionState(connectIbkr, null);
  return (
    <form action={action} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ibkr-token" className="text-xs text-muted">
            Flex Web Service token
          </label>
          <input id="ibkr-token" name="token" type="password" autoComplete="off" spellCheck={false} required className={input} />
        </div>
        <div>
          <label htmlFor="ibkr-query" className="text-xs text-muted">
            Flex query ID
          </label>
          <input id="ibkr-query" name="queryId" inputMode="numeric" autoComplete="off" required className={input} />
        </div>
      </div>
      <HistoryChoice />
      <button type="submit" disabled={pending} className={button}>
        {pending ? "Checking with IBKR…" : replacing ? "Replace token" : "Connect"}
      </button>
      <Result state={state} />
    </form>
  );
}

function FlexTokenSection({ connection }: { connection: ConnectionView | undefined }) {
  return (
    <Section title="Connect with a Flex token (your account only)">
      <p className="text-sm leading-relaxed text-muted">
        Shown only to the addresses listed in this server&apos;s settings. The token can only download reports; it is
        stored encrypted and never shown again.
      </p>
      {connection ? (
        <div className="space-y-4">
          <p className="text-sm text-muted">
            Query {connection.queryId} · token ending {connection.tokenHint}
            {(connection.details.accounts ?? []).length > 0 &&
              ` · ${connection.details.accounts!.map((a) => a.description).join(", ")}`}
          </p>
          <Status connection={connection} />
          <div className="flex flex-wrap items-start gap-4">
            <SyncButton broker="ibkr-flex" />
            <DisconnectForm broker="ibkr-flex" linkedTrades={connection.linkedTrades} label="Disconnect" />
          </div>
          <details open={connection.status === "needs-attention"}>
            <summary className="cursor-pointer text-sm text-muted">Replace the token or query</summary>
            <div className="mt-3">
              <FlexTokenForm replacing />
            </div>
          </details>
        </div>
      ) : (
        <FlexTokenForm replacing={false} />
      )}
    </Section>
  );
}

export function BrokerConnections({
  unavailable,
  connections,
  snaptradeAvailable,
  showFlexToken,
  returned,
}: {
  /** True when connections cannot be read at all right now; nothing else is offered. */
  unavailable: boolean;
  connections: ConnectionView[];
  /** False when SnapTrade's keys or the encryption key are not set on this server. */
  snaptradeAvailable: boolean;
  /** True only for addresses on the owner's list, or for anyone who already has a token connection. */
  showFlexToken: boolean;
  /** What the SnapTrade return route reported, from the address it sent the reader back to. */
  returned: string | null;
}) {
  if (unavailable) {
    return (
      <div className="p-5">
        <p className="text-sm leading-relaxed text-muted">
          Connecting a broker isn&apos;t available right now. Please check back later.
        </p>
      </div>
    );
  }

  const find = (kind: Kind) => connections.find((c) => c.broker === kind);
  return (
    <div>
      <SnapTradeSection connection={find("snaptrade")} available={snaptradeAvailable} returned={returned} />
      <UploadSection connection={find("ibkr-upload")} />
      {showFlexToken && <FlexTokenSection connection={find("ibkr-flex")} />}
    </div>
  );
}
