/**
 * The shapes apps/api returns and apps/web consumes. Types only — no logic, no
 * formatting, no thresholds. Phase 1 serves all of this from stubs.
 */
import type { Bucket } from "./buckets.js";
import type {
  NotificationItemKind,
  NotificationSettings,
  Recommendation,
} from "./notifications.js";
import type {
  NudgeCadence,
  NudgeKind,
  NudgeReason,
  NudgeResponse,
  Profile,
  TrustSettings,
} from "./research.js";

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
 * and never a trading API (design rule 7). The staleness ladder itself
 * (green / amber / red / markets-closed) is derived in the web app — this
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

/**
 * What the rules engine says about a pot (Phase 4): on its line, drifted from
 * its target, over its cap, or not judged because it isn't connected.
 */
/**
 * `near_limit` and `over_limit` are Side Bet's (Phase 6); `drifted` is a
 * target's. Only `over_limit` turns anything red.
 */
export type RuleStatus = "ok" | "drifted" | "near_limit" | "over_limit" | "unavailable";

/** How far Side Bet is past its limit — pounds first. */
export interface OverBy {
  percent: Percent;
  amount: Pence;
}

/**
 * Side Bet's limit and what it's judged against (Phase 6). The limit is the
 * FCA's 10% guide on the net assets you told Pip, or the starter limit until
 * you have. It is judged on money in, less taken out, over 12 months — not on
 * what Side Bet is worth, which only matters for the growth line.
 */
export interface SideBetLimit {
  limit: Pence;
  /** Money into Side Bet minus money taken out, over the last 12 months. */
  moneyIn: Pence;
  /** What Side Bet is worth now. */
  value: Pence;
  /** Share of the limit used, to 2 dp: 80 is the first alert, 100 the second. */
  usedPercent: Percent;
  /** True while net assets aren't set and the flat starter limit applies. */
  starter: boolean;
  /**
   * Set when Side Bet is worth more than went into it — good news, never red:
   * "Side Bet has grown to £910. That's good news."
   */
  grownBy?: Pence;
}

/** A pot as it appears on the home screen. */
export interface BucketSummary {
  bucket: Bucket;
  status?: BucketStatus;
  /** From the rules engine; the same answer `/rules` gives. */
  ruleStatus?: RuleStatus;
  overBy?: OverBy;
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
  /** "What changed" isn't built from real accounts yet . */
  activityComingSoon?: boolean;
  /** A cap is broken: the red dot on Rules. Same engine as `/rules`. */
  rulesNeedAttention?: boolean;
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
  ruleStatus?: RuleStatus;
  overBy?: OverBy;
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
    /** Not built from real accounts yet . */
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
  status?: RuleStatus;
  /**
   * The target it's judged against: the one set, scaled over connected pots
   * when some aren't connected. For Side Bet, the cap itself.
   */
  judgedAgainstPercent?: Percent;
  /** Actual − judged against, in points (targets only). */
  driftPoints?: number;
  /** Degen only, and only when it is over: drives the one red thing in the app. */
  overBy?: OverBy;
  /** Degen only: its limit, and what has gone into it (Phase 6). */
  limit?: SideBetLimit;
}

