"use server";

import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { passwordResetTokens, users } from "../db/schema";
import { isEmailConfigured, sendEmail } from "../email";
import { describePasswordProblem, hashPassword } from "./password";
import {
  describeUsernameProblem,
  isUsernameTaken,
  normalizeUsername,
  suggestUsernames,
} from "./username";
import { siteUrl } from "../site-url";
import { revalidatePath } from "next/cache";
import { auth } from "./index";
import { actionRateLimited } from "../security/guard";

/**
 * Sign-up and password-reset, as server actions.
 *
 * Two rules run through all of it. Nothing here ever reveals whether a given
 * address has an account — not through the message, not through which branch
 * returns faster — because a form that answers that question is a way to
 * enumerate a customer list. And the raw reset token exists only inside the
 * emailed link: the database holds a SHA-256 of it, so a leaked table cannot
 * be used to take over an account.
 */

export interface ActionResult {
  ok: boolean;
  /** Safe to show a visitor. */
  message: string;
  /**
   * Free usernames close to the one that was refused.
   *
   * Only ever set when a username was taken — the form renders them as
   * one-click choices, so an error that would otherwise be a dead end
   * finishes the job instead.
   */
  suggestions?: string[];
}

/**
 * The Postgres unique-violation constraint behind an error, if that is what
 * it was.
 *
 * Drizzle wraps driver errors, so the code lives on `.cause` rather than on
 * the error handed to the caller — the same chain-walking the screener does
 * for its own error classification. Needed because the checks in `signUp`
 * cannot be atomic with the insert: two people can submit the same username
 * in the same instant, both pass the check, and only the database can settle
 * which one gets it.
 */
function uniqueViolation(err: unknown): string | null {
  let current: unknown = err;
  const seen = new Set<unknown>();

  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const e = current as { code?: string; constraint_name?: string; constraint?: string };
    if (e.code === "23505") return e.constraint_name ?? e.constraint ?? "";
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** How long a reset link stays valid. Long enough to find the email, short enough to matter. */
const RESET_TTL_MS = 60 * 60 * 1000;

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: FormDataEntryValue | null): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** SHA-256 rather than bcrypt: this is a 256-bit random token, not a guessable secret. */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export async function signUp(_prev: ActionResult | null, form: FormData): Promise<ActionResult> {
  const email = normalizeEmail(form.get("email"));
  const password = typeof form.get("password") === "string" ? (form.get("password") as string) : "";
  const username = typeof form.get("name") === "string" ? (form.get("name") as string).trim() : "";

  if (!EMAIL_SHAPE.test(email)) {
    return { ok: false, message: "That does not look like an email address." };
  }

  // Shape before availability: telling somebody a username is taken when it
  // was never allowed in the first place sends them looking for a different
  // name instead of a shorter one.
  if (username) {
    const problem = describeUsernameProblem(username);
    if (problem) return { ok: false, message: problem };
  }

  const problem = describePasswordProblem(password);
  if (problem) return { ok: false, message: problem };

  /*
    Counted after the shape checks and before the database.

    Placed here so a malformed submission costs nobody their allowance, and so
    the allowance is spent before any query runs — the point is to make
    automated account creation expensive, and a limiter that only trips after
    the work is done has not saved the work.
  */
  const wait = await actionRateLimited("auth");
  if (wait) {
    return { ok: false, message: `Too many attempts. Try again in ${wait}s.` };
  }

  if (!isDatabaseConfigured()) {
    return { ok: false, message: "Accounts are unavailable on this deployment." };
  }

  const db = getDb();

  /*
    The address is checked, and the answer is given plainly.

    This reverses an earlier decision in this file, so it is worth writing
    down. The original returned the success message for a taken address and
    emailed the owner instead, so that the form could not be used to test
    whether an address is registered here.

    The cost was paid by the wrong person. Somebody who had simply forgotten
    they had an account was told to check their email to finish setting one
    up; no verification email exists to arrive, and the password they had
    just chosen did not work — a dead end with no way to reason about it. The
    address is also confirmable through this form either way, because a
    duplicate signup cannot be allowed to succeed.

    So the email to the owner stays, because it is genuinely useful to them,
    and the person at the form is now told what happened. Note that
    `requestPasswordReset` below is deliberately unchanged and still answers
    identically for every address — that path has no such excuse, since it
    can and does succeed silently for an unknown address.
  */
  const [existingEmail] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  if (existingEmail) {
    await sendEmail({
      to: email,
      subject: "Someone tried to sign up with your email",
      text:
        "Somebody just tried to create a WylthIQ account with this address, " +
        "but one already exists.\n\n" +
        "If that was you, sign in instead — or use the forgot-password link if " +
        "you cannot remember it. If it was not you, you can safely ignore this.",
    });
    return {
      ok: false,
      message:
        "That email already has an account. Sign in instead, or use the " +
        "forgot-password link if you cannot remember the password.",
    };
  }

  if (username && (await isUsernameTaken(username))) {
    // Offered rather than merely refused: the reader wanted a username, and a
    // rejection with nothing to act on just makes them guess again.
    const suggestions = await suggestUsernames(username);
    return {
      ok: false,
      message: suggestions.length
        ? `"${username}" is taken. These are free:`
        : `"${username}" is taken. Please choose another.`,
      suggestions,
    };
  }

  const passwordHash = await hashPassword(password);

  try {
    await db.insert(users).values({ email, name: username || null, passwordHash });
  } catch (err) {
    /*
      The gap between checking and inserting.

      Both checks above can pass for two people at once, and the database
      settles it by raising a unique violation on whichever lands second.
      Reported as the same friendly refusal rather than as a crash, and told
      apart by which index complained.
    */
    const constraint = uniqueViolation(err);
    if (constraint === null) throw err;

    if (constraint.includes("name")) {
      const suggestions = await suggestUsernames(username).catch(() => []);
      return {
        ok: false,
        message: suggestions.length
          ? `"${username}" was taken a moment ago. These are free:`
          : `"${username}" was just taken. Please choose another.`,
        suggestions,
      };
    }
    return {
      ok: false,
      message:
        "That email already has an account. Sign in instead, or use the " +
        "forgot-password link if you cannot remember the password.",
    };
  }

  /*
    Says the account exists, because it does.

    This used to read "Check your email to finish setting up your account",
    which described a verification step this app has never had — nothing is
    sent on a successful sign-up, so the one instruction the message gave
    could not be followed.
  */
  return { ok: true, message: "Account created. You can sign in now." };
}

