import { DAILY_RECENCY_HOURS, type NudgeCadence, type TrustSettings } from "@finance-app/shared";

/**
 * Trust rules (Phase 5 decision 3): deterministic checks that decide whether a
 * nudge is shown at all. The LLM finds and writes; these decide. Pure — no
 * I/O, no clock — so the same facts and settings always give the same answer,
 * at build time and again when a week is read back after a rule changes.
 *
 * Stage A filters facts before any writer sees them (named publishers,
 * recency, exclusions). Stage B checks each candidate (independent sources,
 * quiet around results, room under the cap, exclusions), then budgets pick
 * what's shown.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export type TrustRuleId =
  | "named_publishers"
  | "recency"
  | "independent_sources"
  | "results_quiet"
  | "cap_room"
  | "exclusions"
  | "weekly_budget"
  | "daily_budget"
  /** A big move no longer past the user's line (a line raised after the build). */
  | "big_move"
  /** Not a trust rule: the writer judged the reports routine. */
  | "not_material";

export interface TrustCheck {
  rule: TrustRuleId;
  /** The setting it was judged against, as the user set it. */
  setting: string | number | boolean;
  passed: boolean;
  /** Plain words: "3 publishers: Reuters, FT, BBC". */
  detail: string;
}

/** A news report as the trust rules see it. */
export interface NewsItem {
  id: string;
  publisher: string;
  publisherDomain: string;
  headline: string;
  snippet: string | null;
  url: string;
  publishedAt: Date;
}

// ─── Publishers ───────────────────────────────────────────────────────────────

/** Endings that name a country or a kind of site, not the organisation. */
const SUFFIXES = new Set(["com", "co", "uk", "org", "net", "io", "news", "info", "ac", "gov"]);

/**
 * Who a publisher is, for counting independent sources: the organisation's
 * own label in the domain. `bbc.co.uk` and `bbc.com` are both "bbc";
 * `uk.finance.yahoo.com` and `finance.yahoo.com` are both "yahoo". Two BBC
 * reports are one source.
 */
export function publisherKey(domain: string): string {
  const labels = domain
    .toLowerCase()
    .replace(/^www\./, "")
    .split(".");
  while (labels.length > 1 && SUFFIXES.has(labels[labels.length - 1]!)) labels.pop();
  return labels[labels.length - 1] ?? domain;
}

/** `finance.yahoo.com` is covered by a named `yahoo.com`; `notreuters.com` isn't by `reuters.com`. */
export function domainMatches(domain: string, named: string): boolean {
  const d = domain.toLowerCase();
  const n = named.toLowerCase();
  return d === n || d.endsWith(`.${n}`);
}

