import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cash,
  dailyCloses,
  dailyValues,
  holdings,
  instruments,
  intradaySeries,
  marketSchedules,
  prices,
  providerCredentials,
  trades,
  users,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { withFallback } from "../market/sources/fallback.js";
import type { PriceSource } from "../market/sources/types.js";
import { testDatabase } from "../test-support/pglite.js";
import { liveReadModel } from "./live.js";

// Wednesday 16 Sep 2026, 14:00 UTC — London and US markets open.
const NOW = new Date("2026-09-16T14:00:00Z");
const ALICE = { authUserId: "55555555-5555-4555-8555-555555555555", userId: "" };
const BOB = { authUserId: "66666666-6666-4666-8666-666666666666", userId: "" };

let db: Db;
let close: () => Promise<void>;

const source: PriceSource = {
  id: "yahoo",
  label: "Yahoo Finance",
  quote: vi.fn(async () => {
    throw new Error("prices are seeded fresh; nothing should be fetched");
  }),
  dailyCloses: async () => [],
};
const model = () =>
  liveReadModel({
    db,
    marketFor: () => withFallback([{ source, symbolFor: (target) => target }]),
    now: () => NOW,
    refreshWaitMs: 50,
  });

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
});
afterAll(async () => close());

beforeEach(async () => {
  for (const table of [
    dailyValues,
    holdings,
    cash,
    providerCredentials,
    prices,
    intradaySeries,
    dailyCloses,
    instruments,
    marketSchedules,
    users,
  ]) {
    await db.delete(table);
  }
  for (const person of [ALICE, BOB]) {
    const [row] = await db
      .insert(users)
      .values({ email: `${person.authUserId}@example.test`, authUserId: person.authUserId })
      .returning();
    person.userId = row!.id;
  }
  await db.insert(marketSchedules).values({
    scheduleId: 55,
    exchangeName: "London Stock Exchange",
    events: [
      { date: "2026-09-16T07:00:31.000Z", type: "OPEN" },
      { date: "2026-09-16T15:30:00.000Z", type: "CLOSE" },
      { date: "2026-09-17T07:00:31.000Z", type: "OPEN" },
    ],
  });
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
    },
    {
      id: "NVDA_US_EQ",
      isin: "US67066G1040",
      name: "Nvidia",
      shortName: "NVDA",
      currency: "USD",
      type: "STOCK",
      yahooSymbol: "NVDA",
    },
  ]);
  const fresh = {
    source: "Yahoo Finance",
    asOf: new Date(NOW.getTime() - 4 * 60_000),
    fetchedAt: NOW,
  };
  await db.insert(prices).values([
    { key: "GRGl_EQ", price: "1750", previousClose: "1700", currency: "GBX", ...fresh },
    { key: "NVDA_US_EQ", price: "200", previousClose: "190", currency: "USD", ...fresh },
    { key: "FX:GBPUSD", price: "1.25", previousClose: "1.25", currency: "USD", ...fresh },
  ]);

  // Alice: an ISA with 10 Greggs (cost £165) and 5 Nvidia (cost £700), £20 cash, history done.
  const [credential] = await db
    .insert(providerCredentials)
    .values({
      userId: ALICE.userId,
      provider: "trading212",
      accountKind: "isa",
      sealedKey: "pip:1:x:y:z",
      sealedSecret: "pip:1:x:y:z",
      keyVersion: 1,
      status: "live",
      accountCurrency: "GBP",
      lastPolledAt: NOW,
      backfillStatus: "done",
    })
    .returning();
  await db.insert(holdings).values([
    {
      credentialId: credential!.id,
      userId: ALICE.userId,
      instrumentId: "GRGl_EQ",
      quantity: "10",
      averagePricePaid: "1650",
      totalCostPence: 16_500,
      polledAt: NOW,
    },
    {
      credentialId: credential!.id,
      userId: ALICE.userId,
      instrumentId: "NVDA_US_EQ",
      quantity: "5",
      averagePricePaid: "175",
      totalCostPence: 70_000,
      polledAt: NOW,
    },
  ]);
  await db.insert(cash).values({
    credentialId: credential!.id,
    userId: ALICE.userId,
    availablePence: 2_000,
    reservedPence: 0,
    inPiesPence: 0,
    polledAt: NOW,
  });
});

