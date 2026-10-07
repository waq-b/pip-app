import { domainOf, HEADLINE_MAX, parseDate, plainText, SNIPPET_MAX } from "../normalise.js";
import {
  FactsSourceError,
  type FactsTarget,
  type HoldingNewsAdapter,
  type NewsFact,
} from "../types.js";
import { getJson, HOUR_MS } from "./http.js";

/**
 * Marketaux free plan: 100 requests a day, 3 articles a
 * request, filtered to articles tagged with the holding. Publishers are
 * domains. The token never appears in an error.
 */
const BASE = "https://api.marketaux.com/v1/news/all";

export function marketauxSymbol(target: FactsTarget): string | null {
  switch (target.region) {
    case "US":
    case "EU":
      return target.shortName;
    case "UK":
      return `${target.shortName}.L`;
    case "global":
      return target.asset === "crypto" ? `CC:${target.shortName}` : null;
    default:
      return null;
  }
}

interface Article {
  url?: unknown;
  title?: unknown;
  snippet?: unknown;
  description?: unknown;
  source?: unknown;
  published_at?: unknown;
}

export function marketauxFacts(body: unknown, since: Date): NewsFact[] {
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) throw new FactsSourceError("marketaux", "shape", "no data");
  const facts: NewsFact[] = [];
  for (const article of data as Article[]) {
    const url = typeof article.url === "string" ? article.url : "";
    const domain =
      (typeof article.source === "string" && domainOf(article.source)) || domainOf(url);
    const publishedAt = parseDate(article.published_at);
    const headline = plainText(article.title, HEADLINE_MAX);
    if (!url || !domain || !publishedAt || !headline || publishedAt < since) continue;
    const snippet = plainText(article.description || article.snippet, SNIPPET_MAX);
    facts.push({
      url,
      publisher: domain,
      publisherDomain: domain,
      headline,
      snippet: snippet || null,
      publishedAt,
    });
  }
  return facts;
}

export function marketauxAdapter(options: {
  apiKey: string;
  fetch?: typeof fetch;
}): HoldingNewsAdapter {
  const doFetch = options.fetch ?? fetch;
  if (!options.apiKey) throw new Error("Marketaux needs MARKETAUX_API");
  return {
    id: "marketaux",
    scope: "holding",
    everyMs: 20 * HOUR_MS,
    budget: { counter: "marketaux", limit: 80 },
    coverage: {
      regions: ["US", "UK", "EU", "global"],
      assets: ["equity", "etf", "crypto"],
    },
    covers: (target) => marketauxSymbol(target) !== null,
    async fetch(target, { since }) {
      const query = new URLSearchParams({
        symbols: marketauxSymbol(target)!,
        filter_entities: "true",
        language: "en",
        published_after: since.toISOString().slice(0, 16),
        limit: "3",
        api_token: options.apiKey,
      });
      const body = await getJson(doFetch, "marketaux", `${BASE}?${query}`);
      return marketauxFacts(body, since);
    },
  };
}
