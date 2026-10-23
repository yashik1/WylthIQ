-- Where each company's share price stands against its own history, for the
-- screener's price-trend filter: moving averages, the last 50/200-day cross,
-- the 52-week range and RSI, plus the list of states they put it in.
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice.
--
-- Filled each weekday evening after the quotes refresh (technicals-refresh.ts).
-- A company with no price history keeps nulls and matches no trend filter.

ALTER TABLE "scores" ADD COLUMN IF NOT EXISTS "technical_close" double precision;
--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN IF NOT EXISTS "sma_50" double precision;
--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN IF NOT EXISTS "sma_200" double precision;
--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN IF NOT EXISTS "rsi_14" double precision;
--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN IF NOT EXISTS "high_52w" double precision;
--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN IF NOT EXISTS "low_52w" double precision;
--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN IF NOT EXISTS "last_cross" text;
--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN IF NOT EXISTS "last_cross_date" text;
--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN IF NOT EXISTS "trend_states" text[];
--> statement-breakpoint
ALTER TABLE "scores" ADD COLUMN IF NOT EXISTS "technicals_as_of" text;
