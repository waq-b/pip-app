CREATE TABLE IF NOT EXISTS "digests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"week_of" date NOT NULL,
	"opening" text NOT NULL,
	"counts" jsonb NOT NULL,
	"built_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "digests_user_id_week_of_unique" UNIQUE("user_id","week_of"),
	CONSTRAINT "digests_week_of_monday" CHECK (extract(isodow from "digests"."week_of") = 1)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "facts_events" (
	"instrument_id" text NOT NULL,
	"kind" text NOT NULL,
	"on_date" date NOT NULL,
	"detail" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facts_events_instrument_id_kind_on_date_pk" PRIMARY KEY("instrument_id","kind","on_date"),
	CONSTRAINT "facts_events_kind" CHECK ("facts_events"."kind" in ('earnings'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "facts_fetches" (
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"target" text NOT NULL,
	"last_fetched_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	CONSTRAINT "facts_fetches_source_kind_target_pk" PRIMARY KEY("source","kind","target")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "facts_news" (
	"id" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"publisher" text NOT NULL,
	"publisher_domain" text NOT NULL,
	"headline" text NOT NULL,
	"snippet" text,
	"url" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "facts_news_headline_length" CHECK (char_length("facts_news"."headline") <= 300),
	CONSTRAINT "facts_news_snippet_length" CHECK (char_length("facts_news"."snippet") <= 400)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "facts_news_instruments" (
	"news_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	CONSTRAINT "facts_news_instruments_news_id_instrument_id_pk" PRIMARY KEY("news_id","instrument_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "nudges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"digest_id" uuid,
	"cadence" text NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"bucket" text,
	"instrument_id" text,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"basis" text,
	"facts" jsonb NOT NULL,
	"checks" jsonb NOT NULL,
	"shown" boolean NOT NULL,
	"model" text NOT NULL,
	"prompt_version" text,
	"personalised" boolean NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"response" text,
	"responded_at" timestamp with time zone,
	"price_at" numeric,
	"price_currency" text,
	"price_source" text,
	"price_7d" numeric,
	"price_7d_at" timestamp with time zone,
	"price_30d" numeric,
	"price_30d_at" timestamp with time zone,
	"pot_share_at" numeric,
	"pot_share_7d" numeric,
	"pot_share_30d" numeric,
	CONSTRAINT "nudges_cadence" CHECK ("nudges"."cadence" in ('weekly', 'daily')),
	CONSTRAINT "nudges_kind_reason" CHECK ((("kind" = 'none' and "reason" in ('quiet')) or ("kind" = 'shape' and "reason" in ('cap', 'drift')) or ("kind" = 'calendar' and "reason" in ('earnings', 'isa_year_end')) or ("kind" = 'awareness' and "reason" in ('news', 'move')))),
	CONSTRAINT "nudges_kind" CHECK ("nudges"."kind" in ('none', 'shape', 'calendar', 'awareness')),
	CONSTRAINT "nudges_bucket" CHECK ("nudges"."bucket" in ('Base', 'Medium', 'Degen')),
	CONSTRAINT "nudges_response" CHECK ("nudges"."response" in ('nothing', 'acted', 'dismissed')),
	CONSTRAINT "nudges_weekly_in_a_week" CHECK (("nudges"."cadence" = 'weekly') = ("nudges"."digest_id" is not null))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trust_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"named_publishers" text[] NOT NULL,
	"recency_days" integer NOT NULL,
	"min_sources" integer NOT NULL,
	"results_quiet_days" integer NOT NULL,
	"weekly_budget" integer NOT NULL,
	"daily_budget_per_day" integer NOT NULL,
	"daily_budget_per_week" integer NOT NULL,
	"big_move_base" integer NOT NULL,
	"big_move_medium" integer NOT NULL,
	"big_move_degen" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trust_settings_publishers" CHECK (cardinality("trust_settings"."named_publishers") between 1 and 100),
	CONSTRAINT "trust_settings_recency" CHECK ("trust_settings"."recency_days" between 1 and 14),
	CONSTRAINT "trust_settings_min_sources" CHECK ("trust_settings"."min_sources" between 1 and 5),
	CONSTRAINT "trust_settings_quiet" CHECK ("trust_settings"."results_quiet_days" between 0 and 7),
	CONSTRAINT "trust_settings_weekly" CHECK ("trust_settings"."weekly_budget" between 1 and 8),
	CONSTRAINT "trust_settings_daily" CHECK ("trust_settings"."daily_budget_per_day" between 0 and 3),
	CONSTRAINT "trust_settings_daily_week" CHECK ("trust_settings"."daily_budget_per_week" between 0 and 7),
	CONSTRAINT "trust_settings_move_base" CHECK ("trust_settings"."big_move_base" between 1 and 50),
	CONSTRAINT "trust_settings_move_medium" CHECK ("trust_settings"."big_move_medium" between 1 and 50),
	CONSTRAINT "trust_settings_move_degen" CHECK ("trust_settings"."big_move_degen" between 1 and 50)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"goals" text DEFAULT '' NOT NULL,
	"horizon_years" integer,
	"monthly_in_pence" bigint,
	"risk_words" text DEFAULT '' NOT NULL,
	"exclusions" text[] DEFAULT '{}'::text[] NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_profiles_goals_length" CHECK (char_length("user_profiles"."goals") <= 280),
	CONSTRAINT "user_profiles_risk_length" CHECK (char_length("user_profiles"."risk_words") <= 280),
	CONSTRAINT "user_profiles_horizon" CHECK ("user_profiles"."horizon_years" between 0 and 60),
	CONSTRAINT "user_profiles_monthly_in" CHECK ("user_profiles"."monthly_in_pence" >= 0),
	CONSTRAINT "user_profiles_exclusions_count" CHECK (cardinality("user_profiles"."exclusions") <= 20)
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "personal_research" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "digests" ADD CONSTRAINT "digests_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "facts_events" ADD CONSTRAINT "facts_events_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "facts_news_instruments" ADD CONSTRAINT "facts_news_instruments_news_id_facts_news_id_fk" FOREIGN KEY ("news_id") REFERENCES "public"."facts_news"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "facts_news_instruments" ADD CONSTRAINT "facts_news_instruments_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nudges" ADD CONSTRAINT "nudges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nudges" ADD CONSTRAINT "nudges_digest_id_digests_id_fk" FOREIGN KEY ("digest_id") REFERENCES "public"."digests"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "nudges" ADD CONSTRAINT "nudges_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trust_settings" ADD CONSTRAINT "trust_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "user_profiles" ADD CONSTRAINT "user_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Phase 5 row level security. Facts are shared like prices: readable when
-- signed in, written by the server. Fetch bookkeeping is server-only. Profiles,
-- trust settings, weeks and nudges: the server writes, a signed-in user reads
-- only their own.
ALTER TABLE "facts_news" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "facts_news_instruments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "facts_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "facts_fetches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "user_profiles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "trust_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "digests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "nudges" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "facts_news", "facts_news_instruments", "facts_events", "facts_fetches",
  "user_profiles", "trust_settings", "digests", "nudges" FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ON "facts_news", "facts_news_instruments", "facts_events",
  "user_profiles", "trust_settings", "digests", "nudges" TO authenticated;--> statement-breakpoint
CREATE POLICY "signed-in users read news" ON "facts_news" FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY "signed-in users read news links" ON "facts_news_instruments" FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY "signed-in users read events" ON "facts_events" FOR SELECT TO authenticated USING (true);--> statement-breakpoint
CREATE POLICY "own profile" ON "user_profiles" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own trust settings" ON "trust_settings" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own weeks" ON "digests" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own nudges" ON "nudges" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());
