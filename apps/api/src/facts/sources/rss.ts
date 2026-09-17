import { XMLParser } from "fast-xml-parser";
import { domainOf, HEADLINE_MAX, parseDate, plainText, SNIPPET_MAX } from "../normalise.js";
import {
  FactsSourceError,
  type FactsTarget,
  type FeedNewsAdapter,
  type HoldingNewsAdapter,
  type NewsFact,
} from "../types.js";
import { getText, HOUR_MS } from "./http.js";

/**
 * RSS, first-class (Phase 5 addition 1): free, keyless, no rate limit — read
 * politely all the same. General feeds are matched to holdings by alias; a
 * company's own feed is about that company.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  processEntities: true,
  htmlEntities: true,
  // One item still comes back as a list.
  isArray: (name) => name === "item",
});

interface RawItem {
  title?: unknown;
  link?: unknown;
  pubDate?: unknown;
  description?: unknown;
  source?: { "#text"?: unknown; "@url"?: unknown } | string;
}

export function rssItems(xml: string, source: string): RawItem[] {
  let parsed: { rss?: { channel?: { item?: RawItem[] } } };
  try {
    parsed = parser.parse(xml) as typeof parsed;
  } catch {
    throw new FactsSourceError(source, "shape", "not XML");
  }
  const channel = parsed.rss?.channel;
  if (!channel) throw new FactsSourceError(source, "shape", "not an RSS feed");
  return channel.item ?? [];
}

/** Items from a feed with one publisher (BBC, CoinDesk, a company's newsroom). */
export function feedFacts(
  xml: string,
  feed: { id: string; publisher: string; domain: string },
  since: Date,
): NewsFact[] {
  const facts: NewsFact[] = [];
  for (const item of rssItems(xml, feed.id)) {
    const url = typeof item.link === "string" ? item.link.trim() : "";
    const publishedAt = parseDate(item.pubDate);
    const headline = plainText(item.title, HEADLINE_MAX);
    if (!url || !publishedAt || !headline || publishedAt < since) continue;
    const snippet = plainText(item.description, SNIPPET_MAX);
    facts.push({
      url,
      publisher: feed.publisher,
      publisherDomain: feed.domain,
      headline,
      snippet: snippet || null,
      publishedAt,
    });
  }
  return facts;
}

export interface FeedDefinition {
  id: string;
  url: string;
  publisher: string;
  domain: string;
}

/** General feeds named in the Phase 5 sign-off. */
export const GENERAL_FEEDS: FeedDefinition[] = [
  {
    id: "rss:bbc-business",
    url: "https://feeds.bbci.co.uk/news/business/rss.xml",
    publisher: "BBC",
    domain: "bbc.co.uk",
  },
  {
    id: "rss:investing-stock",
    url: "https://www.investing.com/rss/news_25.rss",
    publisher: "Investing.com",
    domain: "investing.com",
  },
  {
    id: "rss:investing-crypto",
    url: "https://www.investing.com/rss/news_301.rss",
    publisher: "Investing.com",
    domain: "investing.com",
  },
  {
    id: "rss:coindesk",
    url: "https://www.coindesk.com/arc/outboundfeeds/rss/",
    publisher: "CoinDesk",
    domain: "coindesk.com",
  },
  {
    id: "rss:cointelegraph",
    url: "https://cointelegraph.com/rss",
    publisher: "Cointelegraph",
    domain: "cointelegraph.com",
  },
];

/**
 * Companies' own newsroom feeds, by region and ticker. Only ones that exist:
 * ASML and Greggs publish none (checked 2026-09-17).
 */
export const COMPANY_FEEDS: Record<string, FeedDefinition> = {
  "US:NVDA": {
    id: "rss:nvidia-ir",
    url: "https://nvidianews.nvidia.com/releases.xml",
    publisher: "NVIDIA Newsroom",
    domain: "nvidianews.nvidia.com",
  },
};

/** General feeds hold only their latest 10–50 items, so they're read every 2 hours. */
const GENERAL_EVERY_MS = 2 * HOUR_MS;
const COMPANY_EVERY_MS = 12 * HOUR_MS;

export function generalFeedAdapter(
  feed: FeedDefinition,
  options: { fetch?: typeof fetch } = {},
): FeedNewsAdapter {
  const doFetch = options.fetch ?? fetch;
  return {
    id: feed.id,
    scope: "feed",
    everyMs: GENERAL_EVERY_MS,
    async fetch({ since }) {
      return feedFacts(await getText(doFetch, feed.id, feed.url), feed, since);
    },
  };
}

/** The company's own newsroom feed, when it has one. */
export const companyFeedFor = (target: Pick<FactsTarget, "region" | "shortName">) =>
  COMPANY_FEEDS[`${target.region}:${target.shortName}`];

/** One adapter for every company feed; it covers only holdings that have one. */
export function companyFeedsAdapter(options: { fetch?: typeof fetch } = {}): HoldingNewsAdapter {
  const doFetch = options.fetch ?? fetch;
  return {
    id: "rss:company",
    scope: "holding",
    everyMs: COMPANY_EVERY_MS,
    coverage: { regions: ["US", "UK", "EU", "other"], assets: ["equity", "etf"] },
    covers: (target) => companyFeedFor(target) !== undefined,
    async fetch(target, { since }) {
      const feed = companyFeedFor(target);
      if (!feed) return [];
      return feedFacts(await getText(doFetch, feed.id, feed.url), feed, since);
    },
  };
}

/** For sources that give a publisher per item as `<source url="…">Name</source>`. */
export function itemPublisher(item: RawItem): { publisher: string; domain: string } | null {
  const source = item.source;
  if (!source || typeof source === "string") return null;
  const name = plainText(source["#text"], 120);
  const domain = typeof source["@url"] === "string" ? domainOf(source["@url"]) : null;
  return name && domain ? { publisher: name, domain } : null;
}
