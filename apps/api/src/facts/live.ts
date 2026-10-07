import { alphaVantageEarningsAdapter, alphaVantageNewsAdapter } from "./sources/alpha-vantage.js";
import { googleNewsAdapter } from "./sources/google-news.js";
import { marketauxAdapter } from "./sources/marketaux.js";
import { companyFeedsAdapter, GENERAL_FEEDS, generalFeedAdapter } from "./sources/rss.js";
import type { FactsAdapter } from "./types.js";

/**
 * The real facts sources. Keyless ones always; a
 * source whose key isn't configured is simply left out.
 */
export function liveFactsAdapters(keys: {
  alphaVantageKey?: string;
  marketauxKey?: string;
}): FactsAdapter[] {
  const adapters: FactsAdapter[] = [
    ...GENERAL_FEEDS.map((feed) => generalFeedAdapter(feed)),
    googleNewsAdapter(),
    companyFeedsAdapter(),
  ];
  if (keys.marketauxKey) adapters.push(marketauxAdapter({ apiKey: keys.marketauxKey }));
  if (keys.alphaVantageKey) {
    adapters.push(alphaVantageNewsAdapter({ apiKey: keys.alphaVantageKey }));
    adapters.push(alphaVantageEarningsAdapter({ apiKey: keys.alphaVantageKey }));
  }
  return adapters;
}
