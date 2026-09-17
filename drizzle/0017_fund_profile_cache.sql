-- A fund's commercial facts, kept so they are fetched once rather than daily.
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice.
--
-- An expense ratio, an inception date and a turnover figure are close to
-- constant — a fund changes its fee once in years, and never twice in a day.
-- The source that carries them for US funds is Alpha Vantage, whose free
-- allowance is 25 calls a day for the whole application, so without somewhere
-- to keep an answer most funds simply never got one: on 2026-09-17 the live
-- site showed a fee for four of thirteen funds checked, and none of the large
-- US ones.
--
-- `profile` holds the mapped EtfProfile, not the provider's payload, so a
-- reader of this table sees the same shape the pages use.

CREATE TABLE IF NOT EXISTS "fund_profile_cache" (
  "id" serial PRIMARY KEY,
  "symbol" text NOT NULL,
  "source" text NOT NULL,
  "profile" jsonb NOT NULL,
  "fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "fund_profile_cache_symbol_idx"
  ON "fund_profile_cache" ("symbol");
