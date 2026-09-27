import { eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { subscriptions } from "../db/schema";
import { auth } from "../auth";
import { ACCESS_MODE, accountIsEnough, hasAccess } from "./access-mode";
import { canAccess as canAccessFeature, type Feature, type Tier } from "./tiers";

export { ACCESS_MODE, accountIsEnough, hasAccess };
export type { Feature, Tier };

/**
 * Who is allowed to use the paid features.
 *
 * One module, one answer. Every gate in the app asks this rather than reading
 * subscription rows itself, so "what counts as paid" is defined once and
 * cannot drift between the page that shows a feature and the route that
 * serves it — which is the usual way a paywall ends up leaking.
 */

/**
 * Stripe statuses that entitle someone to paid features.
 *
 * `trialing` counts: a trial is access the customer was deliberately given.
 * `past_due` also counts, for a grace period — a card that failed to renew is
 * usually a expired card rather than a decision to leave, and locking someone
 * out mid-billing-cycle over it is a worse error than a few days of unpaid
 * access. `canceled`, `unpaid` and `incomplete` do not.
 */
const ENTITLING_STATUSES = new Set(["active", "trialing", "past_due"]);

/**
 * How long past `currentPeriodEnd` a subscription still counts.
 *
 * Stripe's webhook for a renewal can arrive late, and the row is only ever as
 * fresh as the last webhook that landed. Without some slack, a subscriber who
 * renewed successfully could be told they are not subscribed because a
 * webhook was delayed by a minute. Three days is long enough to cover a
 * missed webhook and short enough that a genuinely lapsed subscription does
 * not linger.
 */
const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

export interface Entitlement {
  signedIn: boolean;
  subscribed: boolean;
  /**
   * Which plan they are on. "free" for everyone not currently paying —
   * including a lapsed subscriber, whose row still names the plan they used
   * to have. `subscribed` is the flag that decides whether this tier grants
   * anything; this field only says which one it would grant.
   */
  tier: Tier;
  userId: string | null;
  /** Stripe's own status, for showing the reader something specific. */
  status: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

const NOT_SIGNED_IN: Entitlement = {
  signedIn: false,
  subscribed: false,
  tier: "free",
  userId: null,
  status: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

/**
 * Reads the current visitor's entitlement, fresh, on every call.
 *
 * Deliberately not cached on the session token. A token minted while someone
 * was subscribed would go on asserting it until the token expired, which
 * means a cancellation would not take effect for days — and, worse, the same
 * staleness would hand access back to someone whose payment had failed.
 */
export async function getEntitlement(): Promise<Entitlement> {
  /*
    A throw here is caught rather than propagated, and the catch fails closed.

    `auth()` throws when AUTH_SECRET is missing or malformed, which is a
    configuration mistake an operator makes once while setting a deployment up.
    Letting it propagate replaces the paywall with an error boundary on every
    gated page — the reader sees a broken app instead of an invitation to
    subscribe, and the operator sees a stack trace rather than the actual
    problem. Reading it as "not signed in" keeps the page working and keeps the
    gate shut, which is the direction a paywall should fail in.
  */
  const session = await auth().catch((err) => {
    console.error(
      "[billing] could not read the session, treating the visitor as signed out:",
      err instanceof Error ? err.message : err,
    );
    return null;
  });
  const userId = session?.user?.id;

  if (!userId) return NOT_SIGNED_IN;
  return entitlementForUser(userId);
}

/**
 * The same answer for an account that is not the one making the request.
 *
 * For scheduled work acting on a reader's behalf — the nightly broker sync —
 * which has no session to read but must still stop once that reader's plan
 * no longer covers what it does.
 */
export async function entitlementForUser(userId: string): Promise<Entitlement> {
  if (!isDatabaseConfigured()) {
    return { ...NOT_SIGNED_IN, signedIn: true, userId };
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  if (!row) {
    return { ...NOT_SIGNED_IN, signedIn: true, userId };
  }

  const statusEntitles = ENTITLING_STATUSES.has(row.status);
  // A row still saying "active" long after its period ended means a webhook
  // was missed, not that the subscription runs forever.
  const withinPeriod =
    row.currentPeriodEnd == null ||
    row.currentPeriodEnd.getTime() + GRACE_PERIOD_MS > Date.now();

  return {
    signedIn: true,
    subscribed: statusEntitles && withinPeriod,
    // Narrowed here rather than trusted: the column is free text as far as
    // Postgres is concerned, and a value this build does not recognise should
    // read as the base paid plan rather than crash a page or silently grant
    // the highest one.
    tier: row.tier === "pro-plus" ? "pro-plus" : "pro",
    userId,
    status: row.status,
    currentPeriodEnd: row.currentPeriodEnd,
    cancelAtPeriodEnd: row.cancelAtPeriodEnd,
  };
}

/**
 * Whether this visitor may use a particular feature.
 *
 * The server-side counterpart to the table in `tiers.ts`, with the
 * deployment's access mode already applied — every page, route and action
 * should ask this rather than comparing tiers itself. `hasAccess` remains for
 * the original binary gates and now means "at least a Pro-level feature",
 * which is what those gates already guarded.
 */
export function canAccess(entitlement: Entitlement, feature: Feature): boolean {
  return canAccessFeature(entitlement, feature, accountIsEnough);
}