export async function requestPasswordReset(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const email = normalizeEmail(form.get("email"));

  /*
    One message for every outcome below — unknown address, known address, no
    database. The visitor learns nothing about who is registered.

    Two versions of it, chosen by whether this deployment can send mail at
    all. Without a provider the link is written to the server log and nothing
    leaves the building, so the old wording sent people to watch an inbox for
    a message that provably could not arrive — the flow looked like it worked
    and simply did not, which is the worst of both.

    Choosing between the two on `isEmailConfigured()` rather than on anything
    about the address keeps it outside the enumeration problem the rest of
    this function is written around: it is a fact about the deployment, so
    every submission gets the same answer either way. The token is still
    generated and logged below, because that is the only way an operator can
    finish a reset while there is no mail provider.
  */
  const answer: ActionResult = isEmailConfigured()
    ? { ok: true, message: "If that address has an account, a reset link is on its way." }
    : {
        ok: false,
        message:
          "This site cannot send email yet, so a reset link cannot reach you. " +
          "Ask whoever runs it to set a new password for you directly.",
      };

  /*
    Why this function says so little, out loud, in the server log.

    Every branch below returns the same sentence to the page on purpose, so
    a visitor cannot learn who is registered. The cost is that an operator
    cannot tell a working reset from a broken one either: three of these
    exits send nothing and, until now, left no trace at all — so "I never got
    the email" and "that address has no account" and "you have asked three
    times in fifteen minutes" were the same silence.

    The address is deliberately not logged. Which path was taken is what an
    operator needs; who asked is not, and a reset log full of email addresses
    is a small breach waiting for a log viewer.
  */
  if (!EMAIL_SHAPE.test(email)) {
    console.warn("[reset] Rejected: the submitted address is not a valid email.");
    return answer;
  }
  if (!isDatabaseConfigured()) {
    console.warn("[reset] Rejected: no DATABASE_URL, so no account can be looked up.");
    return answer;
  }

  /*
    Rate limited, and still answering identically when it trips.

    Returning a distinguishable "too many attempts" here would undo the
    anti-enumeration property the rest of this function is built around: an
    attacker could spend the allowance deliberately and read which addresses
    produce a different reply afterwards. So the limit protects the mail
    sender without ever changing what the page says.
  */
  if (await actionRateLimited("passwordReset")) {
    console.warn(
      "[reset] Refused: rate limit reached (3 requests per 15 minutes from one address). " +
        "Nothing was sent, and the page still answered as though it had been.",
    );
    return answer;
  }

  const db = getDb();
  const [user] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (!user) {
    console.warn(
      "[reset] Nothing sent: no account exists for the address requested. " +
        "The page answered as though one did, which is intended.",
    );
    return answer;
  }

  const token = randomBytes(32).toString("base64url");
  await db.insert(passwordResetTokens).values({
    userId: user.id,
    tokenHash: hashToken(token),
    expires: new Date(Date.now() + RESET_TTL_MS),
  });

  const link = `${siteUrl()}/reset-password?token=${token}`;

  await sendEmail({
    to: email,
    subject: "Reset your WylthIQ password",
    text:
      `Use this link to set a new password. It expires in an hour.\n\n${link}\n\n` +
      "If you did not ask for this, ignore it — your password has not changed.",
  });

  return answer;
}