describe("the live portfolio", () => {
  it("values holdings from market prices in pounds, and adds cash", async () => {
    const summary = await model().portfolio(ALICE, "day");
    // Greggs 10 × 1750p = £175; Nvidia 5 × $200 / 1.25 = £800; cash £20.
    expect(summary.total).toBe(17_500 + 80_000 + 2_000);
    const foundation = summary.buckets.find((b) => b.bucket === "Base")!;
    expect(foundation).toMatchObject({
      status: "live",
      value: 99_500,
      targetPercent: 70,
      shareOfTotal: 100,
    });
  });

  it("states today in pounds from the previous close", async () => {
    const summary = await model().portfolio(ALICE, "day");
    // Greggs +50p × 10 = £5; Nvidia +$10 × 5 / 1.25 = £40.
    // Against the previous close: £170 + £760 = £930.
    expect(summary.change).toEqual({ amount: 4_500, percent: 4.84, direction: "up" });
    expect(summary.verdict).toBe("Up £45.00 today. Nothing needs you.");
  });

  it("measures today from what was paid for something first bought today", async () => {
    const [credential] = await db.select().from(providerCredentials);
    await db.insert(trades).values({
      credentialId: credential!.id,
      userId: ALICE.userId,
      fillId: "today",
      instrumentId: "GRGl_EQ",
      side: "BUY",
      quantity: "10",
      price: "1650",
      netValuePence: 16_500,
      feesPence: 0,
      filledAt: new Date("2026-09-16T09:00:00Z"),
    });
    const detail = await model().bucket(ALICE, "Base", "day");
    // Bought today for £165, worth £175: today is +£10, not +£5 from yesterday's close.
    expect(detail.holdings.find((h) => h.id === "GRGl_EQ")!.today.amount).toBe(1_000);
  });

  it("states all time against what was paid, not counting cash", async () => {
    const summary = await model().portfolio(ALICE, "all");
    expect(summary.change).toEqual({ amount: 97_500 - 86_500, percent: 12.72, direction: "up" });
  });

  it("says 'this month' can't be stated yet without a month of history", async () => {
    const summary = await model().portfolio(ALICE, "month");
    expect(summary.changeUnavailable).toBe(true);
    expect(summary.verdict).toBe("Pip is still gathering your history.");
  });

  it("states 'this month' against the value a month ago once there is one", async () => {
    await db.insert(dailyValues).values({
      userId: ALICE.userId,
      bucket: "Base",
      day: "2026-08-14",
      valuePence: 90_000,
      costPence: 86_500,
      source: "backfill",
    });
    const summary = await model().portfolio(ALICE, "month");
    expect(summary.changeUnavailable).toBe(false);
    expect(summary.change.amount).toBe(97_500 - 90_000);
  });

  it("shows Side Bet as not connected and leaves it out of totals", async () => {
    const summary = await model().portfolio(ALICE, "day");
    const sideBet = summary.buckets.find((b) => b.bucket === "Degen")!;
    expect(sideBet).toMatchObject({ status: "not_connected", value: 0, shareOfTotal: 0 });
    expect(summary.activityComingSoon).toBe(true);
  });

  it("names the market source and sees markets open", async () => {
    const summary = await model().portfolio(ALICE, "day");
    const freshness = summary.freshness.find((f) => f.bucket === "Base")!.freshness;
    expect(freshness).toMatchObject({
      source: "Yahoo Finance",
      failed: false,
      marketsClosed: false,
    });
    expect(JSON.stringify(summary)).not.toMatch(/Trading 212 price|currentValue/);
  });

  it("doesn't call a closed market's closing price stale, even hours later", async () => {
    // Greggs last traded at London's close, 4 hours before Nvidia's latest price.
    await db
      .update(prices)
      .set({ asOf: new Date("2026-09-16T15:30:00Z") })
      .where(eq(prices.key, "GRGl_EQ"));
    const evening = liveReadModel({
      db,
      marketFor: () => withFallback([{ source, symbolFor: (target) => target }]),
      now: () => new Date("2026-09-16T19:30:00Z"),
      refreshWaitMs: 50,
    });
    await db
      .update(prices)
      .set({ asOf: new Date("2026-09-16T19:26:00Z"), fetchedAt: new Date("2026-09-16T19:30:00Z") })
      .where(eq(prices.key, "NVDA_US_EQ"));

    const summary = await evening.portfolio(ALICE, "day");
    const freshness = summary.freshness.find((f) => f.bucket === "Base")!.freshness;
    expect(freshness.asOf).toBe("2026-09-16T19:26:00.000Z");
    expect(freshness.marketsClosed).toBe(false);
  });

  it("gives freshness only for pots that have a source", async () => {
    const summary = await model().portfolio(ALICE, "day");
    expect(summary.freshness.map((f) => f.bucket)).toEqual(["Base"]);
  });

  it("marks prices failed when the last refresh failed", async () => {
    await db.update(prices).set({ lastFailedAt: NOW });
    const summary = await model().portfolio(ALICE, "day");
    expect(summary.freshness.find((f) => f.bucket === "Base")!.freshness.failed).toBe(true);
  });

  it("shows another user nothing of Alice's", async () => {
    const summary = await model().portfolio(BOB, "day");
    expect(summary.total).toBe(0);
    expect(summary.buckets.every((b) => b.status === "not_connected")).toBe(true);
  });
});

