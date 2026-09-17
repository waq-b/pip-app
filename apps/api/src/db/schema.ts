import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
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
  /**
   * Personalised research (Phase 5): nudges written for this person's own plan.
   * Off by default — everyone else gets general notes (hard line 12). Set only
   * with the allowlist CLI, never through the API.
   */
  personalResearch: boolean("personal_research").notNull().default(false),
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
    /** `trading212` (Phase 2) or `kraken` (Phase 3). */
    provider: text("provider").notNull(),
    /** `isa` → Foundation, `invest` → Handpicked (asked in Setup; T212 can't tell us); `spot` → Side Bet (Kraken). */
    accountKind: text("account_kind").notNull(),
    sealedKey: text("sealed_key").notNull(),
    sealedSecret: text("sealed_secret").notNull(),
    /** Master key version that sealed them — what a rotation looks for. */
    keyVersion: integer("key_version").notNull(),
    /** `live` · `invalid` (rejected by the provider) · `error` (last call failed). */
    status: text("status").notNull(),
    accountCurrency: text("account_currency").notNull(),
    /**
     * The provider's own account id (Trading 212's summary `id`), so one account
     * can't feed two pots (hard line 11). Filled on connect and on every poll.
     */
    providerAccountId: text("provider_account_id"),
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
  /** Crypto (`type` `CRYPTO`): CoinGecko coin id, e.g. `bitcoin`. */
  coingeckoId: text("coingecko_id"),
  /** Crypto: Kraken public pair quoted in pounds, e.g. `XBTGBP`, when one exists. */
  krakenPair: text("kraken_pair"),
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
    /** In instrument currency, as T212 states it. Null when the provider doesn't say (Kraken). */
    averagePricePaid: numeric("average_price_paid"),
    /**
     * What was paid, in pence of pounds — a fact about the purchase, not a price.
     * Null until it's known: Kraken's comes from the rebuilt ledger history.
     */
    totalCostPence: bigint("total_cost_pence", { mode: "number" }),
    /** Part of `quantity` that is staked or earning rewards (Kraken `.S`, `.F`, `.B`…). */
    stakedQuantity: numeric("staked_quantity"),
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
 * Kraken ledger entries — every change to every asset balance, with the balance
 * after it. Kept so history can be rebuilt and cost worked out without reading
 * the whole ledger again; keyed by Kraken's entry id so a re-read never doubles.
 */
