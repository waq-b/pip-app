ALTER TABLE "nudges" ADD COLUMN "dedupe_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "nudges" ADD COLUMN "built_on" date NOT NULL;--> statement-breakpoint
ALTER TABLE "nudges" ADD CONSTRAINT "nudges_once_a_day" UNIQUE("user_id","cadence","dedupe_key","built_on");