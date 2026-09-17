CREATE TABLE IF NOT EXISTS "connection_gaps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "connection_gaps_provider" CHECK ("connection_gaps"."provider" in ('trading212', 'kraken')),
	CONSTRAINT "connection_gaps_ends_after_it_starts" CHECK ("connection_gaps"."ended_at" is null or "connection_gaps"."ended_at" >= "connection_gaps"."started_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "job_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"summary" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error_steps" text[] DEFAULT '{}'::text[] NOT NULL,
	CONSTRAINT "job_runs_job" CHECK ("job_runs"."job" in ('refresh')),
	CONSTRAINT "job_runs_finishes_after_it_starts" CHECK ("job_runs"."finished_at" is null or "job_runs"."finished_at" >= "job_runs"."started_at")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "limit_alerts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"threshold" integer NOT NULL,
	"window_start" date NOT NULL,
	"alerted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"money_in_pence" bigint NOT NULL,
	"limit_pence" bigint NOT NULL,
	"starter_limit" boolean NOT NULL,
	CONSTRAINT "limit_alerts_once_per_window" UNIQUE("user_id","threshold","window_start"),
	CONSTRAINT "limit_alerts_threshold" CHECK ("limit_alerts"."threshold" in (80, 100)),
	CONSTRAINT "limit_alerts_money_in" CHECK ("limit_alerts"."money_in_pence" >= 0),
	CONSTRAINT "limit_alerts_limit" CHECK ("limit_alerts"."limit_pence" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "net_assets" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"sealed_amount" text NOT NULL,
	"master_key_version" integer NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_reads" (
	"user_id" uuid NOT NULL,
	"item_kind" text NOT NULL,
	"item_id" uuid NOT NULL,
	"read_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notification_reads_user_id_item_kind_item_id_pk" PRIMARY KEY("user_id","item_kind","item_id"),
	CONSTRAINT "notification_reads_item_kind" CHECK ("notification_reads"."item_kind" in ('nudge', 'limit_alert', 'connection_gap'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "notification_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"push" boolean DEFAULT true NOT NULL,
	"push_limit" boolean DEFAULT true NOT NULL,
	"push_urgent" boolean DEFAULT true NOT NULL,
	"push_digest" boolean DEFAULT true NOT NULL,
	"email" boolean DEFAULT true NOT NULL,
	"asked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"devices_tried" integer DEFAULT 0 NOT NULL,
	"devices_delivered" integer DEFAULT 0 NOT NULL,
	"sent_on" date NOT NULL,
	CONSTRAINT "push_deliveries_once_per_event" UNIQUE("user_id","kind","dedupe_key"),
	CONSTRAINT "push_deliveries_kind" CHECK ("push_deliveries"."kind" in ('limit', 'urgent', 'digest'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"label" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_delivered_at" timestamp with time zone,
	"last_failed_at" timestamp with time zone,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint"),
	CONSTRAINT "push_subscriptions_https" CHECK ("push_subscriptions"."endpoint" like 'https://%')
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "recommendation_state" (
	"user_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"subject" text NOT NULL,
	"state" text NOT NULL,
	"event_id" uuid,
	"since" timestamp with time zone DEFAULT now() NOT NULL,
	"last_checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recommendation_state_user_id_trigger_subject_pk" PRIMARY KEY("user_id","trigger","subject"),
	CONSTRAINT "recommendation_state_trigger" CHECK ("recommendation_state"."trigger" in ('side_bet_over_limit', 'holding_multiple', 'pot_off_target', 'urgent_move')),
	CONSTRAINT "recommendation_state_state" CHECK ("recommendation_state"."state" in ('clear', 'pending', 'fired', 'pending_clear')),
	CONSTRAINT "recommendation_state_event_when_fired" CHECK (("recommendation_state"."state" in ('fired', 'pending_clear')) = ("recommendation_state"."event_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "nudges" ADD COLUMN "urgent" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "nudges" ADD COLUMN "recommendation" text;--> statement-breakpoint
ALTER TABLE "nudges" ADD COLUMN "trigger" text;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "connection_gaps" ADD CONSTRAINT "connection_gaps_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "limit_alerts" ADD CONSTRAINT "limit_alerts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "net_assets" ADD CONSTRAINT "net_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_reads" ADD CONSTRAINT "notification_reads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_deliveries" ADD CONSTRAINT "push_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "recommendation_state" ADD CONSTRAINT "recommendation_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_recommendation" CHECK ("nudges"."recommendation" in ('hold', 'take_some_profit', 'rebalance'));--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_trigger" CHECK ("nudges"."trigger" in ('side_bet_over_limit', 'holding_multiple', 'pot_off_target', 'urgent_move'));--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_recommendation_has_a_trigger" CHECK (("nudges"."recommendation" is null) = ("nudges"."trigger" is null));--> statement-breakpoint
-- Phase 6 row level security. The server writes everything here. A signed-in
-- user reads their own settings, read marks, limit alerts and connection gaps;
-- their devices' push keys and their sealed net assets are never granted, and
-- deliveries, trigger state and job runs are the server's own bookkeeping.
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "push_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "notification_reads" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "connection_gaps" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "net_assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "limit_alerts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "recommendation_state" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "job_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "push_subscriptions", "notification_settings", "push_deliveries",
  "notification_reads", "connection_gaps", "net_assets", "limit_alerts",
  "recommendation_state", "job_runs" FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ON "notification_settings", "notification_reads", "connection_gaps",
  "limit_alerts" TO authenticated;--> statement-breakpoint
-- Never the endpoint or the keys: together they are what lets anyone push to
-- that device. The device row in Setup is built from these columns.
GRANT SELECT ("id", "user_id", "label", "created_at", "last_delivered_at", "last_failed_at")
  ON "push_subscriptions" TO authenticated;--> statement-breakpoint
-- Never the sealed figure (hard line 6) — only when it was last reviewed.
GRANT SELECT ("user_id", "reviewed_at", "updated_at") ON "net_assets" TO authenticated;--> statement-breakpoint
CREATE POLICY "own devices" ON "push_subscriptions" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own notification settings" ON "notification_settings" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
-- Deliveries, trigger state and job runs get a policy but no grant: the wall
-- is the missing grant, and the policy keeps every user-owned table answering
-- the same question ("whose row is this?") if a grant is ever added.
CREATE POLICY "own pushes" ON "push_deliveries" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own read marks" ON "notification_reads" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own connection gaps" ON "connection_gaps" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own net assets" ON "net_assets" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own limit alerts" ON "limit_alerts" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());--> statement-breakpoint
CREATE POLICY "own trigger state" ON "recommendation_state" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());
