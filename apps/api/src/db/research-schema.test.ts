import {
  BUCKETS,
  DEFAULT_TRUST_SETTINGS,
  NUDGE_CADENCES,
  NUDGE_KINDS,
  NUDGE_REASONS,
  NUDGE_RESPONSES,
  PROFILE_LIMITS,
  TRUST_LIMITS,
} from "@finance-app/shared";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabase } from "../test-support/pglite.js";
import {
  DB_BUCKETS,
  DB_NUDGE_CADENCES,
  DB_NUDGE_KINDS,
  DB_NUDGE_REASONS,
  DB_NUDGE_RESPONSES,
  DB_PROFILE_LIMITS,
  DB_TRUST_LIMITS,
  digests,
  factsEvents,
  factsFetches,
  factsNews,
  factsNewsInstruments,
  instruments,
  nudges,
  trustSettings,
  userProfiles,
  users,
} from "./schema.js";
import { asUser, type Db } from "./user-scope.js";

/**
 * Phase 5 storage: the database refuses what the API refuses, and each person
 * sees only their own profile, trust rules, weeks and nudges — while the facts
 * behind them are shared, like prices.
 */

describe("the database's limits are the shared constants", () => {
  it("match exactly", () => {
    expect(DB_BUCKETS).toEqual(BUCKETS);
    expect(DB_NUDGE_CADENCES).toEqual(NUDGE_CADENCES);
    expect(DB_NUDGE_KINDS).toEqual(NUDGE_KINDS);
    expect(DB_NUDGE_REASONS).toEqual(NUDGE_REASONS);
    expect(DB_NUDGE_RESPONSES).toEqual(NUDGE_RESPONSES);
    expect(DB_TRUST_LIMITS).toEqual(TRUST_LIMITS);
    // Each exclusion's length is the API's to check; the database counts them.
    expect(DB_PROFILE_LIMITS).toEqual({
      textMax: PROFILE_LIMITS.textMax,
      horizonYears: PROFILE_LIMITS.horizonYears,
      exclusionsMax: PROFILE_LIMITS.exclusionsMax,
    });
  });
});

const ALICE = "44444444-4444-4444-8444-444444444444";
const BOB = "55555555-5555-4555-8555-555555555555";
const ids: Record<string, string> = {};
let db: Db;
let close: () => Promise<void>;

function trustRow(userId: string, overrides: Partial<typeof trustSettings.$inferInsert> = {}) {
  const d = DEFAULT_TRUST_SETTINGS;
  return {
    userId,
    namedPublishers: d.namedPublishers,
    recencyDays: d.recencyDays,
    minSources: d.minSources,
    resultsQuietDays: d.resultsQuietDays,
    weeklyBudget: d.weeklyBudget,
    dailyBudgetPerDay: d.dailyBudgetPerDay,
    dailyBudgetPerWeek: d.dailyBudgetPerWeek,
    bigMoveBase: d.bigMovePercent.Base,
    bigMoveMedium: d.bigMovePercent.Medium,
    bigMoveDegen: d.bigMovePercent.Degen,
    ...overrides,
  };
}

function nudgeRow(userId: string, overrides: Partial<typeof nudges.$inferInsert> = {}) {
  return {
    userId,
    cadence: "daily",
    kind: "awareness",
    reason: "news",
    bucket: "Medium",
    instrumentId: "ASMLa_EQ",
    title: "ASML plans to make more EUV tools",
    body: "Two named publishers reported it.",
    facts: [],
    checks: [],
    shown: true,
    model: "stub",
    personalised: false,
    ...overrides,
  };
}

/** The database's refusal, whether Drizzle wraps it or not. */
async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return String((cause as Error | undefined)?.message ?? (error as Error).message);
  }
  throw new Error("expected the database to refuse");
}

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
  await db.insert(instruments).values({
    id: "ASMLa_EQ",
    isin: "NL0010273215",
    name: "ASML",
    shortName: "ASML",
    currency: "EUR",
    type: "STOCK",
  });
});
afterAll(async () => close());

beforeEach(async () => {
  await db.delete(nudges);
  await db.delete(digests);
  await db.delete(trustSettings);
  await db.delete(userProfiles);
  await db.delete(factsNewsInstruments);
  await db.delete(factsNews);
  await db.delete(factsEvents);
  await db.delete(factsFetches);
  await db.delete(users);
  for (const [name, authUserId] of [
    ["alice", ALICE],
    ["bob", BOB],
  ] as const) {
    const [row] = await db
      .insert(users)
      .values({ email: `${name}@example.test`, authUserId })
      .returning({ id: users.id });
    ids[name] = row!.id;
  }
});

