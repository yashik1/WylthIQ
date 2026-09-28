-- More ways to connect a broker, none of which hands this app a credential.
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice: dropping a
-- NOT NULL that is already gone and adding a column that already exists are
-- both no-ops.
--
-- 0018 assumed every connection was an IBKR Flex token. Two more arrive here:
-- a statement file the reader uploads (no token at all), and SnapTrade (a
-- partner secret, but no Flex query). So the token and query columns become
-- optional, and each connection gets somewhere to keep what the account page
-- shows about it — the institutions and masked account numbers — so the page
-- does not have to ask the broker every time it is opened.

ALTER TABLE "broker_connections" ALTER COLUMN "token_ciphertext" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "broker_connections" ALTER COLUMN "token_hint" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "broker_connections" ALTER COLUMN "query_id" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "broker_connections" ADD COLUMN IF NOT EXISTS "details" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint

-- The institution each holding and fill came from, for the badge beside it:
-- one SnapTrade connection can span several brokers.
ALTER TABLE "broker_positions" ADD COLUMN IF NOT EXISTS "label" text;
--> statement-breakpoint

ALTER TABLE "broker_executions" ADD COLUMN IF NOT EXISTS "label" text;
