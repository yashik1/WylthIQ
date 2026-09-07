import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { getDb, isDatabaseConfigured } from "../db";
import { accounts, sessions, users, verificationTokens } from "../db/schema";
import { equalizeTiming, verifyPassword } from "./password";

/** How long a token may go unverified against the revocation watermark. */
const REVOCATION_CHECK_SECONDS = 300;

/**
 * Authentication, on the Postgres this app already has.
 *
 * Email and password only for now. No OAuth provider is configured, but the
 * adapter tables are in place so adding one later is configuration rather than
 * a migration.
 *
 * JWT sessions rather than database sessions. Every page in this app reads the
 * session, and a database round trip per request to a Postgres that also
 * serves the screener is a cost with nothing to show for it here — the trade
 * is that revoking a session before it expires is not immediate, which matters
 * for a banking app and does not for this one.
 */

function requireSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set. Generate one with `openssl rand -base64 32` and " +
        "put it in the environment — sessions are signed with it, so without it " +
        "anyone could mint their own.",
    );
  }
  return secret;
}

export const { handlers, signIn, signOut, auth } = NextAuth(() => ({
  // The adapter is only wired up when there is a database to talk to, so a
  // deployment without DATABASE_URL fails on the sign-in attempt with a clear
  // message rather than at import time, taking every page down with it.
  adapter: isDatabaseConfigured()
    ? DrizzleAdapter(getDb(), {
        usersTable: users,
        accountsTable: accounts,
        sessionsTable: sessions,
        verificationTokensTable: verificationTokens,
      })
    : undefined,

  secret: requireSecret(),
  session: { strategy: "jwt" },
  pages: { signIn: "/signin", error: "/signin" },

  providers: [
    Credentials({
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },

      /**
       * Returns a user or null — never an explanation.
       *
       * Every failure path below is deliberately indistinguishable to the
       * caller: a wrong password, an unknown address and an account with no
       * password set all return null, and all take about the same time. The
       * sign-in page turns that single null into one generic message, so the
       * form cannot be used to work out who has an account here.
       */
      async authorize(raw) {
        const email = typeof raw?.email === "string" ? raw.email.trim().toLowerCase() : "";
        const password = typeof raw?.password === "string" ? raw.password : "";

        if (!email || !password || !isDatabaseConfigured()) {
          await equalizeTiming();
          return null;
        }

        const db = getDb();
        const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

        if (!user?.passwordHash) {
          // No account, or one created without a password. Spend the same time
          // a real comparison would.
          await equalizeTiming();
          return null;
        }

        const ok = await verifyPassword(password, user.passwordHash);
        if (!ok) return null;

        return { id: user.id, email: user.email, name: user.name, image: user.image };
      },
    }),
  ],

  callbacks: {
    /*
      The user id is carried on the token so that entitlement checks and the
      journal can identify the owner without a database lookup on every
      request. Deliberately nothing about subscription status is stored here:
      a token minted while someone was subscribed would keep asserting it long
      after they cancelled, so paid access is always read fresh — see
      requireSubscription in lib/billing.
    */
    /*
      Revocation, without giving up the reason these are JWTs.

      A password reset moves `users.sessionsValidFrom`, and a token issued
      before that instant must stop working. Checking it means a database read
      — exactly what this strategy exists to avoid on every request — so the
      answer is cached on the token itself and rechecked at most once every
      REVOCATION_CHECK_SECONDS.

      That is a deliberate trade, stated plainly: a stolen session survives a
      password reset for up to that window rather than being cut instantly.
      Five minutes of exposure in exchange for keeping auth off the database
      on the hot path; a shorter window costs more reads, and zero window
      means database sessions and a query per request.
    */
    async jwt({ token, user }) {
      if (user?.id) token.userId = user.id;

      const userId = token.userId as string | undefined;
      if (!userId) return token;

      const now = Math.floor(Date.now() / 1000);
      const lastChecked = (token.revocationCheckedAt as number | undefined) ?? 0;
      if (now - lastChecked < REVOCATION_CHECK_SECONDS) return token;

      try {
        const [row] = await getDb()
          .select({ validFrom: users.sessionsValidFrom })
          .from(users)
          .where(eq(users.id, userId))
          .limit(1);

        // Issued before the watermark: retired. Returning null ends the
        // session, which is what a reset is for.
        const issuedAt = token.iat as number | undefined;
        if (row?.validFrom && issuedAt && issuedAt * 1000 < row.validFrom.getTime()) {
          return null;
        }

        token.revocationCheckedAt = now;
      } catch {
        // A database blip must not sign everybody out. Failing open here is
        // the right direction: the watermark is a revocation mechanism, not
        // the thing granting access, and the signature has already been
        // verified by the time this runs.
      }

      return token;
    },
    session({ session, token }) {
      if (token.userId && session.user) {
        session.user.id = token.userId as string;
      }
      return session;
    },
  },
}));
