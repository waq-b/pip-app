CREATE TABLE IF NOT EXISTS "kraken_ledger" (
	"credential_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"entry_id" text NOT NULL,
	"refid" text NOT NULL,
	"at" timestamp with time zone NOT NULL,
	"type" text NOT NULL,
	"subtype" text NOT NULL,
	"asset" text NOT NULL,
	"amount" numeric NOT NULL,
	"fee" numeric NOT NULL,
	"balance" numeric NOT NULL,
	CONSTRAINT "kraken_ledger_credential_id_entry_id_pk" PRIMARY KEY("credential_id","entry_id")
);
--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "average_price_paid" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "total_cost_pence" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "staked_quantity" numeric;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kraken_ledger" ADD CONSTRAINT "kraken_ledger_credential_id_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kraken_ledger" ADD CONSTRAINT "kraken_ledger_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Kraken ledger: server writes, a signed-in user reads only their own rows (as with trades).
ALTER TABLE "kraken_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "kraken_ledger" FROM anon, authenticated;--> statement-breakpoint
GRANT SELECT ON "kraken_ledger" TO authenticated;--> statement-breakpoint
CREATE POLICY "own kraken ledger" ON "kraken_ledger" FOR SELECT TO authenticated
  USING ("user_id" = private.current_app_user_id());
