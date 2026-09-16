/**
 * The shapes apps/api returns and apps/web consumes. Types only — no logic, no
 * formatting, no thresholds. Phase 1 serves all of this from stubs.
 */
import type { Bucket } from "./buckets.js";

/** Money is always integer pence, so nothing rounds on the way through. */
export type Pence = number;

/** Percentage points: `0.23` renders as "0.23%". */
export type Percent = number;

export type Direction = "up" | "down" | "flat";

/**
 * Pounds before percent (DESIGN.md §4.1): every change carries the money, so
 * no screen can show a bare percentage.
 */
export interface Change {
  amount: Pence;
  percent: Percent;
  direction: Direction;
}

/** Home timeframe pills: Today / This month / All time. */
export type Timeframe = "day" | "month" | "all";

/** Instrument chart pills: Day / Month / Year / All. */
export type PriceRange = "day" | "month" | "year" | "all";

/**
 * What the provenance line reads from. `source` names the MARKET DATA source
 * and never a trading API (CLAUDE.md hard line 8). The staleness ladder itself
 * (green / amber / red / markets-closed) is derived in Phase 1 task 21 — this
 * is only the raw material.
 */
export interface PriceFreshness {
  source: string;
  /** ISO timestamp of the last successful price read. */
  asOf: string;
  /** The last fetch failed outright — the ladder goes red, not amber. */
  failed: boolean;
  /** Markets are shut. A Friday close is not stale, it's Friday. */
  marketsClosed: boolean;
}

export interface BucketFreshness {
  bucket: Bucket;
  freshness: PriceFreshness;
}

export interface SeriesPoint {
  /** ISO timestamp. */
  at: string;
  value: Pence;
}

/**
 * Whether a pot has a source. `not_connected`: no account feeds it yet (Side
 * Bet until Kraken arrives). `syncing`: connected, first read or history
 * rebuild still running. Absent means live.
 */
export type BucketStatus = "live" | "not_connected" | "syncing";

/** A pot as it appears on the home screen. */
export interface BucketSummary {
  bucket: Bucket;
  status?: BucketStatus;
  /** True when there isn't enough history to state `change` for the timeframe asked. */
  changeUnavailable?: boolean;
  value: Pence;
  change: Change;
  /** Short line under the pot name. */
  blurb: string;
  shareOfTotal: Percent;
  /** The line the user set: a target for Base/Medium, a hard cap for Degen. */
  targetPercent: Percent;
  series: SeriesPoint[];
}

export interface PortfolioSummary {
  timeframe: Timeframe;
  total: Pence;
  change: Change;
  /** The plain-English verdict: "Up £41 this week. Nothing needs you." */
  verdict: string;
  buckets: BucketSummary[];
  freshness: BucketFreshness[];
  /** True when there isn't enough history to state `change` for the timeframe asked. */
  changeUnavailable?: boolean;
  /** "What changed" isn't built from real accounts yet (Phase 2 decision 4). */
  activityComingSoon?: boolean;
}

export interface Holding {
  id: string;
  name: string;
  /** Plain-English sub-line: "Chips for AI". Replaces a fourth phone column. */
  subtitle: string;
  bucket: Bucket;
  value: Pence;
  today: Change;
  sinceBought: Change;
  /** What was paid isn't known yet (a Kraken coin before its history is rebuilt); `sinceBought` is flat. */
  sinceBoughtUnavailable?: boolean;
  shareOfBucket: Percent;
  series: SeriesPoint[];
  /** False for rows with no page of their own, like cash. Absent means true. */
  linkable?: boolean;
}

/** One bar of "Money in". A zero month is a stub, never a gap. */
export interface MonthlyContribution {
  label: string;
  amount: Pence;
}

export interface BucketDetail {
  bucket: Bucket;
  status?: BucketStatus;
  changeUnavailable?: boolean;
  value: Pence;
  change: Change;
  blurb: string;
  /** The "in plain English" paragraph on the header card. */
  plain: string;
  chart: {
    from: string;
    series: SeriesPoint[];
    /** No chart without a sentence (DESIGN.md §4.4). */
    caption: string;
  };
  moneyIn: {
    months: MonthlyContribution[];
    caption: string;
    /** Not built from real accounts yet (Phase 2 decision 4). */
    comingSoon?: boolean;
  };
  holdings: Holding[];
  freshness: PriceFreshness;
}

