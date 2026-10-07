-- An open alert keeps its threshold quiet until money in comes back clearly
-- under it, rather than the row being deleted — so the
-- bell keeps the history of what Pip has told you.
ALTER TABLE "limit_alerts" ADD COLUMN IF NOT EXISTS "cleared_at" timestamp with time zone;
