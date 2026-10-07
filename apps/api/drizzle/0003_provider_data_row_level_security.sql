-- Row Level Security for the Phase 2 tables: the second wall behind the API.
--
-- Fastify reads user data as the `authenticated` role with the user's verified
-- JWT claims set for the transaction, so these policies decide
-- what a route can see even if the route itself has a bug. Scheduled jobs and
-- credential writes use the privileged connection, which bypasses RLS and does
-- only what the job needs. The anon key the web app ships gets nothing.
--
-- Every new table needs `ENABLE ROW LEVEL SECURITY` here — db/rls.test.ts
-- fails until it has one.

-- Which allowlist row the signed-in Supabase user is. SECURITY DEFINER because
-- `users` itself has RLS on with no policies; the function returns only the
-- caller's own id, never anyone else's.
CREATE OR REPLACE FUNCTION public.current_app_user_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.users WHERE auth_user_id = auth.uid()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION public.current_app_user_id() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION public.current_app_user_id() TO authenticated;--> statement-breakpoint

ALTER TABLE "provider_credentials" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "instruments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "prices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_closes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "intraday_series" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "holdings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "cash" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trades" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "daily_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "source_usage" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- Signed-in users only ever read; every write goes through the server.
REVOKE ALL ON "provider_credentials", "instruments", "prices", "daily_closes", "intraday_series",
  "holdings", "cash", "trades", "daily_values", "source_usage" FROM anon, authenticated;--> statement-breakpoint

-- Credentials: own rows, and never the sealed columns.
GRANT SELECT ("id", "user_id", "provider", "account_kind", "status", "account_currency",
  "last_verified_at", "last_polled_at", "backfill_status", "history_starts_on", "created_at")
  ON "provider_credentials" TO authenticated;--> statement-breakpoint
CREATE POLICY "own credentials" ON "provider_credentials" FOR SELECT TO authenticated
  USING ("user_id" = public.current_app_user_id());--> statement-breakpoint

-- What a user holds and how it has done: own rows only.
GRANT SELECT ON "holdings", "cash", "trades", "daily_values" TO authenticated;--> statement-breakpoint
CREATE POLICY "own holdings" ON "holdings" FOR SELECT TO authenticated
  USING ("user_id" = public.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own cash" ON "cash" FOR SELECT TO authenticated
  USING ("user_id" = public.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own trades" ON "trades" FOR SELECT TO authenticated
  USING ("user_id" = public.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own daily values" ON "daily_values" FOR SELECT TO authenticated
  USING ("user_id" = public.current_app_user_id());--> statement-breakpoint

-- Market data is the same for everyone who's signed in.
GRANT SELECT ON "instruments", "prices", "daily_closes", "intraday_series" TO authenticated;--> statement-breakpoint
CREATE POLICY "signed-in users read instruments" ON "instruments" FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY "signed-in users read prices" ON "prices" FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY "signed-in users read daily closes" ON "daily_closes" FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY "signed-in users read intraday series" ON "intraday_series" FOR SELECT TO authenticated USING (true);
-- source_usage: no grant, no policy. Server only.
