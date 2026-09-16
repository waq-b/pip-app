import { domainOf, HEADLINE_MAX, plainText, SNIPPET_MAX } from "../normalise.js";
import {
  FactsSourceError,
  type EventFact,
  type EventsAdapter,
  type FactsTarget,
  type FactsBudget,
  type HoldingNewsAdapter,
  type NewsFact,
} from "../types.js";
import { getText, HOUR_MS } from "./http.js";

/**
 * Alpha Vantage `NEWS_SENTIMENT` and `EARNINGS_CALENDAR` on the same free key
 * as prices (25 calls a day, about one a second). News takes at most 6 a day
 * and results dates 1, and neither takes a call once fewer than 7 are left
 * for prices. It refuses London tickers, so it covers US and EU listings by
 * their plain ticker, and crypto as `CRYPTO:BTC`.
 */
const BASE = "https://www.alphavantage.co/query";
/** Prices' own ceiling on the shared counter (`market/budget.ts`). */
const PRICES_CEILING = 22;
const LEAVE_FOR_PRICES = 7;
/** Alpha Vantage tags loosely; below this an article is only passing mention. */
export const MIN_RELEVANCE = 0.5;

const shared = { counter: "alpha-vantage", ceiling: PRICES_CEILING, keepFree: LEAVE_FOR_PRICES };
const NEWS_BUDGET: FactsBudget = { counter: "alpha-vantage-news", limit: 6, shared };
const EVENTS_BUDGET: FactsBudget = { counter: "alpha-vantage-events", limit: 1, shared };

export function alphaVantageNewsTicker(target: FactsTarget): string | null {
  if (target.asset === "crypto") return `CRYPTO:${target.shortName}`;
  if (target.region === "US" || target.region === "EU") return target.shortName;
  return null;
}

/** Throws on the 200-with-a-message answers: rate limits and bad tickers. */
function checkMessages(body: Record<string, unknown>) {
  if (typeof body.Information === "string" || typeof body.Note === "string")
    throw new FactsSourceError("alpha-vantage", "blocked", "rate limit");
  if (typeof body["Error Message"] === "string")
    throw new FactsSourceError("alpha-vantage", "not_found", "ticker");
}

