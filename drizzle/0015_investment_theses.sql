-- A reader's own investment thesis for a company.
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice.
--
-- One thesis per reader per company: editing replaces it rather than adding
-- a second. `created_at` survives edits on purpose, because Thesis vs Reality
-- measures the figures from the day the thesis was first written.

CREATE TABLE IF NOT EXISTS "investment_theses" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "symbol" text NOT NULL,
  "thesis" text NOT NULL DEFAULT '',
  "must_go_right" text NOT NULL DEFAULT '',
  "could_break" text NOT NULL DEFAULT '',
  "horizon" text,
  -- active | under-review | intact | at-risk | invalidated, set by the reader.
  "status" text NOT NULL DEFAULT 'active',
  -- Structured conditions, validated on the way in and again on the way out.
  "conditions" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "investment_theses_user_symbol_idx"
  ON "investment_theses" ("user_id", "symbol");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "investment_theses_user_updated_idx"
  ON "investment_theses" ("user_id", "updated_at");
