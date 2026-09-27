-- A reader's own brokerage account, connected read-only.
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice.
--
-- The first broker is Interactive Brokers through its Flex Web Service: the
-- reader creates a report query and a token in their own IBKR portal and
-- pastes both here. That token can download reports and nothing else — it
-- cannot place an order or move money — so read-only is a property of the
-- credential, not a promise this code makes.
--
-- New tables rather than new columns on portfolio_holdings or trades. A
-- column the code reads before its migration has run breaks every query on
-- that table; a missing table only breaks the feature that needs it.

CREATE TABLE IF NOT EXISTS "broker_connections" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "broker" text NOT NULL,
  "token_ciphertext" text NOT NULL,
  "token_hint" text NOT NULL,
  "query_id" text NOT NULL,
  "status" text DEFAULT 'ok' NOT NULL,
  "last_error_code" text,
  "journal_since" text NOT NULL,
  "statement_to_date" text,
  "skipped" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "sync_started_at" timestamp with time zone,
  "last_attempt_at" timestamp with time zone,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "broker_connections_user_broker_idx"
  ON "broker_connections" ("user_id", "broker");
--> statement-breakpoint

-- What the broker reported holding at its last statement. Replaced whole on
-- every sync, so a position closed at the broker disappears here too.
CREATE TABLE IF NOT EXISTS "broker_positions" (
  "id" serial PRIMARY KEY,
  "connection_id" integer NOT NULL REFERENCES "broker_connections"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL,
  "conid" text NOT NULL,
  "symbol" text NOT NULL,
  "quantity" double precision NOT NULL,
  "average_cost" double precision NOT NULL,
  "currency" text NOT NULL,
  "report_date" text
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "broker_positions_connection_account_conid_idx"
  ON "broker_positions" ("connection_id", "account_id", "conid");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "broker_positions_user_idx"
  ON "broker_positions" ("user_id");
--> statement-breakpoint

-- Every fill the broker has reported, kept so the journal can be rebuilt from
-- the whole history rather than from one statement's window. The external id
-- is the broker's own, so downloading an overlapping window twice is harmless.
CREATE TABLE IF NOT EXISTS "broker_executions" (
  "id" serial PRIMARY KEY,
  "connection_id" integer NOT NULL REFERENCES "broker_connections"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "account_id" text NOT NULL,
  "conid" text NOT NULL,
  "external_id" text NOT NULL,
  "symbol" text NOT NULL,
  "quantity" double precision NOT NULL,
  "price" double precision NOT NULL,
  "commission" double precision DEFAULT 0 NOT NULL,
  "commission_currency" text,
  "currency" text NOT NULL,
  "trade_date" text NOT NULL,
  "executed_at" text NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "broker_executions_connection_external_idx"
  ON "broker_executions" ("connection_id", "external_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "broker_executions_connection_account_conid_idx"
  ON "broker_executions" ("connection_id", "account_id", "conid");
--> statement-breakpoint

-- Which journal trade each synced round trip became.
--
-- Keyed by the reader and the broker's own ids rather than by the connection,
-- so disconnecting and connecting again finds the trades already made instead
-- of adding every one a second time. A trade the reader deletes leaves its
-- link behind with trade_id NULL, which is how a sync knows never to bring it
-- back.
CREATE TABLE IF NOT EXISTS "broker_trade_links" (
  "id" serial PRIMARY KEY,
  "user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "broker" text NOT NULL,
  "account_id" text NOT NULL,
  "opening_external_id" text NOT NULL,
  "trade_id" integer REFERENCES "trades"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "broker_trade_links_user_opening_idx"
  ON "broker_trade_links" ("user_id", "broker", "account_id", "opening_external_id");
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "broker_trade_links_trade_idx"
  ON "broker_trade_links" ("trade_id");