export interface RulesView {
  rules: BucketRule[];
  /** The one number the user sets; Foundation is the rest, Side Bet is outside it. */
  settings?: { handpickedTarget: number };
  /** ISO timestamp of the last change; absent until the user first changes a rule. */
  lastChangedAt?: string;
  /** Side Bet has reached its limit. */
  needsAttention?: boolean;
  /** Pots left out of the shape because they aren't connected — targets are scaled over the rest. */
  leftOut?: Bucket[];
  /**
   * When Side Bet is past its limit: what taking that much out would bring it
   * back under. Arithmetic, not advice — and Pip can't do it (design rule 1).
   */
  fixIt?: { outOfSideBet: Pence };
  /** What the user pays in monthly, as set up at their broker — Pip only reads it. */
  monthlySplit: {
    total: Pence;
    perBucket: { bucket: Bucket; amount: Pence; percent: Percent }[];
    /** Not read from real accounts yet . */
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
   * way to ask, so Setup says so instead of "Pip checked" .
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
 * Pip can tell; where it can't, Setup says so plainly.
 */
export type ConnectOutcome =
  | "connected"
  | "invalid_key"
  | "too_much_access"
  | "missing_permission"
  | "not_pounds"
  | "unavailable"
  | "not_available_yet"
  /** The key belongs to an account already connected to another pot (design rule 8). */
  | "same_account";

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

// ─── Phase 5: what Pip writes for, and what it lets through ───────────────────

/** `GET /profile`, and the answer to `PUT /profile`. */
export interface ProfileView {
  profile: Profile;
  /**
   * Pip writes notes for this person's own plan. False for everyone the owner
   * hasn't turned it on for — they get general notes (design rule 9).
   */
  personalised: boolean;
  /** ISO timestamp; absent until they first save. */
  lastChangedAt?: string;
}

export type ProfileError =
  | "invalid_body"
  | "goals_too_long"
  | "risk_words_too_long"
  | "horizon_out_of_range"
  | "monthly_in_invalid"
  | "too_many_exclusions"
  | "exclusion_invalid";

/** `GET /trust-rules`, and the answer to `PUT /trust-rules`. */
export interface TrustRulesView {
  settings: TrustSettings;
  /** ISO timestamp; absent until they first save. */
  lastChangedAt?: string;
}

export type TrustRulesError =
  | "invalid_body"
  | "whole_numbers_needed"
  | "recency_out_of_range"
  | "sources_out_of_range"
  | "quiet_days_out_of_range"
  | "weekly_budget_out_of_range"
  | "daily_budget_out_of_range"
  | "big_move_out_of_range"
  | "publishers_invalid"
  | "publishers_count";

// ─── Phase 5: Your week ───────────────────────────────────────────────────────

/** A report a nudge rests on — headline and link only; the article is never copied. */
export interface NudgeSource {
  publisher: string;
  headline: string;
  url: string;
  /** ISO timestamp. */
  publishedAt: string;
}

/** One trust rule a nudge was checked against, in plain words. */
export interface NudgeCheck {
  rule: string;
  passed: boolean;
  detail: string;
}

export interface NudgeView {
  id: string;
  cadence: NudgeCadence;
  kind: NudgeKind;
  reason: NudgeReason;
  bucket: Bucket | null;
  instrumentId: string | null;
  title: string;
  body: string;
  /** "Based on 3 sources over 2 days" — news only. */
  basis: string | null;
  sources: NudgeSource[];
  checks: NudgeCheck[];
  /** For a held-back nudge: the rule, in plain words, that held it. */
  heldBackBecause?: string;
  /**
   * Pip's take, on a recommendation (Phase 6, personal research only): the
   * course code chose and the pounds it worked out. The body explains it.
   */
  recommendation?: { course: Recommendation; amount: Pence | null };
  response: NudgeResponse | null;
  /** ISO timestamp. */
  createdAt: string;
}

export interface WeekView {
  /** The Monday, `YYYY-MM-DD`. */
  weekOf: string;
  /** ISO timestamp. */
  builtAt: string;
  opening: string;
  /** What's shown, with today's trust rules applied. A quiet week is one `none` nudge. */
  nudges: NudgeView[];
  /** What the trust rules held back — one tap away, so silence is visibly the rules working. */
  heldBack: NudgeView[];
  counts: { holdingsChecked: number; reportsRead: number; reportsCounted: number };
  next: { what: string; onDate: string } | null;
}

/** `GET /week`. */
export interface WeekResponse {
  /** Null until the first week is built. */
  week: WeekView | null;
  /** Daily nudges shown today. */
  today: NudgeView[];
  /** Mondays of earlier weeks, newest first. */
  pastWeeks: string[];
}

/** `POST /nudges/:id/response`. */
export interface NudgeResponseResult {
  id: string;
  response: NudgeResponse;
  /** ISO timestamp. */
  respondedAt: string;
}

// ─── Notifications (Phase 6) ─────────────────────────────────────────────────

/** A device that has notifications turned on. Never its endpoint or its keys. */
export interface DeviceView {
  id: string;
  /** "iPhone", "Android tablet", "Mac". */
  label: string;
  addedAt: string;
  lastDeliveredAt?: string;
  /** Set when a push to it last failed — the device row says it stopped. */
  lastFailedAt?: string;
}

export interface NotificationSettingsView {
  settings: NotificationSettings;
  /** The devices this person has turned notifications on for. */
  devices: DeviceView[];
  /** True once the first-login sheet has been answered; it's asked once. */
  asked: boolean;
  /**
   * What a browser subscribes with. Null when the server can't push (stub
   * mode, or before the VAPID pair is set) — the device row says so.
   */
  vapidPublicKey: string | null;
}

export interface NotificationItemView {
  kind: NotificationItemKind;
  id: string;
  title: string;
  body?: string;
  /** Internal pot id, when the row is about one pot. */
  bucket?: Bucket;
  at: string;
  read: boolean;
  /** Where tapping it opens Pip. */
  url: string;
}

export interface NotificationsView {
  items: NotificationItemView[];
  unread: number;
}

export type NotificationSettingsError = "invalid_body";
export type SubscriptionError = "invalid_subscription" | "unknown_subscription";
