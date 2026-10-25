-- The chart of each journal trade: the fills inside it, the price bars around
-- it as they were when it was recorded, and the reader's own screenshots.
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice.
--
-- `fills` is null on trades from before this, until the next broker sync
-- writes them; a hand-entered trade without them is charted from its dates.

ALTER TABLE "trades" ADD COLUMN IF NOT EXISTS "fills" jsonb;
--> statement-breakpoint

-- The bars a trade's chart is drawn from, captured once, close to when the
-- trade happened. Free intraday history runs out after a few weeks for most
-- listings, so a chart fetched later would often have nothing to draw.
CREATE TABLE IF NOT EXISTS "trade_charts" (
  "trade_id" integer PRIMARY KEY REFERENCES "trades"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "timeframe" text NOT NULL,
  "from_at" timestamp with time zone NOT NULL,
  "to_at" timestamp with time zone NOT NULL,
  "bars" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "source" text,
  "includes_dividends" boolean DEFAULT false NOT NULL,
  "fills_key" text DEFAULT '' NOT NULL,
  "captured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "trade_charts_user_idx" ON "trade_charts" ("user_id");
--> statement-breakpoint

-- A reader's own screenshots of a trade, re-encoded to WebP on upload. Kept
-- in Postgres so there is no second service to run or back up; uploads are
-- capped in size and number per trade.
CREATE TABLE IF NOT EXISTS "trade_screenshots" (
  "id" serial PRIMARY KEY,
  "trade_id" integer NOT NULL REFERENCES "trades"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "image" bytea NOT NULL,
  "width" integer NOT NULL,
  "height" integer NOT NULL,
  "bytes" integer NOT NULL,
  "caption" text DEFAULT '' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "trade_screenshots_trade_idx" ON "trade_screenshots" ("trade_id");