export const krakenLedger = pgTable(
  "kraken_ledger",
  {
    credentialId: uuid("credential_id")
      .notNull()
      .references(() => providerCredentials.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entryId: text("entry_id").notNull(),
    refid: text("refid").notNull(),
    at: timestamp("at", { withTimezone: true }).notNull(),
    type: text("type").notNull(),
    subtype: text("subtype").notNull(),
    /** Kraken's asset name as written in the ledger (`XXBT`, `DOT.S`). */
    asset: text("asset").notNull(),
    amount: numeric("amount").notNull(),
    fee: numeric("fee").notNull(),
    balance: numeric("balance").notNull(),
  },
  (table) => [primaryKey({ columns: [table.credentialId, table.entryId] })],
);

/**
 * The shape a user has set (Phase 4): Handpicked's target and Side Bet's cap in
 * whole percent; Foundation is the rest. No row means the defaults. The limits
 * are checked by the API and again here.
 */
export const userRules = pgTable(
  "user_rules",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    handpickedTarget: integer("handpicked_target").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Side Bet left the shape in Phase 6: it has a limit in pounds (`net_assets`,
  // `limit_alerts`), so Foundation is simply the rest of Handpicked's target.
  (table) => [check("user_rules_target_range", sql`${table.handpickedTarget} between 0 and 100`)],
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

// ─── Phase 5: research ────────────────────────────────────────────────────────
//
// Facts are shared, like prices: one fetch per holding for everyone, written by
// the server, readable when signed in. Profiles, trust settings, weeks and
// nudges are the user's own.
//
// The limits and allowed values below are copies of the constants in
// `@finance-app/shared` (drizzle-kit can't load the shared package's source).
// `research-schema.test.ts` fails if they ever differ.

export const DB_BUCKETS = ["Base", "Medium", "Degen"] as const;
export const DB_NUDGE_CADENCES = ["weekly", "daily"] as const;
export const DB_NUDGE_KINDS = ["none", "shape", "calendar", "awareness"] as const;
export const DB_NUDGE_REASONS = {
  none: ["quiet"],
  shape: ["cap", "drift"],
  calendar: ["earnings", "isa_year_end"],
  awareness: ["news", "move"],
} as const;
export const DB_NUDGE_RESPONSES = ["nothing", "acted", "dismissed"] as const;
export const DB_PROFILE_LIMITS = {
  textMax: 280,
  horizonYears: { min: 0, max: 60 },
  exclusionsMax: 20,
} as const;
export const DB_TRUST_LIMITS = {
  recencyDays: { min: 1, max: 14 },
  minSources: { min: 1, max: 5 },
  resultsQuietDays: { min: 0, max: 7 },
  weeklyBudget: { min: 1, max: 8 },
  dailyBudgetPerDay: { min: 0, max: 3 },
  dailyBudgetPerWeek: { min: 0, max: 7 },
  bigMovePercent: { min: 1, max: 50 },
  namedPublishers: { min: 1, max: 100 },
} as const;

/** `column between min and max`, with the numbers from the shared limits. */
function within(column: SQL | object, limits: { min: number; max: number }): SQL {
  return sql`${column} between ${sql.raw(String(limits.min))} and ${sql.raw(String(limits.max))}`;
}

/** `column in ('a', 'b')` from a shared list of values. */
function oneOf(column: object, values: readonly string[]): SQL {
  return sql`${column} in (${sql.raw(values.map((value) => `'${value}'`).join(", "))})`;
}

/**
 * A news report, from any source (Google News, Alpha Vantage, Marketaux, RSS).
 * Keyed by a hash of its link, so the same report reached through two sources
 * is stored once. Only the headline and the source's own short summary are
 * kept; the article itself is linked, never copied.
 */
export const factsNews = pgTable(
  "facts_news",
  {
    /** sha-256 of the canonical url, hex. */
    id: text("id").primaryKey(),
    /** Which adapter found it first: `google-news`, `alpha-vantage`, `marketaux`, `rss:<feed>`, `stub`. */
    source: text("source").notNull(),
    /** As the source names it: "Reuters". */
    publisher: text("publisher").notNull(),
    /** What trust rules match on: `reuters.com`. */
    publisherDomain: text("publisher_domain").notNull(),
    headline: text("headline").notNull(),
    snippet: text("snippet"),
    url: text("url").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }).notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("facts_news_headline_length", sql`char_length(${table.headline}) <= 300`),
    check("facts_news_snippet_length", sql`char_length(${table.snippet}) <= 400`),
  ],
);

/** Which holdings a report is about. One report can be about several; an unmatched one is about none. */
export const factsNewsInstruments = pgTable(
  "facts_news_instruments",
  {
    newsId: text("news_id")
      .notNull()
      .references(() => factsNews.id, { onDelete: "cascade" }),
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
  },
  (table) => [primaryKey({ columns: [table.newsId, table.instrumentId] })],
);

/** Dated facts about a holding — results dates. (ISA year-end is computed, not stored.) */
export const factsEvents = pgTable(
  "facts_events",
  {
    instrumentId: text("instrument_id")
      .notNull()
      .references(() => instruments.id),
    kind: text("kind").notNull(),
    onDate: date("on_date").notNull(),
    /** Source-specific extras: time of day, estimate. */
    detail: jsonb("detail").notNull().default({}),
    source: text("source").notNull(),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.instrumentId, table.kind, table.onDate] }),
    check("facts_events_kind", oneOf(table.kind, ["earnings"])),
  ],
);

/**
 * When each fact source was last read for each target (an instrument id, or a
 * feed name for general RSS), so the collector knows what's due. Server-only,
 * like `source_usage`, which still counts the calls.
 */
export const factsFetches = pgTable(
  "facts_fetches",
  {
    source: text("source").notNull(),
    /** `news` or `events`. */
    kind: text("kind").notNull(),
    target: text("target").notNull(),
    lastFetchedAt: timestamp("last_fetched_at", { withTimezone: true }),
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
  },
  (table) => [primaryKey({ columns: [table.source, table.kind, table.target] })],
);