export interface InstrumentDetail {
  id: string;
  name: string;
  ticker: string;
  bucket: Bucket;
  /** Formatted by the API because units vary: "5.04 shares", "0.0088 BTC". */
  quantity: string;
  price: Pence;
  value: Pence;
  today: Change;
  sinceBought: Change;
  /** As on `Holding`: what was paid isn't known yet, so `sinceBought` is flat. */
  sinceBoughtUnavailable?: boolean;
  /**
   * The "in plain English" note. Hand-written stub text in Phase 1, under the
   * not-advice label; the Phase 5 research module owns it later.
   */
  note: string;
  range: PriceRange;
  series: SeriesPoint[];
  freshness: PriceFreshness;
}

/** Degen is a hard cap; the others are targets to drift around. */
export type RuleKind = "target" | "cap";

export interface BucketRule {
  bucket: Bucket;
  kind: RuleKind;
  targetPercent: Percent;
  actualPercent: Percent;
  /** Plain-English explanation of where this pot sits against its line. */
  plain: string;
  /** False when the pot has no source yet; its actual is then meaningless. Absent means true. */
  available?: boolean;
  /** Degen only, and only when it is over: drives the one red thing in the app. */
  overBy?: {
    percent: Percent;
    amount: Pence;
  };
}

export interface RulesView {
  rules: BucketRule[];
  /** What the user pays in monthly, as set up at their broker — Pip only reads it. */
  monthlySplit: {
    total: Pence;
    perBucket: { bucket: Bucket; amount: Pence; percent: Percent }[];
    /** Not read from real accounts yet (Phase 2 decision 4). */
    comingSoon?: boolean;
  };
}

export type ActivityKind = "money_in" | "up" | "down" | "alert" | "milestone";

export interface ActivityEntry {
  id: string;
  bucket: Bucket;
  kind: ActivityKind;
  text: string;
  /** Human, not a timestamp: "Monday · automatic". */
  when: string;
}

/**
 * `GET /me`: who a signed-in person is, and whether they're allowed in. Reachable
 * without being on the allowlist, so a refused person can find that out.
 */
export interface MeResponse {
  email: string;
  name?: string;
  allowed: boolean;
}

export type ProviderId = "trading212" | "kraken";

/** Trading 212 accounts are connected one at a time: the API can't tell them apart. */
export type AccountKind = "isa" | "invest";

/** `invalid`: the provider rejected the stored key. `error`: the last read failed or a permission is missing. */
export type ConnectionStatus = "not_connected" | "live" | "expired" | "invalid" | "error";

export interface Connection {
  /** `trading212:isa`, `trading212:invest`, `kraken`. */
  id: string;
  provider: ProviderId;
  accountKind?: AccountKind;
  displayName: string;
  status: ConnectionStatus;
  /** Which pots this connection feeds. */
  feeds: Bucket[];
  holdingsSeen?: number;
  /** ISO timestamp of the last successful read. */
  lastReadAt?: string;
  /** False when Pip can't connect this provider yet (Kraken until Phase 3). */
  available: boolean;
  /**
   * Whether Pip can confirm a key is read-only. Kraken can; Trading 212 has no
   * way to ask, so Setup says so instead of "Pip checked" (Phase 2 decision 2).
   */
  permissionsVerified: boolean;
}

export interface ConnectRequest {
  /** Required for Trading 212. */
  accountKind?: AccountKind;
  key: string;
  /** Trading 212 keys come as a key and a secret. */
  secret?: string;
}

/**
 * The result of pasting a key. A key that can trade is refused outright where
 * Pip can tell (CLAUDE.md s13); where it can't, Setup says so plainly.
 */
export type ConnectOutcome =
  | "connected"
  | "invalid_key"
  | "too_much_access"
  | "missing_permission"
  | "not_pounds"
  | "unavailable"
  | "not_available_yet";

export interface ConnectPermission {
  name: string;
  granted: boolean;
  /** Query-funds is needed; trade and withdraw must be off. */
  required: boolean;
}

export interface ConnectResult {
  outcome: ConnectOutcome;
  provider: ProviderId;
  accountKind?: AccountKind;
  /** Plain-English explanation shown on the card: first sentence is the heading. */
  message: string;
  /** Present when the outcome is `too_much_access`. */
  permissions?: ConnectPermission[];
  /** Present when the outcome is `missing_permission`: the permission to tick. */
  missingPermission?: string;
}
