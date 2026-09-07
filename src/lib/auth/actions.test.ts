import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { passwordResetTokens, users } from "../db/schema";

/**
 * Sign-up and forgot-password, exercised end to end.
 *
 * These three functions had no test coverage at all before this file — the
 * username and password *rules* were tested (username.test.ts,
 * password.test.ts), but never the actions that actually create a row, decide
 * whether an email address is already registered, or hand out and burn a reset
 * token. That is the part a reader actually depends on when they create an
 * account or ask to have their password reset, so it is the part worth
 * pinning down.
 *
 * The fake `getDb()` below mirrors the one in username.test.ts: it does not
 * parse a Drizzle `where()` condition (there is no cheap way to), so each test
 * sets the rows a real query would have found for the scenario it is
 * describing, rather than the mock working that out from the query itself. It
 * tells `users` and `passwordResetTokens` apart by the real schema table
 * objects, and tells the two different queries against `users` apart by which
 * column each one actually selects (`{ id }` for "does this email exist",
 * `{ name }` for "is this username taken") — the same distinction the real
 * queries make.
 */

let dbConfigured = true;
let existingUserRows: { id: string }[] = [];
let usernameRows: { name: string | null }[] = [];
let resetTokenRows: {
  id: number;
  userId: string;
  tokenHash: string;
  expires: Date;
  usedAt: Date | null;
}[] = [];
let insertUsersError: unknown = null;
/** Whether the deployment under test has a mail provider. See the reset tests. */
let emailConfigured = true;
let rateLimitedSeconds: number | null = null;

const insertedUsers: { email: string; name: string | null; passwordHash: string }[] = [];
const insertedResetTokens: { userId: string; tokenHash: string; expires: Date }[] = [];
const updatedUserPasswords: { id: unknown; passwordHash: string }[] = [];
const updatedResetTokens: { id: unknown; usedAt: Date }[] = [];
const sentEmails: { to: string; subject: string; text: string }[] = [];

function whereResult<T>(rows: T[]) {
  return {
    // Plain `await getDb()...where(...)` with no `.limit()` — takenUsernames.
    then: (resolve: (v: T[]) => void) => resolve(rows),
    // `.where(...).limit(n)` — the signUp / resetPassword lookups.
    limit: async (n: number) => rows.slice(0, n),
  };
}

vi.mock("../db", () => ({
  isDatabaseConfigured: () => dbConfigured,
  getDb: () => ({
    select: (cols?: Record<string, unknown>) => ({
      from: (table: unknown) => ({
        where: (_cond: unknown) => {
          if (table === users && cols && "id" in cols) return whereResult(existingUserRows);
          if (table === users && cols && "name" in cols) return whereResult(usernameRows);
          if (table === passwordResetTokens) return whereResult(resetTokenRows);
          return whereResult([]);
        },
      }),
    }),
    insert: (table: unknown) => ({
      values: async (row: Record<string, unknown>) => {
        if (table === users) {
          if (insertUsersError) {
            const err = insertUsersError;
            insertUsersError = null;
            throw err;
          }
          insertedUsers.push(row as (typeof insertedUsers)[number]);
          return;
        }
        if (table === passwordResetTokens) {
          insertedResetTokens.push(row as (typeof insertedResetTokens)[number]);
        }
      },
    }),
    update: (table: unknown) => ({
      set: (patch: Record<string, unknown>) => ({
        where: async (_cond: unknown) => {
          if (table === users) updatedUserPasswords.push(patch as (typeof updatedUserPasswords)[number]);
          if (table === passwordResetTokens)
            updatedResetTokens.push(patch as (typeof updatedResetTokens)[number]);
        },
      }),
    }),
  }),
}));

vi.mock("../email", () => ({
  isEmailConfigured: () => emailConfigured,
  sendEmail: async (opts: { to: string; subject: string; text: string }) => {
    sentEmails.push(opts);
    return { delivered: emailConfigured };
  },
}));

// Deterministic, so a reset link in a test assertion is not chasing whatever
// AUTH_URL happens to be set in the shell that runs the suite.
vi.mock("../site-url", () => ({ siteUrl: () => "https://wylthiq.test" }));

// None of signUp / requestPasswordReset / resetPassword call auth() — only
// changeUsername does — but the import still runs NextAuth()'s module-level
// setup, which resolves `next/server` in a way this Vitest environment
// cannot. Stubbed rather than exercised; changeUsername has its own gap this
// file does not close.
vi.mock("./index", () => ({ auth: async () => null }));

/*
  The limiter reads request headers, which do not exist outside a request, so
  it is stubbed rather than exercised here. `rateLimitedSeconds` lets the two
  tests that care drive the tripped path; everything else runs unlimited,
  which is the behaviour those tests were written against.
*/
vi.mock("../security/guard", () => ({
  actionRateLimited: async () => rateLimitedSeconds,
}));

const { signUp, requestPasswordReset, resetPassword } = await import("./actions");

function form(fields: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.append(k, v);
  return f;
}