/** What a user tells Pip about their plan. No row means an empty profile. */
export const userProfiles = pgTable(
  "user_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    goals: text("goals").notNull().default(""),
    horizonYears: integer("horizon_years"),
    monthlyInPence: bigint("monthly_in_pence", { mode: "number" }),
    riskWords: text("risk_words").notNull().default(""),
    exclusions: text("exclusions")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "user_profiles_goals_length",
      sql`char_length(${table.goals}) <= ${sql.raw(String(DB_PROFILE_LIMITS.textMax))}`,
    ),
    check(
      "user_profiles_risk_length",
      sql`char_length(${table.riskWords}) <= ${sql.raw(String(DB_PROFILE_LIMITS.textMax))}`,
    ),
    check("user_profiles_horizon", within(table.horizonYears, DB_PROFILE_LIMITS.horizonYears)),
    check("user_profiles_monthly_in", sql`${table.monthlyInPence} >= 0`),
    check(
      "user_profiles_exclusions_count",
      sql`cardinality(${table.exclusions}) <= ${sql.raw(String(DB_PROFILE_LIMITS.exclusionsMax))}`,
    ),
  ],
);

/** A user's trust rules. No row means `DEFAULT_TRUST_SETTINGS`. */
export const trustSettings = pgTable(
  "trust_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    namedPublishers: text("named_publishers").array().notNull(),
    recencyDays: integer("recency_days").notNull(),
    minSources: integer("min_sources").notNull(),
    resultsQuietDays: integer("results_quiet_days").notNull(),
    weeklyBudget: integer("weekly_budget").notNull(),
    dailyBudgetPerDay: integer("daily_budget_per_day").notNull(),
    dailyBudgetPerWeek: integer("daily_budget_per_week").notNull(),
    bigMoveBase: integer("big_move_base").notNull(),
    bigMoveMedium: integer("big_move_medium").notNull(),
    bigMoveDegen: integer("big_move_degen").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "trust_settings_publishers",
      within(sql`cardinality(${table.namedPublishers})`, DB_TRUST_LIMITS.namedPublishers),
    ),
    check("trust_settings_recency", within(table.recencyDays, DB_TRUST_LIMITS.recencyDays)),
    check("trust_settings_min_sources", within(table.minSources, DB_TRUST_LIMITS.minSources)),
    check("trust_settings_quiet", within(table.resultsQuietDays, DB_TRUST_LIMITS.resultsQuietDays)),
    check("trust_settings_weekly", within(table.weeklyBudget, DB_TRUST_LIMITS.weeklyBudget)),
    check(
      "trust_settings_daily",
      within(table.dailyBudgetPerDay, DB_TRUST_LIMITS.dailyBudgetPerDay),
    ),
    check(
      "trust_settings_daily_week",
      within(table.dailyBudgetPerWeek, DB_TRUST_LIMITS.dailyBudgetPerWeek),
    ),
    check("trust_settings_move_base", within(table.bigMoveBase, DB_TRUST_LIMITS.bigMovePercent)),
    check(
      "trust_settings_move_medium",
      within(table.bigMoveMedium, DB_TRUST_LIMITS.bigMovePercent),
    ),
    check("trust_settings_move_degen", within(table.bigMoveDegen, DB_TRUST_LIMITS.bigMovePercent)),
  ],
);

/** One user's week: built once, on the Monday. */
export const digests = pgTable(
  "digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The Monday the week starts. */
    weekOf: date("week_of").notNull(),
    /** The week's opening sentence. */
    opening: text("opening").notNull(),
    /** What the build looked at: holdings checked, reports read, held back by which rule. */
    counts: jsonb("counts").notNull(),
    builtAt: timestamp("built_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique().on(table.userId, table.weekOf),
    check("digests_week_of_monday", sql`extract(isodow from ${table.weekOf}) = 1`),
  ],
);

