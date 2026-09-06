import { inArray, sql } from "drizzle-orm";
import { getDb } from "../db";
import { users } from "../db/schema";

/**
 * Usernames: what counts as one, and finding a free one.
 *
 * The `name` column started as a display name — optional, free text, shown in
 * the header and on the account page. Treating it as a username is what makes
 * "no two people can have the same one" a coherent rule rather than an
 * arbitrary restriction: two customers genuinely called John Smith both have a
 * claim on that display name, and neither has a claim on the same identifier.
 *
 * So the rules here are identifier rules — no spaces, a bounded character set,
 * compared without regard to case. It stays optional, because it was optional
 * and nobody should be locked out of an account they already have for want of
 * one.
 */

export const MIN_USERNAME = 3;
export const MAX_USERNAME = 30;

/**
 * Words nobody may register.
 *
 * Not a moderation list — a list of names that would let somebody be mistaken
 * for the service itself. A message from "Support" or "WylthIQ" carries an
 * authority a stranger's account should not be able to borrow.
 */
const RESERVED = new Set([
  "admin", "administrator", "root", "system", "support", "help", "helpdesk",
  "moderator", "mod", "staff", "team", "official", "security", "billing",
  "wylthiq", "wylth", "marketminer", "stockfilter", "sec", "edgar", "api", "www", "mail",
  "postmaster", "webmaster", "abuse", "noreply", "no-reply", "null", "undefined",
  "me", "you", "account", "accounts", "settings", "signin", "signup", "login",
]);

/**
 * The comparison form.
 *
 * Uniqueness is case-insensitive, so "Yashik07" and "yashik07" are the same
 * claim on the same identifier — the alternative is two accounts that look
 * identical everywhere the name is displayed. The database enforces this on
 * `lower(name)`, and this function is the same rule in TypeScript so the
 * check and the constraint cannot disagree.
 */
export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Why this username cannot be used, or null when it can.
 *
 * Each message names the rule it broke rather than restating the rules in
 * full — somebody who typed a space needs to know spaces are out, not to read
 * the whole specification again.
 */
export function describeUsernameProblem(raw: string): string | null {
  const value = raw.trim();

  if (value.length < MIN_USERNAME) {
    return `Usernames are at least ${MIN_USERNAME} characters.`;
  }
  if (value.length > MAX_USERNAME) {
    return `Usernames are at most ${MAX_USERNAME} characters.`;
  }
  if (/\s/.test(value)) {
    return "Usernames cannot contain spaces. Try a dot, dash or underscore instead.";
  }
  if (!/^[a-zA-Z0-9._-]+$/.test(value)) {
    return "Usernames can use letters, numbers, dots, dashes and underscores.";
  }
  // Leading or trailing punctuation reads as a typo and makes two names that
  // are visually identical in a sentence ("bob." and "bob") distinct.
  if (!/^[a-zA-Z0-9]/.test(value) || !/[a-zA-Z0-9]$/.test(value)) {
    return "Usernames start and end with a letter or number.";
  }
  if (/[._-]{2,}/.test(value)) {
    return "Usernames cannot have two punctuation marks in a row.";
  }
  if (RESERVED.has(normalizeUsername(value))) {
    return "That username is reserved. Please choose another.";
  }

  return null;
}

/**
 * Which of these usernames are already registered, compared case-insensitively.
 *
 * One query for the whole list rather than one per candidate: the suggestion
 * path below checks a dozen at a time, and a dozen round trips to render one
 * error message is a lot of database for very little.
 */
export async function takenUsernames(candidates: string[]): Promise<Set<string>> {
  const normalized = [...new Set(candidates.map(normalizeUsername))].filter(Boolean);
  if (normalized.length === 0) return new Set();

  const rows = await getDb()
    .select({ name: users.name })
    .from(users)
    .where(inArray(sql`lower(${users.name})`, normalized));

  return new Set(rows.map((r) => normalizeUsername(r.name ?? "")));
}

/** Whether one username is already registered. */
export async function isUsernameTaken(value: string): Promise<boolean> {
  return (await takenUsernames([value])).has(normalizeUsername(value));
}

/**
 * Free usernames close to the one somebody wanted.
 *
 * Every suggestion is checked against the database before being offered —
 * proposing a name that is also taken would be worse than proposing nothing,
 * because the reader would try it and be refused a second time.
 *
 * The candidates are ordered from least to most disfigured: a plain numeric
 * suffix first, then punctuation, then the year, then a random tail as the
 * fallback that always has something free in it. A truncation guard keeps
 * every candidate inside the length limit, so a 30-character name suggests
 * something valid rather than something the validator would then reject.
 */
export async function suggestUsernames(raw: string, howMany = 3): Promise<string[]> {
  const base = raw.trim().replace(/[._-]+$/, "");
  if (!base) return [];

  const year = new Date().getFullYear();
  const fit = (suffix: string) =>
    `${base.slice(0, Math.max(1, MAX_USERNAME - suffix.length))}${suffix}`;

  const candidates = [
    ...[1, 2, 3, 7, 9].map((n) => fit(String(n))),
    ...[1, 2].map((n) => fit(`_${n}`)),
    fit(String(year)),
    fit(`.${String(year).slice(2)}`),
    // A random tail, so a heavily contested base still yields something.
    ...Array.from({ length: 4 }, () => fit(String(Math.floor(Math.random() * 900) + 100))),
  ];

  // Anything the validator would reject is dropped before the database is
  // asked about it — a suggestion has to survive the same rules a typed name does.
  const valid = [...new Set(candidates)].filter((c) => describeUsernameProblem(c) === null);
  const taken = await takenUsernames([...valid, base]);

  return valid.filter((c) => !taken.has(normalizeUsername(c))).slice(0, howMany);
}
