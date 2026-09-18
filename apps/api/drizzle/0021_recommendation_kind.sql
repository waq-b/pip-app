-- Recommendations get a kind of their own (phase-6.md decision 14): one reason
-- per trigger, and a recommendation always carries its course.
--
-- Also brings drizzle's schema snapshot level with 0018–0020, which were
-- written by hand. Every statement is safe to run again: the constraints are
-- dropped if present and re-added, and the column is added only if missing.
ALTER TABLE "job_runs" DROP CONSTRAINT IF EXISTS "job_runs_job";--> statement-breakpoint
ALTER TABLE "job_runs" ADD CONSTRAINT "job_runs_job" CHECK ("job_runs"."job" in ('refresh', 'poll', 'prices', 'facts', 'weekly_build', 'daily_build', 'outcomes'));--> statement-breakpoint
ALTER TABLE "limit_alerts" ADD COLUMN IF NOT EXISTS "cleared_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "nudges" DROP CONSTRAINT IF EXISTS "nudges_kind";--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_kind" CHECK ("nudges"."kind" in ('none', 'shape', 'calendar', 'awareness', 'recommendation'));--> statement-breakpoint
ALTER TABLE "nudges" DROP CONSTRAINT IF EXISTS "nudges_kind_reason";--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_kind_reason" CHECK ((("kind" = 'none' and "reason" in ('quiet')) or ("kind" = 'shape' and "reason" in ('cap', 'drift')) or ("kind" = 'calendar' and "reason" in ('earnings', 'isa_year_end', 'net_assets_review')) or ("kind" = 'awareness' and "reason" in ('news', 'move')) or ("kind" = 'recommendation' and "reason" in ('side_bet_over_limit', 'holding_multiple', 'pot_off_target', 'urgent_move'))));--> statement-breakpoint
ALTER TABLE "nudges" DROP CONSTRAINT IF EXISTS "nudges_recommendation_kind";--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_recommendation_kind" CHECK (("nudges"."kind" = 'recommendation') = ("nudges"."recommendation" is not null));