describe("users", () => {
  it("don't get personalised research unless someone turns it on", async () => {
    const [alice] = await db.select().from(users).where(eq(users.id, ids.alice!));
    expect(alice!.personalResearch).toBe(false);
  });
});

describe("trust settings", () => {
  it("accept the defaults", async () => {
    await db.insert(trustSettings).values(trustRow(ids.alice!));
    expect(await db.select().from(trustSettings)).toHaveLength(1);
  });

  it.each([
    ["no publishers at all", { namedPublishers: [] }, "trust_settings_publishers"],
    ["a recency of 15 days", { recencyDays: 15 }, "trust_settings_recency"],
    ["zero sources", { minSources: 0 }, "trust_settings_min_sources"],
    ["six sources", { minSources: 6 }, "trust_settings_min_sources"],
    ["an 8-day quiet period", { resultsQuietDays: 8 }, "trust_settings_quiet"],
    ["no weekly budget", { weeklyBudget: 0 }, "trust_settings_weekly"],
    ["4 daily nudges a day", { dailyBudgetPerDay: 4 }, "trust_settings_daily"],
    ["8 daily nudges a week", { dailyBudgetPerWeek: 8 }, "trust_settings_daily_week"],
    ["a 0% big move", { bigMoveBase: 0 }, "trust_settings_move_base"],
    ["a 51% big move", { bigMoveDegen: 51 }, "trust_settings_move_degen"],
  ])("refuse %s", async (_name, overrides, constraint) => {
    expect(await refusal(db.insert(trustSettings).values(trustRow(ids.alice!, overrides)))).toMatch(
      constraint,
    );
  });
});

describe("profiles", () => {
  it("default to empty", async () => {
    await db.insert(userProfiles).values({ userId: ids.alice! });
    const [row] = await db.select().from(userProfiles);
    expect(row).toMatchObject({ goals: "", riskWords: "", exclusions: [], horizonYears: null });
  });

  it.each([
    ["goals over 280 characters", { goals: "x".repeat(281) }, "user_profiles_goals_length"],
    ["risk words over 280", { riskWords: "x".repeat(281) }, "user_profiles_risk_length"],
    ["a 61-year horizon", { horizonYears: 61 }, "user_profiles_horizon"],
    ["negative money in", { monthlyInPence: -1 }, "user_profiles_monthly_in"],
    [
      "21 exclusions",
      { exclusions: Array.from({ length: 21 }, (_, i) => `thing ${i}`) },
      "user_profiles_exclusions_count",
    ],
  ])("refuse %s", async (_name, overrides, constraint) => {
    expect(
      await refusal(db.insert(userProfiles).values({ userId: ids.alice!, ...overrides })),
    ).toMatch(constraint);
  });
});

describe("weeks and nudges", () => {
  it("only start a week on a Monday", async () => {
    expect(
      await refusal(
        db
          .insert(digests)
          .values({ userId: ids.alice!, weekOf: "2026-09-16", opening: "", counts: {} }),
      ),
    ).toMatch("digests_week_of_monday");
  });

  it("keep one week per person per Monday", async () => {
    const week = {
      userId: ids.alice!,
      weekOf: "2026-09-14",
      opening: "Here's your week.",
      counts: {},
    };
    await db.insert(digests).values(week);
    expect(await refusal(db.insert(digests).values(week))).toMatch("unique");
  });

  it("log a weekly nudge only inside a week, and a daily one only outside", async () => {
    const [week] = await db
      .insert(digests)
      .values({ userId: ids.alice!, weekOf: "2026-09-14", opening: "", counts: {} })
      .returning();
    await db.insert(nudges).values(nudgeRow(ids.alice!, { cadence: "weekly", digestId: week!.id }));
    expect(
      await refusal(db.insert(nudges).values(nudgeRow(ids.alice!, { cadence: "weekly" }))),
    ).toMatch("nudges_weekly_in_a_week");
    expect(
      await refusal(db.insert(nudges).values(nudgeRow(ids.alice!, { digestId: week!.id }))),
    ).toMatch("nudges_weekly_in_a_week");
  });

  it.each([
    ["a reason from another kind", { kind: "shape", reason: "news" }, "nudges_kind_reason"],
    ["an unknown kind", { kind: "buy", reason: "news" }, "nudges_kind"],
    ["a display name for a pot", { bucket: "Side Bet" }, "nudges_bucket"],
    ["an unknown response", { response: "sold" }, "nudges_response"],
  ])("refuse %s", async (_name, overrides, constraint) => {
    expect(await refusal(db.insert(nudges).values(nudgeRow(ids.alice!, overrides)))).toMatch(
      constraint,
    );
  });

  it("keep the outcome fields for later, empty to start", async () => {
    await db
      .insert(nudges)
      .values(nudgeRow(ids.alice!, { priceAt: "612.4", priceCurrency: "EUR" }));
    const [row] = await db.select().from(nudges);
    expect(row).toMatchObject({ priceAt: "612.4", price7d: null, price30d: null, response: null });
  });
});

