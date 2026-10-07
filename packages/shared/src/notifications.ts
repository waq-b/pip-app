/**
 * Phase 6: what Pip may send, what Side Bet's limit is measured against, and
 * what a recommendation may say. Deterministic code owns every one of these
 * numbers — the writer only puts words around them (design rule 2).
 */

// ─── What Pip sends ───────────────────────────────────────────────────────────

/**
 * A push Pip can send. `limit` is Side Bet nearing or reaching its limit,
 * `urgent` an urgent note or a pushed recommendation, `digest` the week being
 * ready. Ops alerts aren't here: the freshness check inside the database emails
 * the owner, because Pip may be asleep on purpose.
 */
export const PUSH_KINDS = ["limit", "urgent", "digest"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];

/** What a row in the bell can be. */
export const NOTIFICATION_ITEM_KINDS = ["nudge", "limit_alert", "connection_gap"] as const;
export type NotificationItemKind = (typeof NOTIFICATION_ITEM_KINDS)[number];

export interface NotificationSettings {
  /** The master switch: off means no pushes at all, whatever the rest say. */
  push: boolean;
  pushLimit: boolean;
  pushUrgent: boolean;
  pushDigest: boolean;
  /** The Monday email. */
  email: boolean;
}

/** Everything on. Nothing is sent until a device subscribes anyway. */
export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  push: true,
  pushLimit: true,
  pushUrgent: true,
  pushDigest: true,
  email: true,
};

/** A provider hasn't synced for this long → a bell row, never a push. */
export const CONNECTION_GAP_HOURS = 3;

/** How many days of notifications the bell shows. */
export const NOTIFICATION_HISTORY_DAYS = 30;

// ─── Side Bet's limit ─────────────────────────────────────────────────────────

/** The FCA's guide for high-risk investments: no more than 10% of net assets. */
export const SIDE_BET_LIMIT_SHARE = 0.1;

/** Until net assets are set, Side Bet is held to a flat starter limit. */
export const SIDE_BET_STARTER_LIMIT_PENCE = 35_000;

/** Pip asks for net assets again a year after they were last reviewed. */
export const NET_ASSETS_REVIEW_MONTHS = 12;

/** Money in, less taken out, is counted over this window. */
export const LIMIT_WINDOW_MONTHS = 12;

/** An alert at 80% of the limit, and again when it's reached. */
export const LIMIT_ALERT_SHARES = [0.8, 1] as const;

/** Under an alerted threshold by this much, the threshold can alert again. */
export const LIMIT_REARM_PENCE = 2_500;

// ─── Recommendations (design rule 9, personal_research users only) ─────────────

/** What Pip may recommend. Code picks it; the writer only explains it. */
export const RECOMMENDATIONS = ["hold", "take_some_profit", "rebalance"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];

/**
 * Why a recommendation exists:
 * - `side_bet_over_limit` — Side Bet's value past 10% of net assets (R1)
 * - `holding_multiple` — a holding worth 3× what went into it (R2)
 * - `pot_off_target` — Handpicked over, or Foundation under, its target (R3)
 * - `urgent_move` — a holding past the urgent move line (R4)
 */
export const RECOMMENDATION_TRIGGERS = [
  "side_bet_over_limit",
  "holding_multiple",
  "pot_off_target",
  "urgent_move",
] as const;
export type RecommendationTrigger = (typeof RECOMMENDATION_TRIGGERS)[number];

/**
 * A trigger's state machine, which is how one crossing makes one brief.
 * `pending` and `pending_clear` are a condition seen once, waiting for the next
 * refresh to confirm it (the calmer rule).
 */
export const RECOMMENDATION_STATES = ["clear", "pending", "fired", "pending_clear"] as const;
export type RecommendationState = (typeof RECOMMENDATION_STATES)[number];

/** R1: past the limit by this share of net assets, in points, before it counts. */
export const R1_MARGIN_POINTS = 0.5;
/** R2: a holding worth this many times its cost, and re-armed under the lower one. */
export const HOLDING_MULTIPLE = 3;
export const HOLDING_REARM_MULTIPLE = 2.5;
/** R3: points off target before it counts, and within this many to re-arm. */
export const R3_DRIFT_POINTS = 5;
export const R3_REARM_POINTS = 2;
/** R4: the urgent move line is this many times the pot's own big-move line. */
export const URGENT_MOVE_MULTIPLIER = 2;
/** Urgent news: this many independent named publishers on one holding… */
export const URGENT_NEWS_MIN_SOURCES = 3;
/** …within this many hours. */
export const URGENT_NEWS_WINDOW_HOURS = 24;

/** Two refreshes confirm a condition only if they're this far apart. */
export const CONFIRM_MIN_GAP_MS = 20 * 60 * 1000;

/** At most this many urgent pushes a day, per user. Limit alerts don't count. */
export const URGENT_PUSH_DAILY_MAX = 2;

// ─── Jobs ─────────────────────────────────────────────────────────────────────

/**
 * What records a run in `job_runs`. `refresh` is the whole scheduled run;
 * the rest are its steps, so freshness can be judged per kind of work rather
 * than per run.
 */
export const JOB_NAMES = [
  "refresh",
  "poll",
  "prices",
  "facts",
  "weekly_build",
  "daily_build",
  "outcomes",
] as const;
export type JobName = (typeof JOB_NAMES)[number];

/**
 * How stale each kind of work may get before the freshness check inside
 * Supabase emails the owner. Pip is allowed to sleep, so nothing pings the API —
 * these are judged from the rows the jobs themselves wrote.
 */
export const STALE_REFRESH_MINUTES = 75;
/** The Monday build should have happened by this hour, London. */
export const WEEKLY_BUILD_BY_HOUR = 9;
/** Job runs are kept this long, then cleaned up by the job itself. */
export const JOB_RUNS_KEPT_DAYS = 30;
