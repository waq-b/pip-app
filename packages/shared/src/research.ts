/**
 * Phase 5: the trust rules a user sets and the profile Pip writes for. Defaults
 * and limits live here so the API (which enforces them), the database (whose
 * CHECKs mirror them) and the web app (which shows them) can't disagree.
 */

import type { Bucket } from "./buckets.js";

// ─── Trust rules ──────────────────────────────────────────────────────────────

/** Whole numbers throughout; percentages are whole percent. */
export interface TrustSettings {
  /** Publisher domains whose reports count at all (`reuters.com`). */
  namedPublishers: string[];
  /** News older than this many days is ignored by the weekly build. */
  recencyDays: number;
  /** A news nudge needs reports from at least this many different publishers. */
  minSources: number;
  /** No news nudge on a holding this many days either side of its results date. */
  resultsQuietDays: number;
  /** Awareness nudges shown in one week's build. */
  weeklyBudget: number;
  /** Daily nudges, per day and per week. */
  dailyBudgetPerDay: number;
  dailyBudgetPerWeek: number;
  /** A one-day move at or past this is a big move, per pot. */
  bigMovePercent: Record<Bucket, number>;
}

export const DEFAULT_NAMED_PUBLISHERS: readonly string[] = [
  "reuters.com",
  "bloomberg.com",
  "ft.com",
  "wsj.com",
  "cnbc.com",
  "marketwatch.com",
  "bbc.co.uk",
  "bbc.com",
  "theguardian.com",
  "thetimes.com",
  "finance.yahoo.com",
  "uk.finance.yahoo.com",
  "proactiveinvestors.co.uk",
  "sharecast.com",
  "investing.com",
  "coindesk.com",
  "cointelegraph.com",
  "theblock.co",
  "decrypt.co",
];

export const DEFAULT_TRUST_SETTINGS: TrustSettings = {
  namedPublishers: [...DEFAULT_NAMED_PUBLISHERS],
  recencyDays: 7,
  minSources: 2,
  resultsQuietDays: 3,
  weeklyBudget: 4,
  dailyBudgetPerDay: 1,
  dailyBudgetPerWeek: 3,
  bigMovePercent: { Base: 3, Medium: 7, Degen: 15 },
};

/** Inclusive limits the API refuses outside of. */
export const TRUST_LIMITS = {
  recencyDays: { min: 1, max: 14 },
  minSources: { min: 1, max: 5 },
  resultsQuietDays: { min: 0, max: 7 },
  weeklyBudget: { min: 1, max: 8 },
  dailyBudgetPerDay: { min: 0, max: 3 },
  dailyBudgetPerWeek: { min: 0, max: 7 },
  bigMovePercent: { min: 1, max: 50 },
  namedPublishers: { min: 1, max: 100 },
} as const;

/** The daily build's recency window. Not a setting. */
export const DAILY_RECENCY_HOURS = 48;

// ─── Profile ──────────────────────────────────────────────────────────────────

export interface Profile {
  goals: string;
  horizonYears: number | null;
  monthlyInPence: number | null;
  riskWords: string;
  /** Holdings or words Pip never nudges on. */
  exclusions: string[];
}

export const EMPTY_PROFILE: Profile = {
  goals: "",
  horizonYears: null,
  monthlyInPence: null,
  riskWords: "",
  exclusions: [],
};

export const PROFILE_LIMITS = {
  textMax: 280,
  horizonYears: { min: 0, max: 60 },
  exclusionsMax: 20,
  exclusionMaxLength: 60,
} as const;

// ─── Nudges ───────────────────────────────────────────────────────────────────

export const NUDGE_KINDS = ["none", "shape", "calendar", "awareness"] as const;
export type NudgeKind = (typeof NUDGE_KINDS)[number];

/** Why a nudge exists, within its kind. */
export const NUDGE_REASONS = {
  none: ["quiet"],
  shape: ["cap", "drift"],
  calendar: ["earnings", "isa_year_end", "net_assets_review"],
  awareness: ["news", "move"],
} as const satisfies Record<NudgeKind, readonly string[]>;
export type NudgeReason = (typeof NUDGE_REASONS)[NudgeKind][number];

export const NUDGE_CADENCES = ["weekly", "daily"] as const;
export type NudgeCadence = (typeof NUDGE_CADENCES)[number];

export const NUDGE_RESPONSES = ["nothing", "acted", "dismissed"] as const;
export type NudgeResponse = (typeof NUDGE_RESPONSES)[number];
