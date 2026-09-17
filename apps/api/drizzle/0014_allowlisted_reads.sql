-- Shared market data and facts: readable only by people on the allowlist.
--
-- Before this, any Supabase session could read them through Supabase's REST
-- API with the web app's publishable key — including someone who had made
-- themselves a Supabase account but isn't on the list. `instruments` only
-- holds things someone has held, so that named Pip's holdings. Now a policy
-- needs the caller's allowlist row, the same check as the own-rows policies.
ALTER POLICY "signed-in users read instruments" ON "instruments" USING (private.current_app_user_id() IS NOT NULL);--> statement-breakpoint
ALTER POLICY "signed-in users read prices" ON "prices" USING (private.current_app_user_id() IS NOT NULL);--> statement-breakpoint
ALTER POLICY "signed-in users read daily closes" ON "daily_closes" USING (private.current_app_user_id() IS NOT NULL);--> statement-breakpoint
ALTER POLICY "signed-in users read intraday series" ON "intraday_series" USING (private.current_app_user_id() IS NOT NULL);--> statement-breakpoint
ALTER POLICY "signed-in users read market schedules" ON "market_schedules" USING (private.current_app_user_id() IS NOT NULL);--> statement-breakpoint
ALTER POLICY "signed-in users read news" ON "facts_news" USING (private.current_app_user_id() IS NOT NULL);--> statement-breakpoint
ALTER POLICY "signed-in users read news links" ON "facts_news_instruments" USING (private.current_app_user_id() IS NOT NULL);--> statement-breakpoint
ALTER POLICY "signed-in users read events" ON "facts_events" USING (private.current_app_user_id() IS NOT NULL);--> statement-breakpoint
-- Supabase's default grants on the first two tables were never taken back.
-- RLS with no policies already refused every row through the REST API, but
-- nothing outside the server should hold any privilege on the allowlist.
REVOKE ALL ON "users", "waitlist" FROM anon, authenticated;
