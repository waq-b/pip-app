CREATE TABLE IF NOT EXISTS "user_rules" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"handpicked_target" integer NOT NULL,
	"side_bet_cap" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_rules_cap_range" CHECK ("user_rules"."side_bet_cap" between 0 and 20),
	CONSTRAINT "user_rules_target_range" CHECK ("user_rules"."handpicked_target" between 0 and 100),
	CONSTRAINT "user_rules_shape" CHECK ("user_rules"."handpicked_target" + "user_rules"."side_bet_cap" <= 100)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_rules" ADD CONSTRAINT "user_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- A user's rules: the server writes, a signed-in user reads only their own row.
ALTER TABLE "user_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "user_rules" FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ON "user_rules" TO authenticated;--> statement-breakpoint
CREATE POLICY "own rules" ON "user_rules" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());