describe("reading as a signed-in user", () => {
  beforeEach(async () => {
    for (const name of ["alice", "bob"] as const) {
      const userId = ids[name]!;
      await db.insert(userProfiles).values({ userId, goals: `${name}'s goals` });
      await db.insert(trustSettings).values(trustRow(userId));
      const [week] = await db
        .insert(digests)
        .values({ userId, weekOf: "2026-09-14", opening: `${name}'s week`, counts: {} })
        .returning();
      await db
        .insert(nudges)
        .values(
          nudgeRow(userId, { cadence: "weekly", digestId: week!.id, title: `${name}'s nudge` }),
        );
    }
    await db.insert(factsNews).values({
      id: "a".repeat(64),
      source: "stub",
      publisher: "Reuters",
      publisherDomain: "reuters.com",
      headline: "ASML plans to make more EUV tools",
      url: "https://example.test/asml",
      publishedAt: new Date("2026-09-14T14:19:44Z"),
    });
    await db
      .insert(factsNewsInstruments)
      .values({ newsId: "a".repeat(64), instrumentId: "ASMLa_EQ" });
    await db
      .insert(factsEvents)
      .values({ instrumentId: "ASMLa_EQ", kind: "earnings", onDate: "2026-10-14", source: "stub" });
    await db.insert(factsFetches).values({
      source: "google-news",
      kind: "news",
      target: "ASMLa_EQ",
      lastFetchedAt: new Date(),
    });
  });

  it("sees only their own profile, trust rules, weeks and nudges", async () => {
    const seen = await asUser(db, ALICE, async (tx) => ({
      profiles: await tx.select({ goals: userProfiles.goals }).from(userProfiles),
      trust: await tx.select({ userId: trustSettings.userId }).from(trustSettings),
      weeks: await tx.select({ opening: digests.opening }).from(digests),
      nudges: await tx.select({ title: nudges.title }).from(nudges),
    }));
    expect(seen).toEqual({
      profiles: [{ goals: "alice's goals" }],
      trust: [{ userId: ids.alice }],
      weeks: [{ opening: "alice's week" }],
      nudges: [{ title: "alice's nudge" }],
    });
  });

  it("reads the shared facts", async () => {
    const seen = await asUser(db, BOB, async (tx) => ({
      news: await tx.select({ publisher: factsNews.publisher }).from(factsNews),
      links: await tx.select().from(factsNewsInstruments),
      events: await tx.select({ onDate: factsEvents.onDate }).from(factsEvents),
    }));
    expect(seen.news).toEqual([{ publisher: "Reuters" }]);
    expect(seen.links).toHaveLength(1);
    expect(seen.events).toEqual([{ onDate: "2026-10-14" }]);
  });

  it("can't read the collector's bookkeeping", async () => {
    await expect(asUser(db, ALICE, (tx) => tx.select().from(factsFetches))).rejects.toThrow();
  });

  it("can't mark a nudge, change a profile or trust rule, or plant a fact directly", async () => {
    await expect(
      asUser(db, ALICE, (tx) => tx.update(nudges).set({ response: "acted" })),
    ).rejects.toThrow();
    await expect(
      asUser(db, ALICE, (tx) => tx.update(userProfiles).set({ goals: "changed" })),
    ).rejects.toThrow();
    await expect(
      asUser(db, ALICE, (tx) => tx.update(trustSettings).set({ minSources: 1 })),
    ).rejects.toThrow();
    await expect(
      asUser(db, ALICE, (tx) =>
        tx.execute(
          sql`insert into facts_news (id, source, publisher, publisher_domain, headline, url, published_at)
              values ('b', 'x', 'x', 'x', 'x', 'x', now())`,
        ),
      ),
    ).rejects.toThrow();
  });
});
