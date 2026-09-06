-- The public newsletter list: an email address and nothing else.
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice.
--
-- Deliberately separate from "users". A subscriber has no password and no
-- session and may never register, so folding them into accounts would put
-- rows that cannot sign in into every query that means "a person with an
-- account". Somebody can appear in both tables at once, which is intended:
-- the digest is personalised to an account's saved companies and this list
-- is not personalised at all.

CREATE TABLE IF NOT EXISTS "newsletter_subscribers" (
  "id" serial PRIMARY KEY,
  -- Stored lowercased; the action normalises before writing, exactly as the
  -- signup action does for users.email.
  "email" text NOT NULL UNIQUE,
  -- NULL until the address is confirmed. Double opt-in, so a typo or a
  -- malicious submission of somebody else's address never becomes a
  -- subscription — only confirmed rows are ever sent to.
  "confirmed_at" timestamp with time zone,
  -- Kept as a row rather than deleted: a deleted address can be resubscribed
  -- by whoever submitted it the first time, which is the loop an unsubscribe
  -- is supposed to end.
  "unsubscribed_at" timestamp with time zone,
  -- The resend cooldown. Without it the signup form is an email cannon —
  -- submit somebody else's address repeatedly and they get one confirmation
  -- per submission.
  "confirm_sent_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
