CREATE TABLE IF NOT EXISTS "cash" (
	"credential_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"available_pence" bigint NOT NULL,
	"reserved_pence" bigint NOT NULL,
	"in_pies_pence" bigint NOT NULL,
	"polled_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_closes" (
	"key" text NOT NULL,
	"day" date NOT NULL,
	"close" numeric NOT NULL,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "daily_closes_key_day_pk" PRIMARY KEY("key","day")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "daily_values" (
	"user_id" uuid NOT NULL,
	"bucket" text NOT NULL,
	"day" date NOT NULL,
	"value_pence" bigint NOT NULL,
	"cost_pence" bigint NOT NULL,
	"source" text NOT NULL,
	CONSTRAINT "daily_values_user_id_bucket_day_pk" PRIMARY KEY("user_id","bucket","day")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "holdings" (
	"credential_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"instrument_id" text NOT NULL,
	"quantity" numeric NOT NULL,
	"average_price_paid" numeric NOT NULL,
	"total_cost_pence" bigint NOT NULL,
	"polled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "holdings_credential_id_instrument_id_pk" PRIMARY KEY("credential_id","instrument_id")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "instruments" (
	"id" text PRIMARY KEY NOT NULL,
	"isin" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"currency" text NOT NULL,
	"type" text NOT NULL,
	"working_schedule_id" integer,
	"yahoo_symbol" text,
	"alpha_vantage_symbol" text,
	"symbols_overridden" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "intraday_series" (
	"key" text PRIMARY KEY NOT NULL,
	"points" jsonb NOT NULL,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "prices" (
	"key" text PRIMARY KEY NOT NULL,
	"price" numeric NOT NULL,
	"previous_close" numeric,
	"currency" text NOT NULL,
	"source" text NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_failed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "provider_credentials" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_kind" text NOT NULL,
	"sealed_key" text NOT NULL,
	"sealed_secret" text NOT NULL,
	"key_version" integer NOT NULL,
	"status" text NOT NULL,
	"account_currency" text NOT NULL,
	"last_verified_at" timestamp with time zone,
	"last_polled_at" timestamp with time zone,
	"backfill_status" text DEFAULT 'pending' NOT NULL,
	"history_starts_on" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_credentials_user_id_provider_account_kind_unique" UNIQUE("user_id","provider","account_kind")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "source_usage" (
	"source" text NOT NULL,
	"day" date NOT NULL,
	"calls" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "source_usage_source_day_pk" PRIMARY KEY("source","day")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "trades" (
	"credential_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"fill_id" text NOT NULL,
	"instrument_id" text NOT NULL,
	"side" text NOT NULL,
	"quantity" numeric NOT NULL,
	"price" numeric NOT NULL,
	"net_value_pence" bigint NOT NULL,
	"fees_pence" bigint NOT NULL,
	"filled_at" timestamp with time zone NOT NULL,
	CONSTRAINT "trades_credential_id_fill_id_pk" PRIMARY KEY("credential_id","fill_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash" ADD CONSTRAINT "cash_credential_id_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "cash" ADD CONSTRAINT "cash_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "daily_values" ADD CONSTRAINT "daily_values_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holdings" ADD CONSTRAINT "holdings_credential_id_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holdings" ADD CONSTRAINT "holdings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "holdings" ADD CONSTRAINT "holdings_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "provider_credentials" ADD CONSTRAINT "provider_credentials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trades" ADD CONSTRAINT "trades_credential_id_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