export const DB_PUSH_KINDS = ["limit", "urgent", "digest"] as const;
export const DB_NOTIFICATION_ITEM_KINDS = ["nudge", "limit_alert", "connection_gap"] as const;
export const DB_RECOMMENDATIONS = ["hold", "take_some_profit", "rebalance"] as const;
export const DB_RECOMMENDATION_TRIGGERS = [
  "side_bet_over_limit",
  "holding_multiple",
  "pot_off_target",
  "urgent_move",
] as const;
export const DB_RECOMMENDATION_STATES = ["clear", "pending", "fired", "pending_clear"] as const;
export const DB_JOB_NAMES = ["refresh"] as const;
export const DB_PROVIDERS = ["trading212", "kraken"] as const;

/**
 * The nudge log — every nudge Pip built, shown or held back, with everything it
 * was built from, what the user did about it, and what happened after. The
 * thing that tells us, months on, which kinds of nudge earned trust.
 */
export const nudges = pgTable(
  "nudges",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Null for a daily nudge. */
    digestId: uuid("digest_id").references(() => digests.id, { onDelete: "cascade" }),
    cadence: text("cadence").notNull(),
    kind: text("kind").notNull(),
    reason: text("reason").notNull(),
    /** Internal bucket id, when the nudge is about one pot. */
    bucket: text("bucket"),
    instrumentId: text("instrument_id").references(() => instruments.id),

    title: text("title").notNull(),
    body: text("body").notNull(),
    /** "Based on 3 sources over 2 days". */
    basis: text("basis"),

    /** A frozen copy of every fact row and figure it was built from. */
    facts: jsonb("facts").notNull(),
    /** `[{ rule, setting, passed, detail }]` — every trust rule it was checked against. */
    checks: jsonb("checks").notNull(),
    /** False when a trust rule held it back. */
    shown: boolean("shown").notNull(),
    /** `groq:openai/gpt-oss-120b`, `template` or `stub`. */
    model: text("model").notNull(),
    promptVersion: text("prompt_version"),
    personalised: boolean("personalised").notNull(),
    /**
     * The same nudge has the same key (`reason:subject:day-or-date`), so a daily
     * run every half hour logs each nudge once a day and never repeats one shown.
     */
    dedupeKey: text("dedupe_key").notNull(),
    /** The London day the build ran. */
    builtOn: date("built_on").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),

    /** Phase 6: past the urgent line, so it pushes rather than waiting for the week. */
    urgent: boolean("urgent").notNull().default(false),
    /**
     * Phase 6, `personal_research` users only (hard line 12): the course Pip
     * recommends, chosen by code — the writer only explains it.
     */
    recommendation: text("recommendation"),
    /** Which trigger produced the recommendation. */
    trigger: text("trigger"),

    response: text("response"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),

    /** Price of the holding when the nudge was built, in `price_currency`. */
    priceAt: numeric("price_at"),
    priceCurrency: text("price_currency"),
    priceSource: text("price_source"),
    /** Pence of pounds per unit 7 days on (`nudges/outcomes.ts`). `price_7d_at` marks the outcome done. */
    price7d: numeric("price_7d"),
    price7dAt: timestamp("price_7d_at", { withTimezone: true }),
    price30d: numeric("price_30d"),
    price30dAt: timestamp("price_30d_at", { withTimezone: true }),
    /** For shape nudges: the pot's share of everything, in percent. */
    potShareAt: numeric("pot_share_at"),
    potShare7d: numeric("pot_share_7d"),
    potShare30d: numeric("pot_share_30d"),
  },
  (table) => [
    unique("nudges_once_a_day").on(table.userId, table.cadence, table.dedupeKey, table.builtOn),
    check("nudges_cadence", oneOf(table.cadence, DB_NUDGE_CADENCES)),
    check(
      "nudges_kind_reason",
      sql.raw(
        "(" +
          Object.entries(DB_NUDGE_REASONS)
            .map(
              ([kind, reasons]) =>
                `("kind" = '${kind}' and "reason" in (${reasons.map((r) => `'${r}'`).join(", ")}))`,
            )
            .join(" or ") +
          ")",
      ),
    ),
    check("nudges_kind", oneOf(table.kind, DB_NUDGE_KINDS)),
    check("nudges_bucket", oneOf(table.bucket, DB_BUCKETS)),
    check("nudges_response", oneOf(table.response, DB_NUDGE_RESPONSES)),
    check("nudges_recommendation", oneOf(table.recommendation, DB_RECOMMENDATIONS)),
    check("nudges_trigger", oneOf(table.trigger, DB_RECOMMENDATION_TRIGGERS)),
    check(
      "nudges_recommendation_has_a_trigger",
      sql`(${table.recommendation} is null) = (${table.trigger} is null)`,
    ),
    check(
      "nudges_weekly_in_a_week",
      sql`(${table.cadence} = 'weekly') = (${table.digestId} is not null)`,
    ),
  ],
);

