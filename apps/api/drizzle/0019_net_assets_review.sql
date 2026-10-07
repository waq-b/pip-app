-- The yearly net-assets check: a calendar nudge a year
-- after the figure was last given, since it's what sets Side Bet's limit and
-- the FCA's own statement is renewed yearly.
ALTER TABLE "nudges" DROP CONSTRAINT IF EXISTS "nudges_kind_reason";--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_kind_reason" CHECK (("kind" = 'none' and "reason" in ('quiet')) or ("kind" = 'shape' and "reason" in ('cap', 'drift')) or ("kind" = 'calendar' and "reason" in ('earnings', 'isa_year_end', 'net_assets_review')) or ("kind" = 'awareness' and "reason" in ('news', 'move')));