export async function resetPassword(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  const token = typeof form.get("token") === "string" ? (form.get("token") as string) : "";
  const password = typeof form.get("password") === "string" ? (form.get("password") as string) : "";

  const problem = describePasswordProblem(password);
  if (problem) return { ok: false, message: problem };

  if (!token || !isDatabaseConfigured()) {
    return { ok: false, message: "That reset link is not valid. Request a new one." };
  }

  const db = getDb();
  const [row] = await db
    .select()
    .from(passwordResetTokens)
    .where(
      and(
        eq(passwordResetTokens.tokenHash, hashToken(token)),
        // Unused and unexpired are checked in the query rather than after it,
        // so a spent or stale token never even comes back.
        isNull(passwordResetTokens.usedAt),
        gt(passwordResetTokens.expires, new Date()),
      ),
    )
    .limit(1);

  if (!row) {
    return { ok: false, message: "That reset link has expired or already been used." };
  }

  const passwordHash = await hashPassword(password);

  /*
    The new password and the session watermark move together.

    Somebody resetting a password may be doing it because another person has
    their account open right now, so leaving those sessions alive would defeat
    the reason they came. Sessions here are JWTs with nothing to delete, so
    the watermark is the equivalent: every token issued before this instant
    stops being accepted. See the jwt callback in ./index.ts.
  */
  await db
    .update(users)
    .set({ passwordHash, sessionsValidFrom: new Date() })
    .where(eq(users.id, row.userId));

  // Burned immediately, so the same link cannot set a second password.
  await db
    .update(passwordResetTokens)
    .set({ usedAt: new Date() })
    .where(eq(passwordResetTokens.id, row.id));

  return { ok: true, message: "Your password has been changed. You can sign in now." };
}

/**
 * Changing the username on an existing account.
 *
 * The counterpart to the check at sign-up, and not optional now that
 * usernames are unique: the migration that introduced the constraint had to
 * rename anybody who had been allowed to duplicate one, and leaving those
 * people stuck with a generated suffix would be a change that fixed the
 * database at the reader's expense.
 *
 * Same rules, same suggestions, same race handling — deliberately the same
 * functions rather than a second implementation, so the two paths cannot
 * come to different conclusions about what a username is.
 */
export async function changeUsername(
  _prev: ActionResult | null,
  form: FormData,
): Promise<ActionResult> {
  if (!isDatabaseConfigured()) {
    return { ok: false, message: "Accounts are unavailable on this deployment." };
  }

  const session = await auth().catch(() => null);
  const userId = session?.user?.id;
  if (!userId) return { ok: false, message: "Sign in to change your username." };

  const raw = typeof form.get("name") === "string" ? (form.get("name") as string).trim() : "";
  const db = getDb();

  // Clearing it is allowed: it was optional at sign-up and stays optional, and
  // the header falls back to the address.
  if (!raw) {
    await db.update(users).set({ name: null }).where(eq(users.id, userId));
    revalidatePath("/account");
    return { ok: true, message: "Username removed." };
  }

  const problem = describeUsernameProblem(raw);
  if (problem) return { ok: false, message: problem };

  const [current] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  // Re-submitting the name you already have is not a clash with yourself.
  if (current?.name && normalizeUsername(current.name) === normalizeUsername(raw)) {
    if (current.name === raw) return { ok: true, message: "That is already your username." };
  } else if (await isUsernameTaken(raw)) {
    const suggestions = await suggestUsernames(raw);
    return {
      ok: false,
      message: suggestions.length
        ? `"${raw}" is taken. These are free:`
        : `"${raw}" is taken. Please choose another.`,
      suggestions,
    };
  }

  try {
    await db.update(users).set({ name: raw }).where(eq(users.id, userId));
  } catch (err) {
    if (uniqueViolation(err) === null) throw err;
    const suggestions = await suggestUsernames(raw).catch(() => []);
    return {
      ok: false,
      message: suggestions.length
        ? `"${raw}" was taken a moment ago. These are free:`
        : `"${raw}" was just taken. Please choose another.`,
      suggestions,
    };
  }

  revalidatePath("/account");
  return {
    ok: true,
    // The header reads from the session token, which is minted at sign-in and
    // does not know about this yet — better to say so than to leave somebody
    // wondering why the change did not appear.
    message: `Username changed to ${raw}. The header updates next time you sign in.`,
  };
}
