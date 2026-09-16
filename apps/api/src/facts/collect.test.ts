import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  factsEvents,
  factsFetches,
  factsNews,
  factsNewsInstruments,
  holdings,
  instruments,
  providerCredentials,
  sourceUsage,
  users,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { takeCall } from "../market/budget.js";
import { testDatabase } from "../test-support/pglite.js";
import { collectFacts, heldTargets, KEEP_DAYS, newsCountFor, RETRY_AFTER_MS } from "./collect.js";
import { newsId } from "./normalise.js";
import { PLANTED_ASML, stubEventsAdapter, stubNewsAdapter } from "./stub.js";
import {
  FactsSourceError,
  type FactsAdapter,
  type FeedNewsAdapter,
  type HoldingNewsAdapter,
  type NewsFact,
} from "./types.js";

const NOW = new Date("2026-09-17T08:00:00Z");
const HOUR = 3_600_000;
let db: Db;
let close: () => Promise<void>;
const sleep = vi.fn(async () => undefined);

const HELD = [
  {
    id: "NVDA_US_EQ",
    isin: "US67066G1040",
    name: "Nvidia",
    shortName: "NVDA",
    currency: "USD",
    type: "STOCK",
  },
  {
    id: "GRGl_EQ",
    isin: "GB00B63QSB39",
    name: "Greggs",
    shortName: "GRG",
    currency: "GBX",
    type: "STOCK",
  },
  {
    id: "ASMLa_EQ",
    isin: "NL0010273215",
    name: "ASML",
    shortName: "ASML",
    currency: "EUR",
    type: "STOCK",
  },
  {
    id: "kraken:XBT",
    isin: "",
    name: "Bitcoin",
    shortName: "BTC",
    currency: "GBP",
    type: "CRYPTO",
  },
];

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
  await db.insert(instruments).values(HELD);
  const [user] = await db.insert(users).values({ email: "a@example.test" }).returning();
  const [credential] = await db
    .insert(providerCredentials)
    .values({
      userId: user!.id,
      provider: "trading212",
      accountKind: "isa",
      sealedKey: "pip:1:k",
      sealedSecret: "pip:1:s",
      keyVersion: 1,
      status: "live",
      accountCurrency: "GBP",
    })
    .returning();
  await db.insert(holdings).values(
    HELD.map((instrument) => ({
      credentialId: credential!.id,
      userId: user!.id,
      instrumentId: instrument.id,
      quantity: "1",
      polledAt: NOW,
    })),
  );
});
afterAll(async () => close());

beforeEach(async () => {
  sleep.mockClear();
  await db.delete(factsNewsInstruments);
  await db.delete(factsNews);
  await db.delete(factsEvents);
  await db.delete(factsFetches);
  await db.delete(sourceUsage);
});

function fact(overrides: Partial<NewsFact> = {}): NewsFact {
  return {
    url: "https://www.reuters.com/asml-tools",
    publisher: "Reuters",
    publisherDomain: "reuters.com",
    headline: "ASML plans more EUV tools",
    snippet: null,
    publishedAt: new Date(NOW.getTime() - 5 * HOUR),
    ...overrides,
  };
}

function holdingAdapter(overrides: Partial<HoldingNewsAdapter> = {}): HoldingNewsAdapter {
  return {
    id: "test-holding",
    scope: "holding",
    everyMs: 12 * HOUR,
    coverage: { regions: ["US", "UK", "EU", "global"], assets: ["equity", "etf", "crypto"] },
    fetch: vi.fn(async () => []),
    ...overrides,
  };
}

const run = (adapters: FactsAdapter[], now = NOW) => collectFacts({ db, adapters, now, sleep });