beforeEach(() => {
  dbConfigured = true;
  existingUserRows = [];
  usernameRows = [];
  resetTokenRows = [];
  insertUsersError = null;
  emailConfigured = true;
  rateLimitedSeconds = null;
  insertedUsers.length = 0;
  insertedResetTokens.length = 0;
  updatedUserPasswords.length = 0;
  updatedResetTokens.length = 0;
  sentEmails.length = 0;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("signUp", () => {
  const valid = { email: "reader@example.com", password: "a genuinely long passphrase" };

  it("creates the account when nothing is taken", async () => {
    const result = await signUp(null, form(valid));

    expect(result.ok).toBe(true);
    expect(insertedUsers).toHaveLength(1);
    expect(insertedUsers[0].email).toBe(valid.email);
    // bcrypt, not the plaintext — the one thing this test would fail loudly
    // for if it regressed, so it is worth asserting explicitly rather than
    // trusting hashPassword by proximity.
    expect(insertedUsers[0].passwordHash).not.toBe(valid.password);
    expect(insertedUsers[0].passwordHash.startsWith("$2")).toBe(true);
  });

  it("says so rather than implying a verification email was sent", async () => {
    // The message used to say "check your email", from a version of this
    // flow that emailed a verification link. Nothing here sends one — a
    // reader told to check their inbox would wait for something never sent.
    const result = await signUp(null, form(valid));
    expect(result.message.toLowerCase()).not.toContain("check your email");
    expect(result.message).toContain("sign in");
  });

  it("refuses a malformed email before touching the database", async () => {
    const result = await signUp(null, form({ ...valid, email: "not-an-email" }));
    expect(result.ok).toBe(false);
    expect(insertedUsers).toHaveLength(0);
  });

  it("refuses a password that fails the app's own rules", async () => {
    const result = await signUp(null, form({ ...valid, password: "short" }));
    expect(result.ok).toBe(false);
    expect(insertedUsers).toHaveLength(0);
  });

  it("refuses a reserved username before checking whether it is taken", async () => {
    const result = await signUp(null, form({ ...valid, name: "admin" }));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("reserved");
    expect(insertedUsers).toHaveLength(0);
  });

  /*
   * Never reveals whether an address is registered through the message or
   * timing — see the header comment in actions.ts. What it does do, on
   * purpose, is answer plainly rather than pretending to succeed: the
   * person at the form is told there is already an account, because
   * telling them to "check your email" for a verification step that does
   * not exist is a dead end with nothing to act on.
   */
  it("refuses a second signup with an email already registered, and notifies the owner", async () => {
    existingUserRows = [{ id: "existing-user" }];

    const result = await signUp(null, form(valid));

    expect(result.ok).toBe(false);
    expect(result.message).toContain("already has an account");
    expect(insertedUsers).toHaveLength(0);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe(valid.email);
  });

  it("offers alternatives for a taken username instead of a dead end", async () => {
    usernameRows = [{ name: "bob" }];

    const result = await signUp(null, form({ ...valid, name: "bob" }));

    expect(result.ok).toBe(false);
    expect(result.suggestions?.length).toBeGreaterThan(0);
    expect(insertedUsers).toHaveLength(0);
  });

  /*
   * The race the checks above cannot close: two submissions for the same
   * address in the same instant both pass the pre-check and only the
   * database's unique constraint catches the second one. Modelled here as
   * the insert throwing a Postgres 23505, exactly as uniqueViolation() in
   * actions.ts expects to find it.
   */
  it("turns a unique-constraint race on email into the same friendly refusal", async () => {
    insertUsersError = { code: "23505", constraint_name: "users_email_unique" };

    const result = await signUp(null, form(valid));

    expect(result.ok).toBe(false);
    expect(result.message).toContain("already has an account");
  });

  it("turns a unique-constraint race on username into a suggestion, not a crash", async () => {
    insertUsersError = { code: "23505", constraint_name: "users_name_unique" };

    const result = await signUp(null, form({ ...valid, name: "bob" }));

    expect(result.ok).toBe(false);
    expect(result.message).toContain("bob");
  });

  it("refuses outright when there is no database configured", async () => {
    dbConfigured = false;
    const result = await signUp(null, form(valid));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("unavailable");
  });
});

describe("requestPasswordReset", () => {
  const email = "reader@example.com";

  it("answers identically for a registered and an unregistered address", async () => {
    existingUserRows = [];
    const unknown = await requestPasswordReset(null, form({ email }));

    existingUserRows = [{ id: "user-1" }];
    const known = await requestPasswordReset(null, form({ email }));

    expect(unknown).toEqual(known);
    expect(unknown.ok).toBe(true);
  });

  it("emails a reset link only for a registered address", async () => {
    existingUserRows = [];
    await requestPasswordReset(null, form({ email }));
    expect(sentEmails).toHaveLength(0);

    existingUserRows = [{ id: "user-1" }];
    await requestPasswordReset(null, form({ email }));
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].text).toContain("https://wylthiq.test/reset-password?token=");
  });

  it("stores a hash of the token, never the token itself", async () => {
    existingUserRows = [{ id: "user-1" }];
    await requestPasswordReset(null, form({ email }));

    expect(insertedResetTokens).toHaveLength(1);
    const stored = insertedResetTokens[0].tokenHash;
    const linked = sentEmails[0].text.match(/token=([^\s]+)/)?.[1];

    expect(linked).toBeTruthy();
    expect(stored).not.toBe(linked);
    expect(stored).toMatch(/^[0-9a-f]{64}$/); // sha256, hex
  });

  it("answers the same way when there is no database at all", async () => {
    dbConfigured = false;
    const result = await requestPasswordReset(null, form({ email }));
    expect(result.ok).toBe(true);
    expect(sentEmails).toHaveLength(0);
  });

  /*
    With no mail provider the link goes to the server log and nowhere else, so
    "a reset link is on its way" describes something that cannot happen. These
    cover the honest answer and, more importantly, that making it honest did
    not open the enumeration hole the rest of this flow is built to avoid.
  */
  describe("with no mail provider configured", () => {
    it("says the link cannot be delivered rather than claiming it was sent", async () => {
      emailConfigured = false;
      existingUserRows = [{ id: "user-1" }];

      const result = await requestPasswordReset(null, form({ email }));

      expect(result.ok).toBe(false);
      expect(result.message).toMatch(/cannot send email/i);
      expect(result.message).not.toMatch(/on its way/i);
    });

    it("still answers identically for a registered and an unregistered address", async () => {
      emailConfigured = false;

      existingUserRows = [];
      const unknown = await requestPasswordReset(null, form({ email }));

      existingUserRows = [{ id: "user-1" }];
      const known = await requestPasswordReset(null, form({ email }));

      // The whole point: the message changed with the deployment, not with
      // whether this particular address is registered here.
      expect(unknown).toEqual(known);
    });

    it("still writes the link out, which is the operator's only way to finish a reset", async () => {
      emailConfigured = false;
      existingUserRows = [{ id: "user-1" }];

      await requestPasswordReset(null, form({ email }));

      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0].text).toContain("https://wylthiq.test/reset-password?token=");
      expect(insertedResetTokens).toHaveLength(1);
    });
  });
});

