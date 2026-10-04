-- Which kind of account a hand-entered holding sits in: TFSA, RRSP, FHSA…
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice.
--
-- Synced holdings need no column: their accounts' types are read from the
-- broker, or set by the reader, and kept in broker_connections.details.
--
-- A company may now be held by hand in two kinds of account — the same ETF in
-- a TFSA and in an RRSP — so the one-row-per-company index becomes one row per
-- company and kind of account. A holding with no kind set counts as one more
-- kind. The index keeps its name, because 0016 runs again on every migrate and
-- would otherwise recreate the old, narrower one, which would then fail
-- against exactly the rows this allows.

ALTER TABLE "portfolio_holdings" ADD COLUMN IF NOT EXISTS "account_type" text;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = current_schema()
      AND tablename = 'portfolio_holdings'
      AND indexname = 'portfolio_holdings_user_symbol_idx'
      AND indexdef LIKE '%account_type%'
  ) THEN
    DROP INDEX IF EXISTS "portfolio_holdings_user_symbol_idx";
    CREATE UNIQUE INDEX "portfolio_holdings_user_symbol_idx"
      ON "portfolio_holdings" ("user_id", "symbol", (coalesce("account_type", '')));
  END IF;
END $$;