describe("a live pot", () => {
  it("lists holdings with their own changes, and cash as a row with no page", async () => {
    const detail = await model().bucket(ALICE, "Base", "day");
    const greggs = detail.holdings.find((h) => h.id === "GRGl_EQ")!;
    expect(greggs).toMatchObject({
      value: 17_500,
      today: { amount: 500 },
      sinceBought: { amount: 1_000 },
    });
    expect(detail.holdings.find((h) => h.name === "Cash")).toMatchObject({
      value: 2_000,
      linkable: false,
    });
    expect(detail.moneyIn).toEqual({ months: [], caption: "", comingSoon: true });
  });

  it("draws the chart from daily values, with a sentence", async () => {
    await db.insert(dailyValues).values([
      {
        userId: ALICE.userId,
        bucket: "Base",
        day: "2026-09-10",
        valuePence: 90_000,
        costPence: 86_500,
        source: "backfill",
      },
      {
        userId: ALICE.userId,
        bucket: "Base",
        day: "2026-09-15",
        valuePence: 95_000,
        costPence: 86_500,
        source: "snapshot",
      },
    ]);
    const detail = await model().bucket(ALICE, "Base", "day");
    expect(detail.chart.series.map((p) => p.value)).toEqual([90_000, 95_000]);
    expect(detail.chart.caption).toBe(
      "Your investments here are up £50.00 since 10 Sep, not counting cash.",
    );
    expect(detail.chart.from).toBe("Sep 2026");
  });
});

describe("a live holding", () => {
  it("prices one unit in pence of pounds and draws today from intraday points", async () => {
    await db.insert(intradaySeries).values({
      key: "NVDA_US_EQ",
      points: [
        { at: "2026-09-16T13:30:00.000Z", price: "195" },
        { at: "2026-09-16T14:00:00.000Z", price: "200" },
      ],
      currency: "USD",
      source: "Yahoo Finance",
      asOf: NOW,
    });
    const detail = await model().instrument(ALICE, "NVDA_US_EQ", "day");
    expect(detail).toMatchObject({ price: 16_000, value: 80_000, quantity: "5 shares", note: "" });
    expect(detail!.series.map((p) => p.value)).toEqual([15_600, 16_000]);
  });

  it("is a 404 for something the user doesn't hold, even if someone else does", async () => {
    expect(await model().instrument(BOB, "NVDA_US_EQ", "day")).toBeNull();
  });
});

describe("live rules", () => {
  it("states where each connected pot sits, and that Side Bet isn't counted yet", async () => {
    const view = await model().rules(ALICE);
    expect(view.rules.find((r) => r.bucket === "Base")).toMatchObject({
      actualPercent: 100,
      available: true,
      plain: "Foundation is 100% of your money, against the 70% you set.",
    });
    expect(view.rules.find((r) => r.bucket === "Degen")).toMatchObject({
      available: false,
      actualPercent: 0,
    });
    expect(view.rules.some((r) => r.overBy)).toBe(false);
    expect(view.monthlySplit.comingSoon).toBe(true);
  });
});