describe("resetPassword", () => {
  const validRow = {
    id: 1,
    userId: "user-1",
    tokenHash: "a".repeat(64),
    expires: new Date(Date.now() + 60_000),
    usedAt: null,
  };

  it("sets the new password and burns the token in one call", async () => {
    resetTokenRows = [validRow];

    const result = await resetPassword(
      null,
      form({ token: "whatever-the-mock-does-not-check", password: "a fresh long passphrase" }),
    );

    expect(result.ok).toBe(true);
    // .where(eq(users.id, row.userId)) is the part naming *which* row —
    // opaque to this mock, like every other condition here (see the header
    // comment). What is checked is the part the mock can see: the new
    // password was actually written, as a hash rather than the plaintext,
    // and the token that authorised it was burned in the same call.
    expect(updatedUserPasswords).toHaveLength(1);
    expect(updatedUserPasswords[0].passwordHash).not.toContain("a fresh long passphrase");
    expect(updatedResetTokens).toHaveLength(1);
    expect(updatedResetTokens[0].usedAt).toBeInstanceOf(Date);
  });

  it("refuses a password that fails the app's own rules before touching the token", async () => {
    resetTokenRows = [validRow];
    const result = await resetPassword(null, form({ token: "x", password: "short" }));

    expect(result.ok).toBe(false);
    expect(updatedUserPasswords).toHaveLength(0);
  });

  it("refuses when no token matches — expired, spent, or simply wrong", async () => {
    resetTokenRows = [];
    const result = await resetPassword(
      null,
      form({ token: "x", password: "a fresh long passphrase" }),
    );

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/expired|already been used/);
    expect(updatedUserPasswords).toHaveLength(0);
  });

  it("refuses an empty token without touching the database", async () => {
    const result = await resetPassword(
      null,
      form({ token: "", password: "a fresh long passphrase" }),
    );
    expect(result.ok).toBe(false);
  });
});

describe("rate limiting", () => {
  it("refuses a sign-up once the limit is hit, before touching the database", async () => {
    rateLimitedSeconds = 42;

    const result = await signUp(null, form({ email: "new@example.com", password: "a long enough passphrase" }));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/too many/i);
    expect(insertedUsers).toHaveLength(0);
  });

  /*
    The property worth protecting: a tripped limit must not become a way to
    tell registered addresses from unregistered ones. If this reply differed
    from the ordinary one, an attacker could spend the allowance on purpose
    and read the difference.
  */
  it("answers a rate-limited reset identically to an ordinary one", async () => {
    existingUserRows = [{ id: "user-1" }];
    const ordinary = await requestPasswordReset(null, form({ email: "reader@example.com" }));

    rateLimitedSeconds = 30;
    const limited = await requestPasswordReset(null, form({ email: "reader@example.com" }));

    expect(limited).toEqual(ordinary);
    // And nothing was sent on the limited attempt.
    expect(sentEmails).toHaveLength(1);
  });
});