// ─── Phase 6: notifications, Side Bet's limit, recommendations, jobs ──────────
//
// Copies of the constants in `@finance-app/shared` again (drizzle-kit can't
// load the shared package's source); `notifications-schema.test.ts` fails if
// they ever differ.
//
// Who may read what: the settings, the read marks, the alerts and the
// connection gaps are the user's own. A device's push keys and the sealed net
// assets are never granted to anyone signed in — the API reads them, and only
// in memory. Deliveries, trigger state and job runs are the server's own
// bookkeeping.

/**
 * One browser on one device, subscribed to push. Several per user: a phone, a
 * tablet, a computer. The endpoint is the push service's own address for that
 * device, and the keys encrypt the payload to it — so the whole row is what
 * lets anyone push to that device, and none of it is granted to the browser.
 */
export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** The push service's URL for this device. Unique across everyone. */
    endpoint: text("endpoint").notNull().unique(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    /** "iPhone", "Android tablet", "Mac" — worked out from the user agent, for the device row. */
    label: text("label").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastDeliveredAt: timestamp("last_delivered_at", { withTimezone: true }),
    /** A 404 or 410 from the push service deletes the row; anything else is recorded here. */
    lastFailedAt: timestamp("last_failed_at", { withTimezone: true }),
  },
  (table) => [check("push_subscriptions_https", sql`${table.endpoint} like 'https://%'`)],
);

/** What a user wants sent. No row means the defaults, which are everything on. */
export const notificationSettings = pgTable("notification_settings", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** The master switch. Off means nothing is pushed, whatever the three below say. */
  push: boolean("push").notNull().default(true),
  pushLimit: boolean("push_limit").notNull().default(true),
  pushUrgent: boolean("push_urgent").notNull().default(true),
  pushDigest: boolean("push_digest").notNull().default(true),
  email: boolean("email").notNull().default(true),
  /** When the first-login sheet was answered. Set once; it's never asked twice. */
  askedAt: timestamp("asked_at", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Every push Pip sent. The unique key is what makes one event one push, even if
 * two job runs overlap: the sender writes the row first and gives up if it's
 * already there.
 */
export const pushDeliveries = pgTable(
  "push_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    /** The event this push is about: `limit:80:<window>`, `urgent:<nudge id>`, `digest:<Monday>`. */
    dedupeKey: text("dedupe_key").notNull(),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
    devicesTried: integer("devices_tried").notNull().default(0),
    devicesDelivered: integer("devices_delivered").notNull().default(0),
    /** The London day it was sent, for the urgent budget. */
    sentOn: date("sent_on").notNull(),
  },
  (table) => [
    unique("push_deliveries_once_per_event").on(table.userId, table.kind, table.dedupeKey),
    check("push_deliveries_kind", oneOf(table.kind, DB_PUSH_KINDS)),
  ],
);

/** What the user has read in the bell. Absent means unread. */
export const notificationReads = pgTable(
  "notification_reads",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    itemKind: text("item_kind").notNull(),
    /** The nudge, alert or gap row's id. */
    itemId: uuid("item_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.itemKind, table.itemId] }),
    check("notification_reads_item_kind", oneOf(table.itemKind, DB_NOTIFICATION_ITEM_KINDS)),
  ],
);

/**
 * A provider that went quiet: shown in the bell, never pushed. Open while
 * `ended_at` is null, closed by the refresh job when the provider syncs again.
 */
export const connectionGaps = pgTable(
  "connection_gaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
  },
  (table) => [
    check("connection_gaps_provider", oneOf(table.provider, DB_PROVIDERS)),
    check(
      "connection_gaps_ends_after_it_starts",
      sql`${table.endedAt} is null or ${table.endedAt} >= ${table.startedAt}`,
    ),
  ],
);

