import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Encrypts a reader's broker token before it is stored.
 *
 * A Flex token cannot trade or move money, but it can download every report
 * the reader has set up — positions, fills, cash movements, their account
 * number. A leaked database should not hand those out, so the token is kept
 * encrypted under a key that lives only in the environment.
 *
 * AES-256-GCM, which authenticates as well as encrypts: a ciphertext that has
 * been altered does not decrypt to something else, it fails. The additional
 * data binds each ciphertext to the reader and broker it was written for, so
 * copying one row's token into another reader's row does not decrypt either.
 *
 * Its own key rather than one derived from AUTH_SECRET. Rotating the session
 * secret signs everybody out, which is sometimes exactly what is wanted after
 * an incident; if it also destroyed every stored broker token, nobody would
 * ever rotate it.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const KEY_BYTES = 32;

/** The key, or null when the feature is not set up. Never throws on a missing key. */
function key(): Buffer | null {
  const raw = process.env.BROKER_TOKEN_KEY?.trim();
  if (!raw) return null;
  const bytes = Buffer.from(raw, "base64");
  // A key of the wrong length is a misconfiguration, not a smaller key: GCM
  // would reject it anyway, and saying so here names the setting at fault.
  return bytes.length === KEY_BYTES ? bytes : null;
}

/** Whether tokens can be stored at all. The connect card says so when they cannot. */
export function brokerTokensEnabled(): boolean {
  return key() !== null;
}

function requireKey(): Buffer {
  const k = key();
  if (!k) {
    throw new Error(
      "BROKER_TOKEN_KEY is not set, or is not 32 bytes. Generate one with " +
        "`openssl rand -base64 32` — broker tokens are encrypted with it.",
    );
  }
  return k;
}

/** What each ciphertext is bound to. Changing this orphans every stored token. */
function associatedData(userId: string, broker: string): Buffer {
  return Buffer.from(`broker-token:${VERSION}:${userId}:${broker}`, "utf8");
}

export function encryptToken(plaintext: string, userId: string, broker: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", requireKey(), iv);
  cipher.setAAD(associatedData(userId, broker));
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64url"), tag.toString("base64url"), body.toString("base64url")].join(
    ":",
  );
}

/**
 * The stored token, or null if it cannot be read.
 *
 * Null covers a missing key, a rotated key, a tampered row and a row copied
 * from another reader alike. The caller treats every one of them the same
 * way — the reader has to connect again — so telling them apart here would
 * only add ways to leak which one it was.
 */
export function decryptToken(stored: string, userId: string, broker: string): string | null {
  const k = key();
  if (!k) return null;

  const [version, iv, tag, body] = stored.split(":");
  if (version !== VERSION || !iv || !tag || !body) return null;

  try {
    const decipher = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"));
    decipher.setAAD(associatedData(userId, broker));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(body, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    return null;
  }
}

/** The last four characters, so a reader can tell which token is saved without seeing it. */
export function tokenHint(token: string): string {
  return token.trim().slice(-4);
}
