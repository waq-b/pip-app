import { HEADLINE_MAX, parseDate, plainText } from "../normalise.js";
import type { HoldingNewsAdapter, NewsFact } from "../types.js";
import { getText, HOUR_MS } from "./http.js";
import { itemPublisher, rssItems } from "./rss.js";

/**
 * Google News RSS search, per holding by name — the only free source found that
 * covers UK and European names (Phase 5 task 1). No key. Each item names its
 * publisher; titles end " - Publisher", which is taken off. Links are Google
 * redirects, and the description only repeats the title, so there's no snippet.
 *
 * Google's feed says it's for a personal feed reader, personal and
 * non-commercial — a Pre POC release item before anyone else uses Pip.
 */
const BASE = "https://news.google.com/rss/search";
/** The widest recency window a user can set. */
const WINDOW_DAYS = 14;

export function googleNewsQuery(name: string): string {
  return `"${name.replace(/"/g, "")}" when:${WINDOW_DAYS}d`;
}

export function googleNewsFacts(xml: string, since: Date): NewsFact[] {
  const facts: NewsFact[] = [];
  for (const item of rssItems(xml, "google-news")) {
    const url = typeof item.link === "string" ? item.link.trim() : "";
    const publishedAt = parseDate(item.pubDate);
    const who = itemPublisher(item);
    if (!url || !publishedAt || !who || publishedAt < since) continue;
    const title = plainText(item.title, HEADLINE_MAX + 200);
    const suffix = ` - ${who.publisher}`;
    const headline = plainText(
      title.endsWith(suffix) ? title.slice(0, -suffix.length) : title,
      HEADLINE_MAX,
    );
    if (!headline) continue;
    facts.push({
      url,
      publisher: who.publisher,
      publisherDomain: who.domain,
      headline,
      snippet: null,
      publishedAt,
    });
  }
  return facts;
}

export function googleNewsAdapter(options: { fetch?: typeof fetch } = {}): HoldingNewsAdapter {
  const doFetch = options.fetch ?? fetch;
  return {
    id: "google-news",
    scope: "holding",
    everyMs: 12 * HOUR_MS,
    budget: { counter: "google-news", limit: 300 },
    // Crypto has its own feeds; a coin's name finds too much that isn't news.
    coverage: { regions: ["US", "UK", "EU", "other"], assets: ["equity", "etf"] },
    covers: (target) => target.aliases.names.length > 0,
    async fetch(target, { since }) {
      const query = new URLSearchParams({
        q: googleNewsQuery(target.aliases.names[0]!),
        hl: "en-GB",
        gl: "GB",
        ceid: "GB:en",
      });
      return googleNewsFacts(await getText(doFetch, "google-news", `${BASE}?${query}`), since);
    },
  };
}