/** `20260916T213031`, read as UTC (the docs don't say; a few hours can't move a 7-day window). */
function publishedAt(value: unknown): Date | null {
  const match =
    typeof value === "string" && /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})?$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s ?? "00"}Z`);
}

interface FeedItem {
  title?: unknown;
  url?: unknown;
  time_published?: unknown;
  summary?: unknown;
  source?: unknown;
  source_domain?: unknown;
  ticker_sentiment?: { ticker?: unknown; relevance_score?: unknown }[];
}

export function alphaVantageNewsFacts(text: string, ticker: string, since: Date): NewsFact[] {
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new FactsSourceError("alpha-vantage", "shape", "not JSON");
  }
  checkMessages(body);
  if (!Array.isArray(body.feed)) throw new FactsSourceError("alpha-vantage", "shape", "no feed");

  const facts: NewsFact[] = [];
  for (const item of body.feed as FeedItem[]) {
    const relevance = (item.ticker_sentiment ?? []).find((entry) => entry.ticker === ticker);
    if (!relevance || Number(relevance.relevance_score) < MIN_RELEVANCE) continue;
    const url = typeof item.url === "string" ? item.url : "";
    const at = publishedAt(item.time_published);
    const headline = plainText(item.title, HEADLINE_MAX);
    // `source_domain` is sometimes a name ("MarketBeat"), so the link decides.
    const domain = domainOf(url);
    if (!url || !at || !headline || !domain || at < since) continue;
    const snippet = plainText(item.summary, SNIPPET_MAX);
    facts.push({
      url,
      publisher: plainText(item.source, 120) || domain,
      publisherDomain: domain,
      headline,
      snippet: snippet || null,
      publishedAt: at,
    });
  }
  return facts;
}

/** The CSV calendar, matched to US and EU equities by plain ticker. London isn't in it. */
export function alphaVantageEarnings(text: string, targets: FactsTarget[]): EventFact[] {
  if (text.trimStart().startsWith("{")) {
    let body: Record<string, unknown> = {};
    try {
      body = JSON.parse(text) as Record<string, unknown>;
    } catch {
      /* not JSON either */
    }
    checkMessages(body);
    throw new FactsSourceError("alpha-vantage", "shape", "not CSV");
  }
  const [header, ...lines] = text.trim().split(/\r?\n/);
  const columns = (header ?? "").split(",");
  const at = (name: string) => columns.indexOf(name);
  if (at("symbol") < 0 || at("reportDate") < 0)
    throw new FactsSourceError("alpha-vantage", "shape", "unexpected columns");

  const byTicker = new Map(
    targets
      .filter((t) => t.asset === "equity" && (t.region === "US" || t.region === "EU"))
      .map((t) => [t.shortName, t.instrumentId]),
  );
  // The CSV isn't quoted, and a company name can hold a comma, so every column
  // after `name` is read counting back from the end of the line.
  const fromEnd = (cells: string[], name: string) =>
    cells[cells.length - (columns.length - at(name))];
  const events: EventFact[] = [];
  for (const line of lines) {
    const cells = line.split(",");
    const instrumentId = byTicker.get(cells[0] ?? "");
    const onDate = fromEnd(cells, "reportDate") ?? "";
    if (!instrumentId || !/^\d{4}-\d{2}-\d{2}$/.test(onDate)) continue;
    const detail: Record<string, string> = {};
    const time = fromEnd(cells, "timeOfTheDay");
    const estimate = fromEnd(cells, "estimate");
    if (time) detail.timeOfDay = time;
    if (estimate) detail.estimate = estimate;
    events.push({ instrumentId, kind: "earnings", onDate, detail });
  }
  return events;
}

export function alphaVantageNewsAdapter(options: {
  apiKey: string;
  fetch?: typeof fetch;
}): HoldingNewsAdapter {
  const doFetch = options.fetch ?? fetch;
  if (!options.apiKey) throw new Error("Alpha Vantage needs AV_ACCESS_KEY");
  return {
    id: "alpha-vantage",
    scope: "holding",
    everyMs: 20 * HOUR_MS,
    budget: NEWS_BUDGET,
    pauseMs: 1_500,
    coverage: { regions: ["US", "EU", "global"], assets: ["equity", "etf", "crypto"] },
    covers: (target) => alphaVantageNewsTicker(target) !== null,
    async fetch(target, { since }) {
      const ticker = alphaVantageNewsTicker(target)!;
      const query = new URLSearchParams({
        function: "NEWS_SENTIMENT",
        tickers: ticker,
        sort: "LATEST",
        limit: "50",
        time_from: since.toISOString().slice(0, 16).replace(/[-:]/g, ""),
        apikey: options.apiKey,
      });
      return alphaVantageNewsFacts(
        await getText(doFetch, "alpha-vantage", `${BASE}?${query}`),
        ticker,
        since,
      );
    },
  };
}

export function alphaVantageEarningsAdapter(options: {
  apiKey: string;
  fetch?: typeof fetch;
}): EventsAdapter {
  const doFetch = options.fetch ?? fetch;
  if (!options.apiKey) throw new Error("Alpha Vantage needs AV_ACCESS_KEY");
  return {
    id: "alpha-vantage",
    scope: "events",
    everyMs: 24 * HOUR_MS,
    budget: EVENTS_BUDGET,
    pauseMs: 1_500,
    coverage: { regions: ["US", "EU"], assets: ["equity"] },
    async fetch(targets) {
      const query = new URLSearchParams({
        function: "EARNINGS_CALENDAR",
        horizon: "3month",
        apikey: options.apiKey,
      });
      return alphaVantageEarnings(
        await getText(doFetch, "alpha-vantage", `${BASE}?${query}`),
        targets,
      );
    },
  };
}
