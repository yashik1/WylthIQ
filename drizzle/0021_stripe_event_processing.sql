ALTER TABLE "stripe_events"
  ADD COLUMN IF NOT EXISTS "status" text NOT NULL DEFAULT 'processed',
  ADD COLUMN IF NOT EXISTS "last_error" text,
  ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();

UPDATE "stripe_events"
SET "status" = 'processed',
    "updated_at" = COALESCE("processed_at", now())
WHERE "status" IS NULL OR "status" = 'processing';

ALTER TABLE "stripe_events"
  ALTER COLUMN "processed_at" DROP NOT NULL;