/**
 * The user's net assets, sealed like a provider key and decrypted only in
 * memory when Pip needs the limit (hard line 6). It sets Side Bet's limit at
 * the FCA's 10% guide and is used for nothing else. The browser may read when
 * it was last reviewed, never the figure.
 */
export const netAssets = pgTable("net_assets", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  /** Whole pounds, sealed by `crypto/secrets.ts`. */
  sealedAmount: text("sealed_amount").notNull(),
  masterKeyVersion: integer("master_key_version").notNull(),
  /** Set whenever the figure is entered again; Pip asks for a check a year on. */
  reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Side Bet's limit alerts: 80% of the limit, then reaching it, each once per
 * 12-month window. Written by the refresh job from money in, less taken out —
 * which only moves when money moves, so there's nothing to flicker.
 */
export const limitAlerts = pgTable(
  "limit_alerts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** 80 or 100, in percent of the limit. */
    threshold: integer("threshold").notNull(),
    /** The start of the 12-month window this alert belongs to. */
    windowStart: date("window_start").notNull(),
    alertedAt: timestamp("alerted_at", { withTimezone: true }).notNull().defaultNow(),
    /** What it was built from, so the bell row can say it in pounds. */
    moneyInPence: bigint("money_in_pence", { mode: "number" }).notNull(),
    limitPence: bigint("limit_pence", { mode: "number" }).notNull(),
    /** True while net assets are unset and the £350 starter limit applies. */
    starterLimit: boolean("starter_limit").notNull(),
  },
  (table) => [
    unique("limit_alerts_once_per_window").on(table.userId, table.threshold, table.windowStart),
    check("limit_alerts_threshold", sql`${table.threshold} in (80, 100)`),
    check("limit_alerts_money_in", sql`${table.moneyInPence} >= 0`),
    check("limit_alerts_limit", sql`${table.limitPence} > 0`),
  ],
);

/**
 * Where each recommendation trigger stands for one subject (a pot, a holding),
 * so one crossing makes one brief. `pending` is a condition seen once, waiting
 * for the next refresh to confirm it — the calmer rule, which R1 needs because
 * it's measured on value.
 */
export const recommendationState = pgTable(
  "recommendation_state",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    trigger: text("trigger").notNull(),
    /** The bucket or instrument the trigger is about; `-` when it's about everything. */
    subject: text("subject").notNull(),
    state: text("state").notNull(),
    /** New on each confirmed crossing, and what the push is keyed by. */
    eventId: uuid("event_id"),
    /** When the current state began. */
    since: timestamp("since", { withTimezone: true }).notNull().defaultNow(),
    lastCheckedAt: timestamp("last_checked_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.trigger, table.subject] }),
    check("recommendation_state_trigger", oneOf(table.trigger, DB_RECOMMENDATION_TRIGGERS)),
    check("recommendation_state_state", oneOf(table.state, DB_RECOMMENDATION_STATES)),
    check(
      "recommendation_state_event_when_fired",
      sql`(${table.state} in ('fired', 'pending_clear')) = (${table.eventId} is not null)`,
    ),
  ],
);

/**
 * One run of a scheduled job: what it did, what failed, how long it took. The
 * jobs health check reads the last one, and Setup shows its age. Server-only —
 * `GET /status` says how long ago, never why.
 */
export const jobRuns = pgTable(
  "job_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    job: text("job").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    /** Per-step counts and timings. */
    summary: jsonb("summary")
      .notNull()
      .default(sql`'{}'::jsonb`),
    /** The steps that failed, by name. Empty is a clean run. */
    errorSteps: text("error_steps")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
  },
  (table) => [
    check("job_runs_job", oneOf(table.job, DB_JOB_NAMES)),
    check(
      "job_runs_finishes_after_it_starts",
      sql`${table.finishedAt} is null or ${table.finishedAt} >= ${table.startedAt}`,
    ),
  ],
);
