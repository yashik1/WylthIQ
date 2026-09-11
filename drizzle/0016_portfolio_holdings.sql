-- A reader's own holdings, for the portfolio page.
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice.
--
-- One row per reader per company, holding a quantity and an average cost:
-- the figures a portfolio view needs, without pretending to be a ledger of
-- every lot. Nothing here connects to a brokerage.

CREATE TABLE IF NOT EXISTS "portfolio_holdings" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "symbol" text NOT NULL,
  "quantity" double precision NOT NULL,
  "average_cost" double precision NOT NULL,
  "purchase_date" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "portfolio_holdings_user_symbol_idx"
  ON "portfolio_holdings" ("user_id", "symbol");
