import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardHeader, Metric, PageHeader } from "@/components/ui";
import { BillingButton } from "@/components/billing/subscribe-button";
import { LocalTime } from "@/components/local-time";
import { getEntitlement } from "@/lib/billing/entitlement";
import { accountIsEnough } from "@/lib/billing/access-mode";
import { isStripeConfigured } from "@/lib/billing/stripe";
import { auth } from "@/lib/auth";
import { SignOutButton } from "@/components/auth/account-menu";
import { UsernameForm } from "@/components/auth/username-form";
import { DigestToggle } from "@/components/digest-toggle";
import { getDigestPreference } from "@/lib/digest/actions";
import { listWatchlist } from "@/lib/watchlist/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account", robots: { index: false } };

/** Stripe's vocabulary, in words a reader can act on. */
const STATUS_TEXT: Record<string, string> = {
  active: "Active",
  trialing: "On trial",
  past_due: "Payment failed — update your card to avoid losing access",
  canceled: "Cancelled",
  unpaid: "Unpaid",
  incomplete: "Not finished",
  incomplete_expired: "Expired before completing",
  paused: "Paused",
};

export default async function AccountPage({ searchParams }: PageProps<"/account">) {
  // Caught for the same reason the layout catches it: auth() throws when
  // AUTH_SECRET is unset, and a configuration mistake should send somebody to
  // the sign-in page rather than a stack trace. Failing to "signed out" is
  // also the safe direction — this page shows billing state.
  const session = await auth().catch(() => null);
  if (!session?.user) redirect("/signin?next=/account");

  const params = await searchParams;
  const [entitlement, digest, saved] = await Promise.all([
    getEntitlement(),
    getDigestPreference(),
    listWatchlist(),
  ]);
  const justPaid = params.checkout === "done";

  return (
    <div className="mx-auto w-full max-w-2xl space-y-5 py-2">
      {/*
        Led by the name when there is one, with the address underneath rather
        than dropped: this is the page somebody opens to check which account
        they are in, so the address has to be readable somewhere, and the
        header no longer prints it.
      */}
      <PageHeader
        eyebrow="Account"
        title={session.user.name?.trim() || session.user.email}
      >
        {session.user.name?.trim() && (
          <p className="break-words">{session.user.email}</p>
        )}
      </PageHeader>

      {justPaid && !entitlement.subscribed && (
        <p className="rounded-lg border border-border bg-surface-2 px-4 py-2.5 text-xs text-muted-strong">
          Payment went through. Stripe confirms subscriptions by webhook, which can take a
          few seconds — refresh in a moment if this page still says otherwise.
        </p>
      )}

      <Card>
        <CardHeader
          title="Subscription"
          subtitle="Backtesting and the trade journal. Everything else on the site is free."
        />
        <dl className="grid grid-cols-2 gap-4 p-5">
          <Metric
            label="Status"
            value={
              entitlement.subscribed
                ? (STATUS_TEXT[entitlement.status ?? ""] ?? "Active")
                : entitlement.status
                  ? (STATUS_TEXT[entitlement.status] ?? entitlement.status)
                  : "No subscription"
            }
            tone={entitlement.subscribed ? "up" : "muted"}
          />
          <div className="min-w-0">
            <dt className="text-xs text-muted">
              {entitlement.cancelAtPeriodEnd ? "Access ends" : "Renews"}
            </dt>
            {/* Rendered here rather than through Metric, which takes a string:
                the date has to go through LocalTime so it reads in the
                subscriber's own timezone rather than the server's. */}
            <dd className="tnum mt-1 text-[0.9375rem] font-semibold">
              {entitlement.currentPeriodEnd ? (
                <LocalTime value={entitlement.currentPeriodEnd.getTime()} mode="date" />
              ) : (
                "—"
              )}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-3 border-t border-border p-5">
          {!isStripeConfigured() ? (
            <p className="text-xs text-muted">
              Payments are not configured on this deployment yet.
            </p>
          ) : entitlement.subscribed || entitlement.status ? (
            <BillingButton endpoint="portal" label="Manage billing" variant="secondary" />
          ) : (
            <BillingButton endpoint="checkout" label="Subscribe" />
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Saved companies and email"
          subtitle="What follows you between devices, and what lands in your inbox"
        />
        <div className="space-y-4 p-5">
          <p className="text-sm leading-relaxed text-muted">
            {saved.length === 0 ? (
              <>
                You have not saved any companies yet. The save button on any company page
                keeps it on your account, so the list is there on every device you sign in
                from.
              </>
            ) : (
              <>
                You have {saved.length === 1 ? "1 company" : `${saved.length} companies`}{" "}
                saved to your account:{" "}
                <span className="font-medium text-foreground">
                  {saved.slice(0, 12).map((s) => s.symbol).join(", ")}
                  {saved.length > 12 && ` and ${saved.length - 12} more`}
                </span>
                .
              </>
            )}
          </p>

          <div className="border-t border-border pt-4">
            <DigestToggle
              initialEnabled={digest.enabled}
              emailConfigured={digest.emailConfigured}
            />
          </div>
        </div>
      </Card>

      {/*
        Signing out sits here rather than in the header.

        It was a permanent button in the narrowest part of the bar, spending
        about seventy pixels on the one action nobody takes regularly — and
        taking them from the search box beside it. This is the page somebody
        opens to deal with their account, so it is where the way out of one
        belongs.
      */}
      <Card>
        <CardHeader
          title="Username"
          subtitle="What the header shows, and how you are identified. Yours alone."
        />
        <UsernameForm current={session.user.name ?? ""} />
      </Card>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">Signed in</h2>
            <p className="mt-0.5 text-xs break-words text-muted">
              As {session.user.name?.trim() || session.user.email} on this device.
            </p>
          </div>
          <SignOutButton />
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-sm font-semibold">
          {accountIsEnough ? "What your account unlocks" : "What a subscription covers"}
        </h2>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          <li>
            <Link href="/backtest/screener" className="text-accent underline">
              The screener backtest
            </Link>{" "}
            — would buying the healthiest companies actually have worked?
          </li>
          <li>
            <Link href="/journal" className="text-accent underline">The trade journal</Link>{" "}
            — your own notes on what you did and why.
          </li>
          <li>
            <Link href="/backtest" className="text-accent underline">Trading strategies</Link>{" "}
            — mean reversion, RSI dip buying, the golden cross, a 200-day trend rule and an
            intraday opening-range breakout, each against buying and holding.
          </li>
          <li>
            <Link href="/backtest" className="text-accent underline">Moving averages</Link>{" "}
            — SMA and EMA overlays, at any period, on a backtest result.
          </li>
        </ul>
        <p className="mt-3 text-xs leading-relaxed text-muted">
          {accountIsEnough
            ? "These are open to anyone with an account at the moment — no subscription needed. Company pages, the screener, comparisons, charts, crypto and commodities, and working out what an investment would have been worth need no account at all."
            : "Company pages, the screener, comparisons, charts, crypto and commodities, and working out what an investment would have been worth all stay free."}
        </p>
      </Card>
    </div>
  );
}
