"use server";

import { eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { newsletterSubscribers } from "../db/schema";
import { isEmailConfigured, sendEmail } from "../email";
import { siteUrl } from "../site-url";
import { newsletterToken } from "./token";

/**
 * Joining and leaving the public newsletter.
 *
 * Two rules run through all of it, both inherited from the account actions
 * next door because the reasoning is the same.
 *
 * Nothing here reveals whether an address is already on the list. A form that
 * answers that question is a way to test whether somebody reads this site,
 * and the honest-looking version of it ("you are already subscribed") is
 * exactly the leak. Every submission of a well-formed address gets the same
 * reply.
 *
 * And nothing is ever sent to an address that has not confirmed it wants
 * mail. The row exists from the moment the form is submitted, but it does not
 * count as a subscriber until somebody clicks the link, so submitting a
 * stranger's address achieves one email and no subscription.
 */

export interface NewsletterResult {
  ok: boolean;
  message: string;
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL = 254;

/**
 * How long before an unconfirmed address may be sent another confirmation.
 *
 * The form is public and unauthenticated, so without a cooldown it forwards
 * one email per submission to whatever address is typed into it — which is a
 * spam cannon pointed at a stranger, wearing this site's sending domain.
 */
const RESEND_COOLDOWN_MS = 60 * 60 * 1000;

function normalizeEmail(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().toLowerCase().slice(0, MAX_EMAIL) : "";
}

/**
 * Whether an error is Postgres' unique-violation.
 *
 * Drizzle wraps driver errors, so the code sits on `.cause` rather than on the
 * error handed back — the same chain-walking `src/lib/auth/actions.ts` does
 * for the identical race on `users`.
 */
function isUniqueViolation(err: unknown): boolean {
  let current: unknown = err;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    if ((current as { code?: string }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

export async function subscribeToNewsletter(
  _prev: NewsletterResult | null,
  form: FormData,
): Promise<NewsletterResult> {
  const email = normalizeEmail(form.get("email"));

  if (!EMAIL_SHAPE.test(email)) {
    return { ok: false, message: "That does not look like an email address." };
  }

  /*
    One reply for every outcome below — new address, address already pending,
    address already subscribed, no database. Chosen on whether this deployment
    can send at all, for the same reason the password reset is: that is a fact
    about the deployment rather than about the address, so it stays out of the
    enumeration problem while not promising an email that cannot be sent.
  */
  const answer: NewsletterResult = isEmailConfigured()
    ? {
        ok: true,
        message: "Check your inbox — click the link in the email to confirm your subscription.",
      }
    : {
        ok: false,
        message:
          "This site cannot send email yet, so the confirmation could not be delivered. " +
          "Nothing has been subscribed.",
      };

  if (!isDatabaseConfigured()) return answer;

  const db = getDb();

  /*
    Read, then branch, then write — and treat a unique violation on the insert
    as "somebody else's identical submission got there first", which is the
    same race `signUp` handles the same way. The checks below cannot be atomic
    with the write, and only the index can settle a tie; losing that tie means
    a confirmation is already on its way, so there is nothing left to do.
  */
  const cooldownPassed = (sentAt: Date) => Date.now() - sentAt.getTime() > RESEND_COOLDOWN_MS;
  let shouldSend = false;

  try {
    const [existing] = await db
      .select({
        confirmedAt: newsletterSubscribers.confirmedAt,
        unsubscribedAt: newsletterSubscribers.unsubscribedAt,
        confirmSentAt: newsletterSubscribers.confirmSentAt,
      })
      .from(newsletterSubscribers)
      .where(eq(newsletterSubscribers.email, email))
      .limit(1);

    if (!existing) {
      await db.insert(newsletterSubscribers).values({ email });
      shouldSend = true;
    } else if (existing.confirmedAt && !existing.unsubscribedAt) {
      // Already a subscriber. Nothing to send and nothing to change — and the
      // reply above is identical either way, so the form does not say so.
      shouldSend = false;
    } else if (cooldownPassed(existing.confirmSentAt)) {
      /*
        Pending, or previously unsubscribed and now asking again. Both need a
        fresh confirmation: coming back after leaving is a new decision, and
        honouring it silently on the strength of a confirmation from before
        the unsubscribe would put somebody back on a list they had left.
      */
      await db
        .update(newsletterSubscribers)
        .set({ confirmedAt: null, unsubscribedAt: null, confirmSentAt: new Date() })
        .where(eq(newsletterSubscribers.email, email));
      shouldSend = true;
    }
  } catch (err) {
    // A duplicate key here is the race described above, not a failure.
    if (!isUniqueViolation(err)) {
      return { ok: false, message: "Could not sign you up just now. Try again in a moment." };
    }
    shouldSend = false;
  }

  if (shouldSend) {
    const link = `${siteUrl()}/api/newsletter/confirm?token=${newsletterToken("confirm", email)}`;
    await sendEmail({
      to: email,
      subject: "Confirm your MarketMiner newsletter subscription",
      text:
        "Click to confirm you want the weekly newsletter — what the companies " +
        `in our scored universe actually filed that week.\n\n${link}\n\n` +
        "If you did not ask for this, ignore it. Nothing is subscribed until " +
        "that link is clicked.",
    });
  }

  return answer;
}

/** Turns a pending row into a subscriber. Idempotent — a second click is a no-op. */
export async function confirmSubscription(email: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;

  try {
    await getDb()
      .update(newsletterSubscribers)
      .set({ confirmedAt: new Date(), unsubscribedAt: null })
      .where(eq(newsletterSubscribers.email, email));
    return true;
  } catch {
    return false;
  }
}

/**
 * Stops the newsletter for one address.
 *
 * Stamped rather than deleted, so resubmitting the address on the public form
 * cannot quietly put somebody back on a list they left.
 */
export async function unsubscribeFromNewsletter(email: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;

  try {
    await getDb()
      .update(newsletterSubscribers)
      .set({ unsubscribedAt: new Date() })
      .where(eq(newsletterSubscribers.email, email));
    return true;
  } catch {
    return false;
  }
}