describe("collecting facts for what's held", () => {
  it("knows everything anyone holds", async () => {
    expect((await heldTargets(db)).map((t) => t.instrumentId)).toEqual([
      "ASMLa_EQ",
      "GRGl_EQ",
      "NVDA_US_EQ",
      "kraken:XBT",
    ]);
  });

  it("stores the stub's planted ASML reports against ASML, and nothing for Greggs", async () => {
    const summary = await run([stubNewsAdapter(), stubEventsAdapter()]);
    expect(summary.failed).toEqual([]);
    expect(await newsCountFor(db, "ASMLa_EQ")).toBe(PLANTED_ASML.length);
    expect(await newsCountFor(db, "GRGl_EQ")).toBe(0);
    const named = await db
      .select({ domain: factsNews.publisherDomain })
      .from(factsNews)
      .innerJoin(factsNewsInstruments, eq(factsNewsInstruments.newsId, factsNews.id))
      .where(eq(factsNewsInstruments.instrumentId, "ASMLa_EQ"));
    expect(named.map((row) => row.domain)).toEqual(
      expect.arrayContaining(["reuters.com", "ft.com"]),
    );
    const [event] = await db.select().from(factsEvents);
    expect(event).toMatchObject({
      instrumentId: "NVDA_US_EQ",
      onDate: "2026-09-26",
      source: "stub",
    });
  });

  it("stores a report once however many sources lead to it, and links every holding it mentions", async () => {
    const shared = fact({
      url: "https://www.reuters.com/asml-tools?utm_source=feed",
      headline: "ASML and Nvidia sign a new tools deal",
    });
    await run([
      holdingAdapter({
        id: "one",
        fetch: async (target) => (target.shortName === "ASML" ? [shared] : []),
      }),
      holdingAdapter({
        id: "two",
        fetch: async (target) =>
          target.shortName === "ASML"
            ? [{ ...shared, url: "https://www.reuters.com/asml-tools" }]
            : [],
      }),
    ]);
    expect(await db.select().from(factsNews)).toHaveLength(1);
    const links = await db.select().from(factsNewsInstruments);
    expect(links.map((l) => l.instrumentId).sort()).toEqual(["ASMLa_EQ", "NVDA_US_EQ"]);
    expect(links[0]!.newsId).toBe(newsId("https://www.reuters.com/asml-tools"));
  });

  it("matches a general feed's items to holdings by name, and keeps the unmatched unlinked", async () => {
    const feed: FeedNewsAdapter = {
      id: "rss:test",
      scope: "feed",
      everyMs: 2 * HOUR,
      fetch: async () => [
        fact({
          url: "https://bbc.co.uk/1",
          headline: "Greggs opens its 3,000th shop",
          publisherDomain: "bbc.co.uk",
        }),
        fact({
          url: "https://bbc.co.uk/2",
          headline: "Interest rates rise again",
          publisherDomain: "bbc.co.uk",
        }),
      ],
    };
    await run([feed]);
    expect(await db.select().from(factsNews)).toHaveLength(2);
    expect(await newsCountFor(db, "GRGl_EQ")).toBe(1);
    expect(await db.select().from(factsNewsInstruments)).toHaveLength(1);
  });

  it("only asks sources whose coverage includes the holding", async () => {
    const ukOnly = holdingAdapter({ coverage: { regions: ["UK"], assets: ["equity"] } });
    await run([ukOnly]);
    expect(
      (ukOnly.fetch as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0].shortName),
    ).toEqual(["GRG"]);
  });

  it("doesn't ask again until the read is due", async () => {
    const adapter = holdingAdapter();
    await run([adapter]);
    await run([adapter], new Date(NOW.getTime() + 11 * HOUR));
    expect(adapter.fetch).toHaveBeenCalledTimes(4);
    await run([adapter], new Date(NOW.getTime() + 12 * HOUR));
    expect(adapter.fetch).toHaveBeenCalledTimes(8);
  });

  it("leaves a failing source alone for an hour, and keeps going with the rest", async () => {
    const broken = holdingAdapter({
      id: "broken",
      fetch: vi.fn(async () => {
        throw new FactsSourceError("broken", "unavailable", "500");
      }),
    });
    const working = holdingAdapter({ id: "working", fetch: vi.fn(async () => [fact()]) });
    const summary = await run([broken, working]);
    expect(summary.failed).toHaveLength(4);
    expect(working.fetch).toHaveBeenCalledTimes(4);
    await run([broken], new Date(NOW.getTime() + RETRY_AFTER_MS - 1));
    expect(broken.fetch).toHaveBeenCalledTimes(4);
    await run([broken], new Date(NOW.getTime() + RETRY_AFTER_MS));
    expect(broken.fetch).toHaveBeenCalledTimes(8);
  });

  it("tries a rate-limited source again on the next run", async () => {
    const limited = holdingAdapter({
      fetch: vi.fn(async () => {
        throw new FactsSourceError("x", "blocked", "429");
      }),
    });
    await run([limited]);
    await run([limited], new Date(NOW.getTime() + 60_000));
    expect(limited.fetch).toHaveBeenCalledTimes(8);
  });

  it("stops at the daily budget", async () => {
    const budgeted = holdingAdapter({ budget: { counter: "test", limit: 2 } });
    const summary = await run([budgeted]);
    expect(budgeted.fetch).toHaveBeenCalledTimes(2);
    expect(summary.overBudget).toHaveLength(2);
  });

  it("leaves Alpha Vantage calls for prices when news shares the key", async () => {
    const shared = { counter: "alpha-vantage", ceiling: 22, keepFree: 7 };
    // Prices have already used 14 of their 22.
    for (let i = 0; i < 14; i++) await takeCall(db, "alpha-vantage", 22, NOW);
    const news = holdingAdapter({
      budget: { counter: "alpha-vantage-news", limit: 6, shared },
      pauseMs: 1_500,
    });
    await run([news]);
    expect(news.fetch).toHaveBeenCalledTimes(1);
    // Prices can still take their remaining 7.
    let left = 0;
    while (await takeCall(db, "alpha-vantage", 22, NOW)) left += 1;
    expect(left).toBe(7);
  });

  it("waits between calls to a source that refuses bursts", async () => {
    await run([holdingAdapter({ pauseMs: 1_500 })]);
    expect(sleep).toHaveBeenCalledTimes(3);
    expect(sleep).toHaveBeenCalledWith(1_500);
  });

  it("deletes facts older than 90 days", async () => {
    const old = new Date(NOW.getTime() - (KEEP_DAYS + 1) * 24 * HOUR);
    await run([
      holdingAdapter({
        fetch: async (target) =>
          target.shortName === "ASML"
            ? [fact({ url: "https://x.test/old", publishedAt: old }), fact()]
            : [],
      }),
    ]);
    // The collector reads a 14-day window, but a source may still hand back something older.
    expect(await db.select().from(factsNews)).toHaveLength(1);
  });

  it("does nothing when nobody holds anything", async () => {
    await db.delete(holdings);
    const adapter = holdingAdapter();
    const summary = await run([adapter, stubEventsAdapter()]);
    expect(adapter.fetch).not.toHaveBeenCalled();
    expect(summary.read).toBe(0);
  });
});
