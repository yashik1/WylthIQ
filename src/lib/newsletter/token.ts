import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Confirmation and unsubscribe links for the public newsletter.
 *
 * The same stateless scheme as src/lib/digest/token.ts, and separate from it
 * for one reason: that one vouches for a user id and this one vouches for an
 * email address, which is a different claim about a different table. Sharing
 * a signer between them would mean a token minted for one could be presented
 * to the other, and the two grant different things.
 *
 * An HMAC under AUTH_SECRET, so nothing is stored: no token column to leak,
 * and a stolen database yields no working links. No expiry, deliberately —
 * an unsubscribe link in a two-year-old email must still work, which is the
 * difference between an unsubscribe and a spam report.
 *
 * `purpose` is inside the signed material rather than beside it, so a
 * confirmation link cannot be replayed as an unsubscribe or the reverse.
 * Both name the same address, and without this the only thing distinguishing
 * them would be a query parameter the holder controls.
 */

export type TokenPurpose = "confirm" | "unsubscribe";

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set, so newsletter links cannot be signed.");
  return value;
}

function sign(purpose: TokenPurpose, email: string): string {
  return createHmac("sha256", secret())
    .update(`newsletter-${purpose}:${email}`)
    .digest("base64url");
}

/** The token to put in a link. Carries the address so the route knows who to act on. */
export function newsletterToken(purpose: TokenPurpose, email: string): string {
  return `${Buffer.from(email).toString("base64url")}.${sign(purpose, email)}`;
}

/**
 * The address a token vouches for under this purpose, or null.
 *
 * Compared with `timingSafeEqual` rather than `===`. A string comparison
 * returns as soon as it finds a differing byte, which leaks how much of a
 * guess was right and turns forging a signature into a solvable problem.
 */
export function verifyNewsletterToken(purpose: TokenPurpose, token: string): string | null {
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;

  let email: string;
  try {
    email = Buffer.from(encoded, "base64url").toString("utf8");
  } catch {
    return null;
  }
  if (!email) return null;

  let expected: string;
  try {
    expected = sign(purpose, email);
  } catch {
    return null;
  }

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  // Length first: timingSafeEqual throws on a mismatch, and a length
  // difference is not secret anyway.
  if (a.length !== b.length) return null;

  return timingSafeEqual(a, b) ? email : null;
}
