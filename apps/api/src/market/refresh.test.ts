import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  dailyCloses,
  instruments,
  intradaySeries,
  marketSchedules,
  prices,
  sourceUsage,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { testDatabase } from "../test-support/pglite.js";
import { withBudget } from "./budget.js";
import { ensureDailyCloses, isDue, refreshDue, TTL } from "./refresh.js";
import { withFallback } from "./sources/fallback.js";
import { PriceSourceError, type PriceSource } from "./sources/types.js";

let db: Db;
let close: () => Promise<void>;

// London: open 07:00–15:30 UTC on 16 Sep 2026.
const LSE_EVENTS = [
  { date: "2026-09-15T07:00:31.000Z", type: "OPEN" },
  { date: "2026-09-15T15:30:00.000Z", type: "CLOSE" },
  { date: "2026-09-16T07:00:31.000Z", type: "OPEN" },
  { date: "2026-09-16T15:30:00.000Z", type: "CLOSE" },
  { date: "2026-09-17T07:00:31.000Z", type: "OPEN" },
];
const IN_HOURS = new Date("2026-09-16T10:00:00Z");

function fakeSource(id: PriceSource["id"], overrides: Partial<PriceSource> = {}): PriceSource {
  return {
    id,
    label: id === "yahoo" ? "Yahoo Finance" : "Alpha Vantage",
    quote: vi.fn(async (target) => ({
      price: target.kind === "fx" ? 1.34 : 1741,
      previousClose: target.kind === "fx" ? 1.35 : 1755,
      currency: target.kind === "fx" ? target.quote : target.currency,
      asOf: IN_HOURS,
      intraday: id === "yahoo" ? [{ at: IN_HOURS, price: 1741 }] : undefined,
    })),
    dailyCloses: vi.fn(async () => [
      { day: "2026-09-14", close: 1700 },
      { day: "2026-09-15", close: 1755 },
    ]),
    ...overrides,
  };
}

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
});
afterAll(async () => close());

beforeEach(async () => {
  for (const table of [
    prices,
    intradaySeries,
    dailyCloses,
    sourceUsage,
    instruments,
    marketSchedules,
  ]) {
    await db.delete(table);
  }
  await db
    .insert(marketSchedules)
    .values({ scheduleId: 55, exchangeName: "London Stock Exchange", events: LSE_EVENTS });
  await db.insert(instruments).values([
    {
      id: "GRGl_EQ",
      isin: "GB00B63QSB39",
      name: "Greggs",
      shortName: "GRG",
      currency: "GBX",
      type: "STOCK",
      workingScheduleId: 55,
      yahooSymbol: "GRG.L",
      alphaVantageSymbol: "GRG.LON",
    },
    {
      id: "NVDA_US_EQ",
      isin: "US67066G1040",
      name: "Nvidia",
      shortName: "NVDA",
      currency: "USD",
      type: "STOCK",
      workingScheduleId: null,
      yahooSymbol: "NVDA",
      alphaVantageSymbol: "NVDA",
    },
  ]);
});

const market =
  (yahoo: PriceSource, av: PriceSource = fakeSource("alpha-vantage")) =>
  () =>
    withFallback([
      { source: yahoo, symbolFor: (t) => t },
      { source: av, symbolFor: (t) => t },
    ]);

describe("when a price is due", () => {
  const fresh = (minutesAgo: number, now = IN_HOURS) => ({
    fetchedAt: new Date(now.getTime() - minutesAgo * 60_000),
    asOf: now,
    lastFailedAt: null,
  });

  it("is due with nothing cached", () => {
    expect(isDue(undefined, LSE_EVENTS, IN_HOURS, "instrument")).toBe(true);
  });

  it("refreshes every 15 minutes while the market is open", () => {
    expect(isDue(fresh(10), LSE_EVENTS, IN_HOURS, "instrument")).toBe(false);
    expect(isDue(fresh(16), LSE_EVENTS, IN_HOURS, "instrument")).toBe(true);
  });

  it("refreshes once after the close, then waits for the open", () => {
    const evening = new Date("2026-09-16T20:00:00Z");
    expect(
      isDue(
        { ...fresh(0), fetchedAt: new Date("2026-09-16T15:20:00Z") },
        LSE_EVENTS,
        evening,
        "instrument",
      ),
    ).toBe(true);
    expect(
      isDue(
        { ...fresh(0), fetchedAt: new Date("2026-09-16T15:45:00Z") },
        LSE_EVENTS,
        evening,
        "instrument",
      ),
    ).toBe(false);
  });

  it("backs off after a failure", () => {
    const failed = { ...fresh(60), lastFailedAt: new Date(IN_HOURS.getTime() - 60_000) };
    expect(isDue(failed, LSE_EVENTS, IN_HOURS, "instrument")).toBe(false);
    const later = new Date(IN_HOURS.getTime() + TTL.failureBackoffMs);
    expect(isDue(failed, LSE_EVENTS, later, "instrument")).toBe(true);
  });

  it("uses an hour when the schedule is unknown, and 30 minutes for FX", () => {
    expect(isDue(fresh(59), undefined, IN_HOURS, "instrument")).toBe(false);
    expect(isDue(fresh(61), undefined, IN_HOURS, "instrument")).toBe(true);
    expect(isDue(fresh(31), undefined, IN_HOURS, "fx")).toBe(true);
  });
});

