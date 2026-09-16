CREATE TABLE IF NOT EXISTS "market_schedules" (
	"schedule_id" integer PRIMARY KEY NOT NULL,
	"exchange_name" text NOT NULL,
	"events" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "market_schedules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "market_schedules" FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ON "market_schedules" TO authenticated;--> statement-breakpoint
CREATE POLICY "signed-in users read market schedules" ON "market_schedules" FOR SELECT TO authenticated USING (true);
