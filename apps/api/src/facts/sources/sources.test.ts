import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { factsTarget } from "../targets.js";
import { FactsSourceError } from "../types.js";
import {
  alphaVantageEarnings,
  alphaVantageNewsAdapter,
  alphaVantageNewsFacts,
  alphaVantageNewsTicker,
  MIN_RELEVANCE,
} from "./alpha-vantage.js";
import { googleNewsAdapter, googleNewsFacts, googleNewsQuery } from "./google-news.js";
import { marketauxAdapter, marketauxFacts, marketauxSymbol } from "./marketaux.js";
import { companyFeedsAdapter, feedFacts, GENERAL_FEEDS, generalFeedAdapter } from "./rss.js";

const recorded = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../../../fixtures/recorded", path), "utf8");

const LONG_AGO = new Date("2020-01-01T00:00:00Z");
const NOW = new Date("2026-09-17T00:00:00Z");

const nvidia = factsTarget({ id: "NVDA_US_EQ", name: "Nvidia", shortName: "NVDA", type: "STOCK" });
const greggs = factsTarget({ id: "GRGl_EQ", name: "Greggs", shortName: "GRG", type: "STOCK" });
const asml = factsTarget({ id: "ASMLa_EQ", name: "ASML", shortName: "ASML", type: "STOCK" });
const vwrl = factsTarget({
  id: "VWRLl_EQ",
  name: "Vanguard FTSE All-World (Dist)",
  shortName: "VWRL",
  type: "ETF",
});
const bitcoin = factsTarget({
  id: "kraken:XBT",
  name: "Bitcoin",
  shortName: "btc",
  type: "CRYPTO",
});

function answering(body: string, status = 200) {
  return vi.fn<typeof fetch>(async () => new Response(body, { status }));
}

describe("Google News RSS", () => {
  const facts = googleNewsFacts(recorded("google-news/greggs-7d.xml"), LONG_AGO);

  it("reads each report with its own publisher, the title's suffix taken off", () => {
    expect(facts.length).toBe(8);
    expect(facts[0]).toMatchObject({
      publisher: "BBC",
      publisherDomain: "bbc.co.uk",
      headline: "'They know we're powerless': On the shoplifting front line in Greggs",
      snippet: null,
    });
    expect(facts[0]!.publishedAt.toISOString()).toBe("2026-09-16T05:18:03.000Z");
    for (const fact of facts) expect(fact.headline).not.toMatch(/ - [^-]+$/);
  });

  it("drops reports older than the window", () => {
    expect(googleNewsFacts(recorded("google-news/greggs-7d.xml"), NOW)).toEqual([]);
  });

  it("searches by the holding's name, over the widest window a user can set", async () => {
    const fetch = answering(recorded("google-news/asml-7d.xml"));
    const facts = await googleNewsAdapter({ fetch }).fetch(asml, { since: LONG_AGO, now: NOW });
    expect(facts.length).toBeGreaterThan(0);
    const url = new URL(String(fetch.mock.calls[0]![0]));
    expect(url.searchParams.get("q")).toBe('"ASML" when:14d');
    expect(googleNewsQuery("Vanguard FTSE All-World")).toBe('"Vanguard FTSE All-World" when:14d');
  });

  it("says a rate limit is a rate limit", async () => {
    await expect(
      googleNewsAdapter({ fetch: answering("", 429) }).fetch(greggs, { since: LONG_AGO, now: NOW }),
    ).rejects.toMatchObject({ reason: "blocked" });
  });
});

describe("RSS feeds", () => {
  it.each([
    ["rss/bbc-business.xml", "rss:bbc-business", "bbc.co.uk"],
    ["rss/coindesk.xml", "rss:coindesk", "coindesk.com"],
    ["rss/cointelegraph.xml", "rss:cointelegraph", "cointelegraph.com"],
    ["rss/investing-stock.xml", "rss:investing-stock", "investing.com"],
    ["rss/investing-crypto.xml", "rss:investing-crypto", "investing.com"],
  ])("reads %s under its publisher", async (file, id, domain) => {
    const feed = GENERAL_FEEDS.find((f) => f.id === id)!;
    const facts = await generalFeedAdapter(feed, { fetch: answering(recorded(file)) }).fetch({
      since: LONG_AGO,
      now: NOW,
    });
    expect(facts.length).toBe(5);
    for (const fact of facts) {
      expect(fact.publisherDomain).toBe(domain);
      expect(fact.headline).not.toMatch(/<|&amp;/);
      expect(Number.isNaN(fact.publishedAt.getTime())).toBe(false);
      expect((fact.snippet ?? "").length).toBeLessThanOrEqual(400);
    }
  });

  it("reads Investing.com's bare dates as UTC", () => {
    const [first] = feedFacts(
      recorded("rss/investing-stock.xml"),
      GENERAL_FEEDS.find((f) => f.id === "rss:investing-stock")!,
      LONG_AGO,
    );
    expect(first!.publishedAt.toISOString()).toBe("2026-09-16T22:55:12.000Z");
  });

  it("reads a company's own newsroom only for that company", async () => {
    const adapter = companyFeedsAdapter({ fetch: answering(recorded("rss/nvidia-ir.xml")) });
    expect(adapter.covers!(nvidia)).toBe(true);
    expect(adapter.covers!(asml)).toBe(false);
    expect(adapter.covers!(greggs)).toBe(false);
    const facts = await adapter.fetch(nvidia, { since: LONG_AGO, now: NOW });
    expect(facts[0]).toMatchObject({ publisherDomain: "nvidianews.nvidia.com" });
  });

  it("refuses something that isn't a feed", async () => {
    const adapter = generalFeedAdapter(GENERAL_FEEDS[0]!, { fetch: answering("<html></html>") });
    await expect(adapter.fetch({ since: LONG_AGO, now: NOW })).rejects.toBeInstanceOf(
      FactsSourceError,
    );
  });
});

