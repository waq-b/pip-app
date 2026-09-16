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

/** A pot as it appears on the home screen. */
export interface BucketSummary {
  bucket: Bucket;
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
  shareOfBucket: Percent;
  series: SeriesPoint[];
}

/** One bar of "Money in". A zero month is a stub, never a gap. */
export interface MonthlyContribution {
  label: string;
  amount: Pence;
}

export interface BucketDetail {
  bucket: Bucket;
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
  /**
   * The "in plain English" note. Hand-written stub text in Phase 1, under the
   * not-advice label; the Phase 6 research module owns it later.
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

export type ProviderId = "trading212" | "kraken";

export type ConnectionStatus = "not_connected" | "live" | "expired" | "error";

export interface Connection {
  provider: ProviderId;
  displayName: string;
  status: ConnectionStatus;
  /** Which pots this connection feeds. */
  feeds: Bucket[];
  holdingsSeen?: number;
  /** ISO timestamp of the last successful read. */
  lastReadAt?: string;
}

/**
 * The result of pasting a key. Phase 1 stores nothing; Phase 2 swaps in real
 * validation and encrypted storage. A key that can trade is refused outright
 * rather than warned about (CLAUDE.md s13).
 */
export type ConnectOutcome = "connected" | "invalid_key" | "too_much_access";

export interface ConnectPermission {
  name: string;
  granted: boolean;
  /** Query-funds is needed; trade and withdraw must be off. */
  required: boolean;
}

export interface ConnectResult {
  outcome: ConnectOutcome;
  provider: ProviderId;
  /** Plain-English explanation shown on the card. */
  message: string;
  /** Present when the outcome is `too_much_access`. */
  permissions?: ConnectPermission[];
}
