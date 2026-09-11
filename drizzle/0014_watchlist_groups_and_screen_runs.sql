-- Watchlist groups, and when each saved screen was last run.
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice.
--
-- Two new tables rather than new columns on existing ones. A column added to
-- watchlist_items or saved_screeners would become part of every insert and
-- select the app's schema generates for those tables, so a deployment running
-- this code before this migration would stop saving companies and screens
-- altogether. As separate tables, groups and last-run details are simply
-- absent until this runs, and everything that already worked keeps working.

CREATE TABLE IF NOT EXISTS "watchlist_groups" (
  "user_id" text NOT NULL,
  "symbol" text NOT NULL,
  "group_name" text NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY ("user_id", "symbol"),
  -- Tied to the saved company itself, so removing a company from the list
  -- removes its group with it, and a group can never exist for a company the
  -- reader has not saved.
  FOREIGN KEY ("user_id", "symbol")
    REFERENCES "watchlist_items" ("user_id", "symbol") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "watchlist_groups_user_group_idx"
  ON "watchlist_groups" ("user_id", "group_name");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "saved_screen_runs" (
  "screen_id" integer PRIMARY KEY REFERENCES "saved_screeners"("id") ON DELETE CASCADE,
  "last_run_at" timestamp with time zone DEFAULT now() NOT NULL,
  -- How many companies the screen returned that time. Null when unknown.
  "result_count" integer
);