describe("Marketaux", () => {
  it("spells symbols the way it knows them", () => {
    expect(marketauxSymbol(nvidia)).toBe("NVDA");
    expect(marketauxSymbol(greggs)).toBe("GRG.L");
    expect(marketauxSymbol(vwrl)).toBe("VWRL.L");
    expect(marketauxSymbol(asml)).toBe("ASML");
    expect(marketauxSymbol(bitcoin)).toBe("CC:BTC");
  });

  it("reads articles with their domain as publisher and a snippet", () => {
    const facts = marketauxFacts(JSON.parse(recorded("marketaux/news-ASML.json")), LONG_AGO);
    expect(facts.length).toBe(3);
    expect(facts[0]).toMatchObject({
      publisher: "finance.yahoo.com",
      publisherDomain: "finance.yahoo.com",
    });
    expect(facts[0]!.snippet).toBeTruthy();
  });

  it("finds nothing for Greggs that week, as recorded", () => {
    expect(marketauxFacts(JSON.parse(recorded("marketaux/news-GRG.L.json")), LONG_AGO)).toEqual([]);
  });

  it("never puts the token in an error", async () => {
    const adapter = marketauxAdapter({ apiKey: "secret-token-123", fetch: answering("{}", 500) });
    const error = await adapter.fetch(greggs, { since: LONG_AGO, now: NOW }).catch((e: Error) => e);
    expect(String(error)).not.toContain("secret-token-123");
  });
});

describe("Alpha Vantage news and results dates", () => {
  it("covers US, EU and crypto tickers, never London", () => {
    expect(alphaVantageNewsTicker(nvidia)).toBe("NVDA");
    expect(alphaVantageNewsTicker(asml)).toBe("ASML");
    expect(alphaVantageNewsTicker(bitcoin)).toBe("CRYPTO:BTC");
    expect(alphaVantageNewsTicker(greggs)).toBeNull();
    expect(alphaVantageNewsAdapter({ apiKey: "k" }).covers!(greggs)).toBe(false);
  });

  it("keeps only articles really about the ticker, publisher domain from the link", () => {
    const facts = alphaVantageNewsFacts(
      recorded("alpha-vantage/news-CRYPTO_BTC.json"),
      "CRYPTO:BTC",
      LONG_AGO,
    );
    const body = JSON.parse(recorded("alpha-vantage/news-CRYPTO_BTC.json")) as {
      feed: { ticker_sentiment: { ticker: string; relevance_score: string }[] }[];
    };
    const relevant = body.feed.filter((item) =>
      item.ticker_sentiment.some(
        (t) => t.ticker === "CRYPTO:BTC" && Number(t.relevance_score) >= MIN_RELEVANCE,
      ),
    );
    expect(facts.length).toBe(relevant.length);
    expect(facts.length).toBeLessThan(body.feed.length);
    expect(facts.map((f) => f.publisherDomain)).toContain("decrypt.co");
    expect(facts[0]!.publishedAt.toISOString()).toBe("2026-09-16T19:10:00.000Z");
  });

  it("treats a refused London ticker as not found and a burst as a rate limit", () => {
    expect(() =>
      alphaVantageNewsFacts(recorded("alpha-vantage/news-GRG.LON.json"), "GRG.LON", LONG_AGO),
    ).toThrow(/not_found/);
    expect(() =>
      alphaVantageNewsFacts(
        JSON.stringify({ Information: "spread out your requests" }),
        "NVDA",
        LONG_AGO,
      ),
    ).toThrow(/blocked/);
  });

  it("finds ASML's results date and nothing for London", () => {
    const events = alphaVantageEarnings(
      recorded("alpha-vantage/earnings-calendar-3month-sample.csv"),
      [nvidia, asml, greggs],
    );
    expect(events).toEqual([
      {
        instrumentId: "ASMLa_EQ",
        kind: "earnings",
        onDate: "2026-10-14",
        detail: { timeOfDay: "pre-market", estimate: "12.59" },
      },
    ]);
  });

  it("reads a company name with a comma in it", () => {
    const csv =
      "symbol,name,reportDate,fiscalDateEnding,estimate,currency,timeOfTheDay\nNVDA,NVIDIA, Corp,2026-11-18,2026-10-31,1.2,USD,post-market\n";
    expect(alphaVantageEarnings(csv, [nvidia])[0]).toMatchObject({
      onDate: "2026-11-18",
      detail: { timeOfDay: "post-market" },
    });
  });

  it("treats a JSON rate-limit answer to the calendar as a rate limit", () => {
    expect(() => alphaVantageEarnings(JSON.stringify({ Information: "limit" }), [nvidia])).toThrow(
      /blocked/,
    );
  });
});
