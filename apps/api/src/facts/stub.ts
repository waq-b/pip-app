import type { EventsAdapter, FactsTarget, HoldingNewsAdapter, NewsFact } from "./types.js";

/**
 * Facts for stub mode and tests — no network (design rule 6). Dated relative to
 * the moment they're asked for, so a week built from them is always "this
 * week".
 *
 * **The planted item** (Phase 5 loop test): two named publishers, Reuters and
 * the FT, report the same ASML news inside the default 7-day window, plus one
 * unnamed site. With the default trust rules (2+ named sources) it passes;
 * raise "Independent sources" to 3 and it's held back.
 *
 * Nvidia gets a single named report (never enough on its own), Bitcoin a
 * CoinDesk report and an unnamed one, and Greggs nothing — a quiet holding.
 */

const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

interface Planted {
  hoursAgo: number;
  publisher: string;
  domain: string;
  headline: string;
  snippet: string;
}

export const PLANTED_ASML: Planted[] = [
  {
    hoursAgo: 30,
    publisher: "Reuters",
    domain: "reuters.com",
    headline: "ASML examining ways to make more than 110 EUV tools in 2028",
    snippet: "The chip-equipment maker is looking at raising output of its most advanced machines.",
  },
  {
    hoursAgo: 26,
    publisher: "Financial Times",
    domain: "ft.com",
    headline: "ASML weighs bigger EUV production run as chipmakers queue for tools",
    snippet: "Customers adopting High NA machines have pushed ASML to plan more capacity.",
  },
  {
    hoursAgo: 20,
    publisher: "stockchatter.example",
    domain: "stockchatter.example",
    headline: "Is ASML about to explode? 3 reasons to watch",
    snippet: "Our take on the lithography giant.",
  },
];

const STUB_NEWS: Record<string, Planted[]> = {
  ASML: PLANTED_ASML,
  NVDA: [
    {
      hoursAgo: 50,
      publisher: "CNBC",
      domain: "cnbc.com",
      headline: "Nvidia shows new inference results in industry benchmark",
      snippet: "The chipmaker's latest systems led several categories.",
    },
  ],
  BTC: [
    {
      hoursAgo: 12,
      publisher: "CoinDesk",
      domain: "coindesk.com",
      headline: "Bitcoin holds steady as traders digest the Fed's rate decision",
      snippet: "The largest cryptocurrency barely moved after the announcement.",
    },
    {
      hoursAgo: 8,
      publisher: "moonshots.example",
      domain: "moonshots.example",
      headline: "Bitcoin to the moon? What the charts say",
      snippet: "Anonymous analysis.",
    },
  ],
};

function newsFor(target: FactsTarget, now: Date): NewsFact[] {
  return (STUB_NEWS[target.shortName] ?? []).map((item, index) => ({
    url: `https://news.example.test/${target.shortName.toLowerCase()}/${index + 1}`,
    publisher: item.publisher,
    publisherDomain: item.domain,
    headline: item.headline,
    snippet: item.snippet,
    publishedAt: new Date(now.getTime() - item.hoursAgo * HOUR_MS),
  }));
}

export function stubNewsAdapter(): HoldingNewsAdapter {
  return {
    id: "stub",
    scope: "holding",
    everyMs: 12 * HOUR_MS,
    coverage: {
      regions: ["US", "UK", "EU", "global", "other"],
      assets: ["equity", "etf", "crypto"],
    },
    async fetch(target, { since, now }) {
      return newsFor(target, now).filter((item) => item.publishedAt >= since);
    },
  };
}

/** Nvidia reports results in 9 days; nothing else has a date. */
export function stubEventsAdapter(): EventsAdapter {
  return {
    id: "stub",
    scope: "events",
    everyMs: 24 * HOUR_MS,
    coverage: {
      regions: ["US", "UK", "EU", "global", "other"],
      assets: ["equity", "etf", "crypto"],
    },
    async fetch(targets, { now }) {
      const nvidia = targets.find((target) => target.shortName === "NVDA");
      if (!nvidia) return [];
      const onDate = new Date(now.getTime() + 9 * DAY_MS).toISOString().slice(0, 10);
      return [
        {
          instrumentId: nvidia.instrumentId,
          kind: "earnings",
          onDate,
          detail: { timeOfDay: "post-market" },
        },
      ];
    },
  };
}
