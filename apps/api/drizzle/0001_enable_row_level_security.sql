-- The web app ships Supabase's public anon key, and Supabase's REST API exposes
-- every table in `public` to it. RLS switched on with no policies means that
-- key can read and write nothing. Fastify connects as a role that bypasses RLS,
-- so the API is unaffected. Every new table needs a line here — db/rls.test.ts
-- fails until it has one.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "waitlist" ENABLE ROW LEVEL SECURITY;
