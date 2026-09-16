-- Move the "which allowlist row am I" helper out of `public`.
--
-- Supabase exposes `public` functions over its REST API, so the SECURITY
-- DEFINER helper from 0003 was callable at /rest/v1/rpc/current_app_user_id.
-- It only ever returned the caller's own id, but nothing in `public` should be
-- a definer function reachable from the internet. `private` isn't exposed.
CREATE SCHEMA IF NOT EXISTS private;--> statement-breakpoint
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon;--> statement-breakpoint
GRANT USAGE ON SCHEMA private TO authenticated;--> statement-breakpoint
CREATE OR REPLACE FUNCTION private.current_app_user_id() RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT id FROM public.users WHERE auth_user_id = auth.uid()
$$;--> statement-breakpoint
REVOKE ALL ON FUNCTION private.current_app_user_id() FROM PUBLIC, anon;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION private.current_app_user_id() TO authenticated;--> statement-breakpoint
ALTER POLICY "own credentials" ON "provider_credentials" USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
ALTER POLICY "own holdings" ON "holdings" USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
ALTER POLICY "own cash" ON "cash" USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
ALTER POLICY "own trades" ON "trades" USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
ALTER POLICY "own daily values" ON "daily_values" USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
DROP FUNCTION public.current_app_user_id();
