import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Joining the public newsletter.
 *
 * The interesting cases are all abuse and leakage rather than the happy path:
 * this form is public, unauthenticated, and accepts any address somebody
 * types into it, including one belonging to a stranger.
 */

let dbConfigured = true;
let emailConfigured = true;
let existingRow:
  | { confirmedAt: Date | null; unsubscribedAt: Date | null; confirmSentAt: Date }
  | undefined;
let insertError: unknown = null;

const inserted: { email: string }[] = [];
const updates: Record<string, unknown>[] = [];
const sentEmails: { to: string; subject: string; text: string }[] = [];

vi.mock("../db", () => ({
  isDatabaseConfigured: () => dbConfigured,
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => (existingRow ? [existingRow] : []) }),
      }),
    }),
    insert: () => ({
      values: async (row: { email: string }) => {
        if (insertError) throw insertError;
        inserted.push(row);
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          updates.push(values);
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

vi.mock("../site-url", () => ({ siteUrl: () => "https://marketminer.test" }));

const { subscribeToNewsletter } = await import("./actions");

function form(email: string): FormData {
  const f = new FormData();
  f.append("email", email);
  return f;
}

const HOUR = 60 * 60 * 1000;
const email = "reader@example.com";

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-not-a-real-one";
  dbConfigured = true;
  emailConfigured = true;
  existingRow = undefined;
  insertError = null;
  inserted.length = 0;
  updates.length = 0;
  sentEmails.length = 0;
});

describe("a new address", () => {
  it("is stored and sent a confirmation, not a newsletter", async () => {
    const result = await subscribeToNewsletter(null, form(email));

    expect(result.ok).toBe(true);
    expect(inserted).toEqual([{ email }]);
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].subject).toMatch(/confirm/i);
    expect(sentEmails[0].text).toContain("https://marketminer.test/api/newsletter/confirm?token=");
  });

  it("is lowercased and trimmed, so one address cannot become two rows", async () => {
    await subscribeToNewsletter(null, form("  Reader@Example.COM  "));
    expect(inserted).toEqual([{ email }]);
  });

  it("is refused when it is not an address at all", async () => {
    const result = await subscribeToNewsletter(null, form("not-an-address"));

    expect(result.ok).toBe(false);
    expect(inserted).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });
});

describe("what the form gives away", () => {
  /*
    A form that answers "you are already subscribed" is a way to test whether
    somebody reads this site. Every well-formed address gets the same reply.
  */
  it("answers identically for a new address and a confirmed subscriber", async () => {
    const fresh = await subscribeToNewsletter(null, form(email));

    existingRow = { confirmedAt: new Date(), unsubscribedAt: null, confirmSentAt: new Date() };
    const known = await subscribeToNewsletter(null, form(email));

    expect(fresh).toEqual(known);
  });

  it("sends nothing to an address already subscribed", async () => {
    existingRow = { confirmedAt: new Date(), unsubscribedAt: null, confirmSentAt: new Date() };

    await subscribeToNewsletter(null, form(email));

    expect(sentEmails).toHaveLength(0);
    expect(updates).toHaveLength(0);
  });
});

describe("the resend cooldown", () => {
  /*
    Without this the form forwards one email per submission to whatever
    address is typed in — a spam cannon pointed at a stranger, wearing this
    site's sending domain.
  */
  it("refuses a second confirmation inside the hour", async () => {
    existingRow = {
      confirmedAt: null,
      unsubscribedAt: null,
      confirmSentAt: new Date(Date.now() - 5 * 60 * 1000),
    };

    await subscribeToNewsletter(null, form(email));

    expect(sentEmails).toHaveLength(0);
  });

  it("allows one once the hour has passed, so a lost email is recoverable", async () => {
    existingRow = {
      confirmedAt: null,
      unsubscribedAt: null,
      confirmSentAt: new Date(Date.now() - 2 * HOUR),
    };

    await subscribeToNewsletter(null, form(email));

    expect(sentEmails).toHaveLength(1);
  });
});

describe("somebody who left and came back", () => {
  it("must confirm again rather than being quietly re-added", async () => {
    existingRow = {
      confirmedAt: new Date(Date.now() - 30 * 24 * HOUR),
      unsubscribedAt: new Date(Date.now() - 2 * 24 * HOUR),
      confirmSentAt: new Date(Date.now() - 30 * 24 * HOUR),
    };

    await subscribeToNewsletter(null, form(email));

    expect(sentEmails).toHaveLength(1);
    // Cleared, so the old confirmation cannot stand in for a new decision.
    expect(updates[0]).toMatchObject({ confirmedAt: null, unsubscribedAt: null });
  });
});

describe("when the deployment cannot send", () => {
  it("says so instead of promising an email", async () => {
    emailConfigured = false;

    const result = await subscribeToNewsletter(null, form(email));

    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/cannot send email/i);
    expect(result.message).not.toMatch(/check your inbox/i);
  });

  it("answers the same way whether or not the address is already known", async () => {
    emailConfigured = false;

    const fresh = await subscribeToNewsletter(null, form(email));
    existingRow = { confirmedAt: new Date(), unsubscribedAt: null, confirmSentAt: new Date() };
    const known = await subscribeToNewsletter(null, form(email));

    expect(fresh).toEqual(known);
  });
});

describe("races and outages", () => {
  it("treats a duplicate-key collision as somebody else's identical submission", async () => {
    insertError = Object.assign(new Error("duplicate key"), { code: "23505" });

    const result = await subscribeToNewsletter(null, form(email));

    // The reply is the ordinary one: a confirmation is already on its way.
    expect(result.ok).toBe(true);
    expect(sentEmails).toHaveLength(0);
  });

  it("reports a real database failure rather than claiming success", async () => {
    insertError = new Error("connection refused");

    const result = await subscribeToNewsletter(null, form(email));

    expect(result.ok).toBe(false);
    expect(sentEmails).toHaveLength(0);
  });

  it("does not pretend to have stored anything with no database", async () => {
    dbConfigured = false;

    await subscribeToNewsletter(null, form(email));

    expect(inserted).toHaveLength(0);
    expect(sentEmails).toHaveLength(0);
  });
});