// ─── Exclusions ───────────────────────────────────────────────────────────────

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** The first exclusion that appears in any of the texts as a whole word, any case. */
export function excludedBy(exclusions: string[], ...texts: string[]): string | null {
  for (const exclusion of exclusions) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escape(exclusion)}($|[^\\p{L}\\p{N}])`, "iu");
    if (texts.some((text) => pattern.test(text))) return exclusion;
  }
  return null;
}

// ─── Stage A: which facts count ───────────────────────────────────────────────

export interface StageAContext {
  now: Date;
  cadence: NudgeCadence;
  settings: TrustSettings;
  exclusions: string[];
  /** The holding's own newsroom domains — they count for that company only (Waqar, 2026-09-17). */
  ownNewsroomDomains: string[];
}

export interface StageAResult {
  kept: NewsItem[];
  /** Why each dropped report was dropped. */
  dropped: { item: NewsItem; rule: TrustRuleId }[];
}

export function recencyWindowMs(cadence: NudgeCadence, settings: TrustSettings): number {
  return cadence === "daily" ? DAILY_RECENCY_HOURS * HOUR_MS : settings.recencyDays * DAY_MS;
}

export function stageA(items: NewsItem[], context: StageAContext): StageAResult {
  const since = context.now.getTime() - recencyWindowMs(context.cadence, context.settings);
  const result: StageAResult = { kept: [], dropped: [] };
  for (const item of items) {
    const named =
      context.settings.namedPublishers.some((named) =>
        domainMatches(item.publisherDomain, named),
      ) || context.ownNewsroomDomains.some((own) => domainMatches(item.publisherDomain, own));
    if (!named) result.dropped.push({ item, rule: "named_publishers" });
    else if (item.publishedAt.getTime() < since || item.publishedAt > context.now)
      result.dropped.push({ item, rule: "recency" });
    else if (excludedBy(context.exclusions, item.headline, item.snippet ?? ""))
      result.dropped.push({ item, rule: "exclusions" });
    else result.kept.push(item);
  }
  // Newest first, so a writer and a reader see the latest reports first.
  result.kept.sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime());
  return result;
}

// ─── Stage B: checks on one candidate ─────────────────────────────────────────

/** Different organisations among the reports, in the order first seen. */
export function independentPublishers(items: NewsItem[]): NewsItem[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = publisherKey(item.publisherDomain);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function independentSourcesCheck(items: NewsItem[], settings: TrustSettings): TrustCheck {
  const publishers = independentPublishers(items).map((item) => item.publisher);
  return {
    rule: "independent_sources",
    setting: settings.minSources,
    passed: publishers.length >= settings.minSources,
    detail:
      publishers.length === 0
        ? "No reports from named publishers"
        : `${publishers.length} ${publishers.length === 1 ? "publisher" : "publishers"}: ${publishers.join(", ")}`,
  };
}

/** Results dates as `YYYY-MM-DD`; past ones included, since the quiet period runs both ways. */
export function resultsQuietCheck(
  resultsDates: string[],
  now: Date,
  settings: TrustSettings,
): TrustCheck {
  if (resultsDates.length === 0) {
    return {
      rule: "results_quiet",
      setting: settings.resultsQuietDays,
      passed: true,
      detail: "No results date known",
    };
  }
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const nearest = resultsDates
    .map((day) => ({ day, gap: Math.round((Date.parse(`${day}T00:00:00Z`) - today) / DAY_MS) }))
    .sort((a, b) => Math.abs(a.gap) - Math.abs(b.gap))[0]!;
  const within = Math.abs(nearest.gap) <= settings.resultsQuietDays;
  return {
    rule: "results_quiet",
    setting: settings.resultsQuietDays,
    passed: !within,
    detail: within
      ? `Results ${nearest.gap === 0 ? "today" : nearest.gap > 0 ? `in ${nearest.gap} days` : `${-nearest.gap} days ago`} (${nearest.day})`
      : `Nearest results ${nearest.day}`,
  };
}

export function capRoomCheck(isSideBet: boolean, capBroken: boolean): TrustCheck {
  const blocked = isSideBet && capBroken;
  return {
    rule: "cap_room",
    setting: true,
    passed: !blocked,
    detail: !isSideBet
      ? "Not in Side Bet"
      : blocked
        ? "Side Bet is over its cap"
        : "Side Bet has room under its cap",
  };
}

export function exclusionsCheck(exclusions: string[], ...texts: string[]): TrustCheck {
  const hit = excludedBy(exclusions, ...texts);
  return {
    rule: "exclusions",
    setting: exclusions.length,
    passed: hit === null,
    detail: hit === null ? "Not on your exclusions list" : `On your exclusions list: ${hit}`,
  };
}

// ─── Basis ────────────────────────────────────────────────────────────────────

/** "Based on 3 sources over 2 days" — never a percentage a model made up. */
export function basisFor(items: NewsItem[]): string {
  const sources = independentPublishers(items).length;
  const days = new Set(items.map((item) => item.publishedAt.toISOString().slice(0, 10))).size;
  return `Based on ${sources} ${sources === 1 ? "source" : "sources"} over ${days} ${days === 1 ? "day" : "days"}`;
}
