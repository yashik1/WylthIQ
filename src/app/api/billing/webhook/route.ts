import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "@/lib/db";
import { subscriptions, stripeEvents } from "@/lib/db/schema";
import { getStripe, tierForPriceId } from "@/lib/billing/stripe";

export const dynamic = "force-dynamic";

/**
 * Stripe's webhook — the only thing in this app that grants paid access.
 *
 * Which makes the signature check the single most important line here. Without
 * it this endpoint is a public URL that hands anybody a subscription by
 * POSTing a JSON body, so the raw request body is verified against
 * STRIPE_WEBHOOK_SECRET before a single field is read, and an unverified
 * request is rejected without touching the database.
 *
 * The body must be read as raw text, not parsed JSON: the signature covers
 * the exact bytes Stripe sent, and re-serialising a parsed object changes
 * them.
 */

/** Events that change whether someone is entitled. Everything else is ignored. */
const HANDLED = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

export async function POST(request: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !isDatabaseConfigured()) {
    return NextResponse.json({ error: "Billing is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  const raw = await request.text();

  let event: Stripe.Event;
  try {
    event = getStripe().webhooks.constructEvent(raw, signature, secret);
  } catch (err) {
    // Deliberately terse. A forged or replayed request gets no detail about
    // why it failed.
    console.warn(
      "[billing] rejected an unverified webhook:",
      err instanceof Error ? err.message.slice(0, 120) : "unknown",
    );
    return NextResponse.json({ error: "Signature verification failed." }, { status: 400 });
  }

  if (!HANDLED.has(event.type)) {
    // Acknowledged so Stripe stops retrying something we do not act on.
    return NextResponse.json({ received: true, ignored: event.type });
  }

  /*
    Claim the event before acting on it.

    Signature verification proved this came from Stripe; it did not prove this
    is the first delivery. Stripe retries until it gets a 2xx, so a timeout on
    our side after the work was done produces a second identical, correctly
    signed delivery — and a captured payload can be replayed on purpose. Either
    way the effect of processing twice is a subscription granted twice.

    The insert is the check: the event id is the primary key, so a conflict
    means somebody already handled it and there is nothing to do. Doing this
    first also means a crash mid-apply does not leave the event unclaimed and
    replayable, at the cost of a genuinely failed apply not being retried —
    the right way round, because a duplicate grant is silent and a missing one
    shows up in support.
  */
  try {
    const claimed = await getDb()
      .insert(stripeEvents)
      .values({ id: event.id, type: event.type })
      .onConflictDoNothing({ target: stripeEvents.id })
      .returning({ id: stripeEvents.id });

    if (claimed.length === 0) {
      return NextResponse.json({ received: true, duplicate: event.id });
    }
  } catch (err) {
    // Could not record it, so do not act on it — acting without a record is
    // exactly the state this table exists to prevent.
    console.error(
      "[billing] could not claim event",
      event.id,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
  }

  try {
    await applyEvent(event);
  } catch (err) {
    // A 500 makes Stripe retry, which is what we want for a transient database
    // failure — the alternative is silently losing somebody's subscription.
    console.error(
      "[billing] failed to apply",
      event.type,
      err instanceof Error ? err.message : err,
    );
    return NextResponse.json({ error: "Could not record the event." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

async function applyEvent(event: Stripe.Event): Promise<void> {
  const stripe = getStripe();
  const db = getDb();

  // Both shapes carry the customer; a checkout session does not carry the
  // subscription's status, so it is fetched rather than assumed.
  let subscription: Stripe.Subscription | null = null;

  if (event.type === "checkout.session.completed") {
    const session = event.data.object as Stripe.Checkout.Session;
    if (typeof session.subscription === "string") {
      subscription = await stripe.subscriptions.retrieve(session.subscription);
    }
  } else {
    subscription = event.data.object as Stripe.Subscription;
  }

  if (!subscription) return;

  const customerId =
    typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id;

  /*
    Matched on the Stripe customer id rather than the userId in metadata.

    The row was created with that customer id when checkout started, so it is
    the reliable join. Metadata is a fallback for the case where the row is
    missing entirely — a customer created outside this app, or a database
    restored from before the checkout.
  */
  const periodEnd = firstPeriodEnd(subscription);
  const priceId = subscription.items.data[0]?.price?.id ?? null;

  /*
    An unrecognised price leaves the stored tier untouched rather than
    resetting it. A price id this deployment cannot name is far more likely to
    be one that was rotated in Stripe than a customer who bought nothing, and
    silently demoting a paying subscriber over a changed environment variable
    is the worse of the two failures — they would simply find their plan gone.
    An upgrade or downgrade always arrives with a price we do know, so the
    case this skips is the one where there is nothing reliable to say.
  */
  const tier = tierForPriceId(priceId);

  const values = {
    stripeSubscriptionId: subscription.id,
    stripePriceId: priceId,
    ...(tier ? { tier } : {}),
    status: subscription.status,
    currentPeriodEnd: periodEnd,
    cancelAtPeriodEnd: subscription.cancel_at_period_end ?? false,
    updatedAt: new Date(),
  };

  const updated = await db
    .update(subscriptions)
    .set(values)
    .where(eq(subscriptions.stripeCustomerId, customerId))
    .returning({ userId: subscriptions.userId });

  if (updated.length > 0) return;

  const userId = subscription.metadata?.userId;
  if (!userId) {
    // Nothing to attach this to. Logged rather than thrown: retrying will not
    // conjure an account, so a 500 would just loop.
    console.warn(`[billing] no local row for customer ${customerId} and no userId in metadata`);
    return;
  }

  await db
    .insert(subscriptions)
    // A new row has no existing tier to leave alone, so an unrecognised price
    // falls back to the base paid tier rather than to nothing.
    .values({ userId, stripeCustomerId: customerId, tier: tier ?? "pro", ...values })
    .onConflictDoUpdate({ target: subscriptions.userId, set: values });
}

/**
 * When the current paid period ends.
 *
 * Stripe moved this from the subscription to its items, so it is read from the
 * first item with a fallback to the legacy top-level field — reading only one
 * of the two would silently store null on whichever API version does not carry
 * it, and a null period end means the entitlement check treats the
 * subscription as open-ended.
 */
function firstPeriodEnd(subscription: Stripe.Subscription): Date | null {
  const item = subscription.items?.data?.[0] as { current_period_end?: number } | undefined;
  const legacy = (subscription as unknown as { current_period_end?: number }).current_period_end;
  const seconds = item?.current_period_end ?? legacy;
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}
