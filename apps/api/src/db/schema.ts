import {
  bigint,
  boolean,
  date,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The allowlist, and the only record of who may use Pip (CLAUDE.md s3).
 *
 * Supabase Auth proves who someone is; a row here is what lets them in. Rows are
 * added by hand, keyed by email, before the person ever signs in.
 * `auth_user_id` links the row to Supabase's `auth.users` the first time they
 * do — a plain uuid column rather than a foreign key, so our migrations never
 * reach into the `auth` schema Supabase owns.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  authUserId: uuid("auth_user_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Someone who signed in and wasn't on the allowlist. The email comes from their
 * verified Supabase token, never from anything they typed. Being here grants
 * nothing.
 */
export const waitlist = pgTable("waitlist", {
  email: text("email").primaryKey(),
  name: text("name"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
});

// ─── Phase 2: provider data ───────────────────────────────────────────────────
//
// Money in pence of pounds is `bigint` (mode number — pence totals stay far
// inside 2^53). Prices and quantities from providers keep their full precision
// as `numeric`, read as strings, and are only turned into pence at the edge.
//
// Every table has RLS on (see drizzle/). User-owned tables carry `user_id` so a
// policy can limit them to the signed-in user; shared market data is readable
// by any signed-in user and written only by the server.

/**
 * A user's key + secret for one provider account. Both halves are sealed by
 * `crypto/secrets.ts` and never leave Fastify unsealed. Signed-in users can
 * read the status columns of their own rows, never the sealed ones (column
 * grants in the migration); all writes go through the server.
 */
export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** `trading212` in Phase 2. */
    provider: text("provider").notNull(),
    /** `isa` → Foundation, `invest` → Handpicked. Asked in Setup; T212 can't tell us. */
    accountKind: text("account_kind").notNull(),
    sealedKey: text("sealed_key").notNull(),
    sealedSecret: text("sealed_secret").notNull(),
    /** Master key version that sealed them — what a rotation looks for. */
    keyVersion: integer("key_version").notNull(),
    /** `live` · `invalid` (rejected by the provider) · `error` (last call failed). */
    status: text("status").notNull(),
    accountCurrency: text("account_currency").notNull(),
    lastVerifiedAt: timestamp("last_verified_at", { withTimezone: true }),
    lastPolledAt: timestamp("last_polled_at", { withTimezone: true }),
    /** `pending` · `running` · `done` · `partial` · `failed`. */
    backfillStatus: text("backfill_status").notNull().default("pending"),
    /** First day history could be rebuilt from, once backfill has run. */
    historyStartsOn: date("history_starts_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique().on(table.userId, table.provider, table.accountKind)],
);

/**
 * Tradable instruments Pip has met, keyed by the Trading 212 ticker. Not by
 * ISIN: one ISIN can be listed on several exchanges in several currencies
 * (CLAUDE.md s13). Symbols for each market-data source are derived from the
 * ticker, with overrides where that doesn't work.
 */
export const instruments = pgTable("instruments", {
  id: text("id").primaryKey(),
  isin: text("isin").notNull(),
  name: text("name").notNull(),
  shortName: text("short_name").notNull(),
  /** Instrument currency as T212 states it: USD, EUR, GBP, GBX (pence)… */
  currency: text("currency").notNull(),
  type: text("type").notNull(),
  /** T212 working schedule — drives "markets closed". */
  workingScheduleId: integer("working_schedule_id"),
  yahooSymbol: text("yahoo_symbol"),
  alphaVantageSymbol: text("alpha_vantage_symbol"),
  /** True when the symbols above were set by hand and mustn't be re-derived. */
  symbolsOverridden: boolean("symbols_overridden").notNull().default(false),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Latest price per instrument or FX pair, shared by every user — one refresh
 * per instrument, never per user. `key` is an instrument id, or `FX:GBPUSD`.
 */
export const prices = pgTable("prices", {
  key: text("key").primaryKey(),
  price: numeric("price").notNull(),
  previousClose: numeric("previous_close"),
  /** Currency of `price` as the source stated it, normalised (GBX, not GBp). */
  currency: text("currency").notNull(),
  source: text("source").notNull(),
  /** When the source says the price is from. */
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  /** The last refresh attempt failed; `price` is the last good one. */
  lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
});

/** Daily closes per instrument or FX pair — for charts, "this month" and history backfill. */
export const dailyCloses = pgTable(
  "daily_closes",
  {
    key: text("key").notNull(),
    day: date("day").notNull(),
    close: numeric("close").notNull(),
    currency: text("currency").notNull(),
    source: text("source").notNull(),
  },
  (table) => [primaryKey({ columns: [table.key, table.day] })],
);

/** Today's intraday points per instrument, for the "Day" chart. Replaced whole on refresh. */
export const intradaySeries = pgTable("intraday_series", {
  key: text("key").primaryKey(),
  /** `[{ at: ISO timestamp, price: string }]` in `currency`. */
  points: jsonb("points").notNull(),
  currency: text("currency").notNull(),
  source: text("source").notNull(),
  asOf: timestamp("as_of", { withTimezone: true }).notNull(),
});

/** What a credential's account held at its last poll. Replaced per poll. */
export const holdings = pgTable(
  "holdings",
  {
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => providerCredentials.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
    quantity: numeric("quantity").notNull(),
    /** In instrument currency, as T212 states it. */
    averagePricePaid: numeric("average_price_paid").notNull(),
    /** What was paid, in pence of pounds — a fact about the purchase, not a price. */
    totalCostPence: bigint("total_cost_pence", { mode: "number" }).notNull(),
    polledAt: timestamp("polled_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.credentialId, table.instrumentId] })],
);

/** Cash in a credential's account at its last poll, in pence of pounds. */
export const cash = pgTable("cash", {
  credentialId: uuid("credential_id")
    .primaryKey()
    .references(() => providerCredentials.id, { onDelete: "cascade" }),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  availablePence: bigint("available_pence", { mode: "number" }).notNull(),
  reservedPence: bigint("reserved_pence", { mode: "number" }).notNull(),
  inPiesPence: bigint("in_pies_pence", { mode: "number" }).notNull(),
  polledAt: timestamp("polled_at", { withTimezone: true }).notNull(),
});

/**
 * Filled orders read from provider history — the raw material for rebuilding
 * what was held on each past day. Keyed by the provider's fill id, so reading
 * history twice never counts a trade twice.
 */
export const trades = pgTable(
  "trades",
  {
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => providerCredentials.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fillId: text("fill_id").notNull(),
    instrumentId: text("instrument_id").notNull(),
    /** `BUY` or `SELL`. */
    side: text("side").notNull(),
    quantity: numeric("quantity").notNull(),
    /** Fill price in instrument currency. */
    price: numeric("price").notNull(),
    /** Net money in or out of the account, in pence of pounds. */
    netValuePence: bigint("net_value_pence", { mode: "number" }).notNull(),
    feesPence: bigint("fees_pence", { mode: "number" }).notNull(),
    filledAt: timestamp("filled_at", { withTimezone: true }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.credentialId, table.fillId] })],
);

/**
 * One pot's value at the close of each day, per user. Written by history
 * backfill and by the daily snapshot; charts and "this month" read it.
 */
export const dailyValues = pgTable(
  "daily_values",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Internal bucket id: `Base`, `Medium`, `Degen`. */
    bucket: text("bucket").notNull(),
    day: date("day").notNull(),
    valuePence: bigint("value_pence", { mode: "number" }).notNull(),
    costPence: bigint("cost_pence", { mode: "number" }).notNull(),
    /** `backfill` or `snapshot`. A snapshot is never overwritten by backfill. */
    source: text("source").notNull(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.bucket, table.day] })],
);

/**
 * Calls made to each market-data source per day, so a bug can't burn through a
 * free tier (Alpha Vantage: 25/day) or get Pip blocked. Server-only.
 */
export const sourceUsage = pgTable(
  "source_usage",
  {
    source: text("source").notNull(),
    day: date("day").notNull(),
    calls: integer("calls").notNull().default(0),
  },
  (table) => [primaryKey({ columns: [table.source, table.day] })],
);

/**
 * Trading 212 working schedules (open/close events per schedule id), saved when
 * a credential polls instrument metadata. Drives "markets closed" and refresh
 * timing. Shared, readable by signed-in users.
 */
export const marketSchedules = pgTable("market_schedules", {
  scheduleId: integer("schedule_id").primaryKey(),
  exchangeName: text("exchange_name").notNull(),
  /** `[{ date: ISO timestamp, type: "OPEN" | "CLOSE" | … }]` */
  events: jsonb("events").notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
