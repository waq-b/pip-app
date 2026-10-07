-- Side Bet leaves the shape. Its cap in percent goes:
-- it has a limit in pounds now, from the sealed net assets, judged on money in
-- less taken out. Foundation is simply the rest of Handpicked's target.
ALTER TABLE "user_rules" DROP CONSTRAINT "user_rules_cap_range";--> statement-breakpoint
ALTER TABLE "user_rules" DROP CONSTRAINT "user_rules_shape";--> statement-breakpoint
ALTER TABLE "user_rules" DROP COLUMN IF EXISTS "side_bet_cap";