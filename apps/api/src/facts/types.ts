/**
 * Facts (Phase 5): what's being said about what a user holds, and what's coming
 * up — collected on a schedule into shared tables, like prices. The research
 * module only ever reads what these adapters stored; it never fetches.
 *
 * Each adapter declares what it covers (regions and asset types), and the
 * collector picks adapters per holding from those declarations.
 */

export type Region = "US" | "UK" | "EU" | "global" | "other";
export type AssetType = "equity" | "etf" | "crypto";

export interface Coverage {
  regions: readonly Region[];
  assets: readonly AssetType[];
}

/** A holding, as the facts layer sees it. */
export interface FactsTarget {
  instrumentId: string;
  name: string;
  /** Ticker as people write it: `NVDA`, `GRG`, `BTC`. */
  shortName: string;
  region: Region;
  asset: AssetType;
  /** Words a headline must contain to be about this holding (see `aliasesFor`). */
  aliases: { names: string[]; tickers: string[] };
}

export interface NewsFact {
  url: string;
  /** As the source names it: "Reuters", "reuters.com". */
  publisher: string;
  /** Trust rules match on this: `reuters.com`. */
  publisherDomain: string;
  headline: string;
  snippet: string | null;
  publishedAt: Date;
}

export interface EventFact {
  instrumentId: string;
  kind: "earnings";
  /** `YYYY-MM-DD`. */
  onDate: string;
  detail: Record<string, string>;
}

/**
 * A daily call budget in `source_usage`. `shared` also takes from another
 * counter, but only while `keepFree` calls are left under its ceiling — how
 * Alpha Vantage news leaves room for prices on the same 25-a-day key.
 */
export interface FactsBudget {
  counter: string;
  limit: number;
  shared?: { counter: string; ceiling: number; keepFree: number };
}

interface AdapterBase {
  /** `google-news`, `marketaux`, `alpha-vantage`, `rss:<feed>`, `stub`. */
  id: string;
  /** How long a successful read stays fresh. */
  everyMs: number;
  budget?: FactsBudget;
  /** Wait between this adapter's calls (Alpha Vantage refuses bursts). */
  pauseMs?: number;
}

/** News about one holding at a time. */
export interface HoldingNewsAdapter extends AdapterBase {
  scope: "holding";
  coverage: Coverage;
  /** Narrower than coverage, e.g. a company's own feed. */
  covers?: (target: FactsTarget) => boolean;
  fetch(target: FactsTarget, window: { since: Date; now: Date }): Promise<NewsFact[]>;
}

/** A general feed; items are matched to holdings by their aliases. */
export interface FeedNewsAdapter extends AdapterBase {
  scope: "feed";
  fetch(window: { since: Date; now: Date }): Promise<NewsFact[]>;
}

/** Dated events for every holding it covers, in one read. */
export interface EventsAdapter extends AdapterBase {
  scope: "events";
  coverage: Coverage;
  fetch(targets: FactsTarget[], window: { now: Date }): Promise<EventFact[]>;
}

export type FactsAdapter = HoldingNewsAdapter | FeedNewsAdapter | EventsAdapter;

export class FactsSourceError extends Error {
  constructor(
    readonly source: string,
    readonly reason: "unavailable" | "blocked" | "not_found" | "shape",
    detail: string,
  ) {
    super(`${source}: ${reason} (${detail})`);
    this.name = "FactsSourceError";
  }
}
