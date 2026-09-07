-- Every Stripe event this deployment has already acted on.
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice.
--
-- Stripe retries a webhook until it gets a 2xx, and a retry can arrive after
-- the first delivery was already processed — a timeout on our side, a network
-- blip on theirs. Signature verification proves the event is genuinely from
-- Stripe; it says nothing about whether this is the first time we have seen
-- it. Without a record, a replayed checkout.session.completed grants the
-- subscription twice, and anybody who captured a valid signed payload could
-- replay it deliberately.
--
-- The event id is the primary key, so recording it is the idempotency check:
-- an insert that conflicts means it has been handled and there is nothing
-- left to do.
CREATE TABLE IF NOT EXISTS "stripe_events" (
  "id" text PRIMARY KEY,
  "type" text NOT NULL,
  "processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
