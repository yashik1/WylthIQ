-- Password reset invalidates the sessions that existed before it.
--
-- Hand-written like every migration here, because drizzle-kit is a dev
-- dependency and is absent in production. Safe to run twice.
--
-- Sessions are JWTs, so there is no session table to delete rows from. The
-- equivalent is a watermark: every token carries the time it was issued, and
-- a token issued before this timestamp is refused. Resetting a password moves
-- the watermark to now, which retires every token minted before it — which is
-- the point, since somebody resetting their password may be doing it
-- precisely because another person has a live session.
--
-- Nullable, and null means "never reset", so existing accounts keep working
-- without a backfill.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "sessions_valid_from" timestamp with time zone;