describe("refreshing the shared cache", () => {
  it("prices each instrument once, with the FX it needs, and stores today's points", async () => {
    const yahoo = fakeSource("yahoo");
    const result = await refreshDue(db, market(yahoo), ["GRGl_EQ", "NVDA_US_EQ"], IN_HOURS);

    expect(result.refreshed.sort()).toEqual(["FX:GBPUSD", "GRGl_EQ", "NVDA_US_EQ"]);
    const [greggs] = await db.select().from(prices).where(eq(prices.key, "GRGl_EQ"));
    expect(greggs).toMatchObject({
      price: "1741",
      previousClose: "1755",
      currency: "GBX",
      source: "Yahoo Finance",
    });
    expect(await db.select().from(intradaySeries)).toHaveLength(3);
  });

  it("does nothing the second time round", async () => {
    const yahoo = fakeSource("yahoo");
    await refreshDue(db, market(yahoo), ["GRGl_EQ"], IN_HOURS);
    const again = await refreshDue(
      db,
      market(yahoo),
      ["GRGl_EQ"],
      new Date(IN_HOURS.getTime() + 60_000),
    );
    expect(again.refreshed).toEqual([]);
    expect(yahoo.quote).toHaveBeenCalledTimes(1);
  });

  it("names Alpha Vantage as the source when Yahoo is blocked", async () => {
    const yahoo = fakeSource("yahoo", {
      quote: vi.fn(async () => {
        throw new PriceSourceError("yahoo", "blocked", "429");
      }),
    });
    await refreshDue(db, market(yahoo), ["GRGl_EQ"], IN_HOURS);
    const [greggs] = await db.select().from(prices).where(eq(prices.key, "GRGl_EQ"));
    expect(greggs!.source).toBe("Alpha Vantage");
  });

  it("keeps the last good price when every source fails, and marks the failure", async () => {
    await refreshDue(db, market(fakeSource("yahoo")), ["GRGl_EQ"], IN_HOURS);
    const down = fakeSource("yahoo", {
      quote: vi.fn(async () => {
        throw new PriceSourceError("yahoo", "unavailable", "down");
      }),
    });
    const avDown = fakeSource("alpha-vantage", { quote: down.quote });
    const later = new Date(IN_HOURS.getTime() + 20 * 60_000);

    const result = await refreshDue(db, market(down, avDown), ["GRGl_EQ"], later);

    expect(result.failed).toEqual(["GRGl_EQ"]);
    const [greggs] = await db.select().from(prices).where(eq(prices.key, "GRGl_EQ"));
    expect(greggs).toMatchObject({ price: "1741", source: "Yahoo Finance" });
    expect(greggs!.lastFailedAt).toEqual(later);
  });
});

describe("daily call budgets", () => {
  it("stops calling a source once today's budget is spent, and fails over", async () => {
    const av = fakeSource("alpha-vantage");
    const budgeted = withBudget(av, db, { limit: 2, now: () => IN_HOURS });
    const target = { kind: "instrument" as const, symbol: "GRG.LON", currency: "GBX" };

    await budgeted.quote(target);
    await budgeted.quote(target);
    await expect(budgeted.quote(target)).rejects.toMatchObject({ reason: "blocked" });
    expect(av.quote).toHaveBeenCalledTimes(2);

    const [usage] = await db.select().from(sourceUsage);
    expect(usage).toMatchObject({ source: "alpha-vantage", calls: 2 });
  });
});

describe("daily closes", () => {
  const target = { kind: "instrument" as const, symbol: "GRG.L", currency: "GBX" };

  it("fetches what's missing and stores it", async () => {
    const yahoo = fakeSource("yahoo");
    const result = await ensureDailyCloses(
      db,
      market(yahoo)(),
      "GRGl_EQ",
      target,
      new Date("2026-09-14"),
      new Date("2026-09-16T10:00:00Z"),
    );

    expect(result).toEqual({ fetched: 2, source: "Yahoo Finance" });
    expect(await db.select().from(dailyCloses)).toHaveLength(2);
  });

  it("doesn't fetch again when the range is already covered", async () => {
    const yahoo = fakeSource("yahoo");
    const now = new Date("2026-09-16T10:00:00Z");
    await ensureDailyCloses(db, market(yahoo)(), "GRGl_EQ", target, new Date("2026-09-14"), now);
    const again = await ensureDailyCloses(
      db,
      market(yahoo)(),
      "GRGl_EQ",
      target,
      new Date("2026-09-14"),
      now,
    );
    expect(again).toEqual({ fetched: 0 });
    expect(yahoo.dailyCloses).toHaveBeenCalledTimes(1);
  });
});
