import {
  DEFAULT_NOTIFICATION_SETTINGS,
  JOB_NAMES,
  NOTIFICATION_ITEM_KINDS,
  PUSH_KINDS,
  RECOMMENDATIONS,
  RECOMMENDATION_STATES,
  RECOMMENDATION_TRIGGERS,
} from "@finance-app/shared";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { testDatabase } from "../test-support/pglite.js";
import {
  connectionGaps,
  DB_JOB_NAMES,
  DB_NOTIFICATION_ITEM_KINDS,
  DB_PUSH_KINDS,
  DB_RECOMMENDATIONS,
  DB_RECOMMENDATION_STATES,
  DB_RECOMMENDATION_TRIGGERS,
  jobRuns,
  limitAlerts,
  netAssets,
  notificationReads,
  notificationSettings,
  nudges,
  pushDeliveries,
  pushSubscriptions,
  recommendationState,
  users,
} from "./schema.js";
import { asUser, type Db } from "./user-scope.js";

/**
 * Phase 6 storage: the database refuses what the API refuses, one event makes
 * one push, and nobody reads anyone else's notifications — or their own
 * devices' push keys and sealed net assets, which only Fastify ever sees.
 */

describe("the database's lists are the shared constants", () => {
  it("match exactly", () => {
    expect(DB_PUSH_KINDS).toEqual(PUSH_KINDS);
    expect(DB_NOTIFICATION_ITEM_KINDS).toEqual(NOTIFICATION_ITEM_KINDS);
    expect(DB_RECOMMENDATIONS).toEqual(RECOMMENDATIONS);
    expect(DB_RECOMMENDATION_TRIGGERS).toEqual(RECOMMENDATION_TRIGGERS);
    expect(DB_RECOMMENDATION_STATES).toEqual(RECOMMENDATION_STATES);
    expect(DB_JOB_NAMES).toEqual(JOB_NAMES);
  });
});

const ALICE = "66666666-6666-4666-8666-666666666666";
const BOB = "77777777-7777-4777-8777-777777777777";
const ids: Record<string, string> = {};
let db: Db;
let close: () => Promise<void>;

function deviceRow(userId: string, overrides: Partial<typeof pushSubscriptions.$inferInsert> = {}) {
  return {
    userId,
    endpoint: `https://web.push.apple.com/${Math.random()}`,
    p256dh: "BPl-key",
    auth: "auth-secret",
    label: "iPhone",
    ...overrides,
  };
}

function alertRow(userId: string, overrides: Partial<typeof limitAlerts.$inferInsert> = {}) {
  return {
    userId,
    threshold: 80,
    windowStart: "2026-09-01",
    moneyInPence: 28_000,
    limitPence: 35_000,
    starterLimit: true,
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
});
afterAll(async () => close());

beforeEach(async () => {
  await db.delete(pushDeliveries);
  await db.delete(pushSubscriptions);
  await db.delete(notificationSettings);
  await db.delete(notificationReads);
  await db.delete(connectionGaps);
  await db.delete(limitAlerts);
  await db.delete(recommendationState);
  await db.delete(netAssets);
  await db.delete(jobRuns);
  await db.delete(nudges);
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

describe("notification settings", () => {
  it("start as the shared defaults, with the sheet not yet answered", async () => {
    await db.insert(notificationSettings).values({ userId: ids.alice! });
    const [row] = await db.select().from(notificationSettings);
    expect(row).toMatchObject({
      push: DEFAULT_NOTIFICATION_SETTINGS.push,
      pushLimit: DEFAULT_NOTIFICATION_SETTINGS.pushLimit,
      pushUrgent: DEFAULT_NOTIFICATION_SETTINGS.pushUrgent,
      pushDigest: DEFAULT_NOTIFICATION_SETTINGS.pushDigest,
      email: DEFAULT_NOTIFICATION_SETTINGS.email,
      askedAt: null,
    });
  });

  it("keep one row per person", async () => {
    await db.insert(notificationSettings).values({ userId: ids.alice! });
    expect(await refusal(db.insert(notificationSettings).values({ userId: ids.alice! }))).toMatch(
      /unique|duplicate key/,
    );
  });
});

describe("devices", () => {
  it("allow several per person, and the same endpoint only once anywhere", async () => {
    const endpoint = "https://web.push.apple.com/shared";
    await db.insert(pushSubscriptions).values(deviceRow(ids.alice!, { label: "iPhone" }));
    await db.insert(pushSubscriptions).values(deviceRow(ids.alice!, { label: "Mac" }));
    await db.insert(pushSubscriptions).values(deviceRow(ids.alice!, { endpoint }));

    expect(await db.select().from(pushSubscriptions)).toHaveLength(3);
    expect(
      await refusal(db.insert(pushSubscriptions).values(deviceRow(ids.bob!, { endpoint }))),
    ).toMatch(/unique|duplicate key/);
  });

  it("refuse an endpoint that isn't a push service's https address", async () => {
    expect(
      await refusal(
        db
          .insert(pushSubscriptions)
          .values(deviceRow(ids.alice!, { endpoint: "http://evil.test" })),
      ),
    ).toMatch("push_subscriptions_https");
  });

  it("go when the person does", async () => {
    await db.insert(pushSubscriptions).values(deviceRow(ids.alice!));
    await db.delete(users).where(eq(users.id, ids.alice!));
    expect(await db.select().from(pushSubscriptions)).toHaveLength(0);
  });
});

describe("pushes", () => {
  const delivery = (userId: string, overrides = {}) => ({
    userId,
    kind: "limit",
    dedupeKey: "limit:80:2026-09-01",
    sentOn: "2026-09-17",
    ...overrides,
  });

  it("send one push per event, however many times the job runs", async () => {
    await db.insert(pushDeliveries).values(delivery(ids.alice!));
    expect(await refusal(db.insert(pushDeliveries).values(delivery(ids.alice!)))).toMatch(
      /unique|duplicate key/,
    );
    // The same event for someone else, and the next threshold, are both new.
    await db.insert(pushDeliveries).values(delivery(ids.bob!));
    await db
      .insert(pushDeliveries)
      .values(delivery(ids.alice!, { dedupeKey: "limit:100:2026-09-01" }));
    expect(await db.select().from(pushDeliveries)).toHaveLength(3);
  });

  it("refuse a kind Pip doesn't send", async () => {
    expect(
      await refusal(db.insert(pushDeliveries).values(delivery(ids.alice!, { kind: "drift" }))),
    ).toMatch("push_deliveries_kind");
  });
});

describe("the bell", () => {
  it("marks one item read once, per person", async () => {
    const mark = { userId: ids.alice!, itemKind: "nudge", itemId: ALICE };
    await db.insert(notificationReads).values(mark);
    expect(await refusal(db.insert(notificationReads).values(mark))).toMatch(
      /unique|duplicate key/,
    );
    await db.insert(notificationReads).values({ ...mark, userId: ids.bob! });
    expect(await db.select().from(notificationReads)).toHaveLength(2);
  });

  it("refuses a kind of row the bell doesn't have", async () => {
    expect(
      await refusal(
        db
          .insert(notificationReads)
          .values({ userId: ids.alice!, itemKind: "milestone", itemId: ALICE }),
      ),
    ).toMatch("notification_reads_item_kind");
  });

  it("records a connection gap that can still be open", async () => {
    await db.insert(connectionGaps).values({
      userId: ids.alice!,
      provider: "kraken",
      startedAt: new Date("2026-09-17T06:40:00Z"),
    });
    const [row] = await db.select().from(connectionGaps);
    expect(row).toMatchObject({ provider: "kraken", endedAt: null });
  });

  it.each([
    ["a provider Pip doesn't read", { provider: "coinbase" }, "connection_gaps_provider"],
    [
      "a gap that ends before it starts",
      { endedAt: new Date("2026-09-17T05:00:00Z") },
      "connection_gaps_ends_after_it_starts",
    ],
  ])("refuses %s", async (_name, overrides, constraint) => {
    expect(
      await refusal(
        db.insert(connectionGaps).values({
          userId: ids.alice!,
          provider: "kraken",
          startedAt: new Date("2026-09-17T06:40:00Z"),
          ...overrides,
        }),
      ),
    ).toMatch(constraint);
  });
});

describe("Side Bet's limit", () => {
  it("alerts at each threshold once per window, and again in the next window", async () => {
    await db.insert(limitAlerts).values(alertRow(ids.alice!));
    expect(await refusal(db.insert(limitAlerts).values(alertRow(ids.alice!)))).toMatch(
      /unique|duplicate key/,
    );
    await db.insert(limitAlerts).values(alertRow(ids.alice!, { threshold: 100 }));
    await db.insert(limitAlerts).values(alertRow(ids.alice!, { windowStart: "2027-09-01" }));
    expect(await db.select().from(limitAlerts)).toHaveLength(3);
  });

  it.each([
    ["a threshold Pip doesn't alert at", { threshold: 90 }, "limit_alerts_threshold"],
    ["money in below zero", { moneyInPence: -1 }, "limit_alerts_money_in"],
    ["a limit of nothing", { limitPence: 0 }, "limit_alerts_limit"],
  ])("refuses %s", async (_name, overrides, constraint) => {
    expect(await refusal(db.insert(limitAlerts).values(alertRow(ids.alice!, overrides)))).toMatch(
      constraint,
    );
  });

  it("keeps net assets sealed, with a key version and a review date", async () => {
    await db.insert(netAssets).values({
      userId: ids.alice!,
      sealedAmount: "v1.sealed",
      masterKeyVersion: 1,
    });
    const [row] = await db.select().from(netAssets);
    expect(row).toMatchObject({ sealedAmount: "v1.sealed", masterKeyVersion: 1 });
    expect(row!.reviewedAt).toBeInstanceOf(Date);
  });
});

describe("recommendation triggers", () => {
  const state = (userId: string, overrides = {}) => ({
    userId,
    trigger: "holding_multiple",
    subject: "NVDA_US_EQ",
    state: "clear",
    ...overrides,
  });

  it("hold one state per trigger and subject", async () => {
    await db.insert(recommendationState).values(state(ids.alice!));
    expect(await refusal(db.insert(recommendationState).values(state(ids.alice!)))).toMatch(
      /unique|duplicate key/,
    );
    await db.insert(recommendationState).values(state(ids.alice!, { subject: "ASMLa_EQ" }));
    await db
      .insert(recommendationState)
      .values(state(ids.alice!, { trigger: "urgent_move", subject: "NVDA_US_EQ" }));
    expect(await db.select().from(recommendationState)).toHaveLength(3);
  });

  it("only carry an event id once a crossing is confirmed", async () => {
    expect(
      await refusal(db.insert(recommendationState).values(state(ids.alice!, { state: "fired" }))),
    ).toMatch("recommendation_state_event_when_fired");
    expect(
      await refusal(db.insert(recommendationState).values(state(ids.alice!, { eventId: ALICE }))),
    ).toMatch("recommendation_state_event_when_fired");

    await db
      .insert(recommendationState)
      .values(state(ids.alice!, { state: "fired", eventId: ALICE }));
    expect(await db.select().from(recommendationState)).toHaveLength(1);
  });

  it.each([
    ["a trigger that doesn't exist", { trigger: "gut_feel" }, "recommendation_state_trigger"],
    ["a state that doesn't exist", { state: "maybe" }, "recommendation_state_state"],
  ])("refuse %s", async (_name, overrides, constraint) => {
    expect(
      await refusal(db.insert(recommendationState).values(state(ids.alice!, overrides))),
    ).toMatch(constraint);
  });
});

describe("nudges with Pip's take", () => {
  const nudgeRow = (userId: string, overrides = {}) => ({
    userId,
    cadence: "daily",
    kind: "awareness",
    reason: "move",
    bucket: "Medium",
    title: "Nvidia is worth 3.2× what you put in",
    body: "Taking out £1,200 gets your stake back. Your call.",
    facts: [],
    checks: [],
    shown: true,
    model: "stub",
    personalised: true,
    dedupeKey: `multiple:NVDA:${Math.random()}`,
    builtOn: "2026-09-17",
    ...overrides,
  });

  it("are not urgent and carry no recommendation unless Pip says so", async () => {
    await db.insert(nudges).values(nudgeRow(ids.alice!));
    const [row] = await db.select().from(nudges);
    expect(row).toMatchObject({ urgent: false, recommendation: null, trigger: null });
  });

  it("record what was recommended and why", async () => {
    await db.insert(nudges).values(
      nudgeRow(ids.alice!, {
        urgent: true,
        recommendation: "take_some_profit",
        trigger: "holding_multiple",
      }),
    );
    const [row] = await db.select().from(nudges);
    expect(row).toMatchObject({
      urgent: true,
      recommendation: "take_some_profit",
      trigger: "holding_multiple",
    });
  });

  it.each([
    ["buy or sell as a course of action", { recommendation: "sell", trigger: "urgent_move" }],
    ["a recommendation with no trigger", { recommendation: "hold" }],
    ["a trigger with no recommendation", { trigger: "urgent_move" }],
  ])("refuse %s", async (_name, overrides) => {
    expect(await refusal(db.insert(nudges).values(nudgeRow(ids.alice!, overrides)))).toMatch(
      /nudges_recommendation|nudges_trigger/,
    );
  });
});

describe("job runs", () => {
  it("record a clean run with nothing failed", async () => {
    await db.insert(jobRuns).values({ job: "refresh" });
    const [row] = await db.select().from(jobRuns);
    expect(row).toMatchObject({ job: "refresh", finishedAt: null, errorSteps: [], summary: {} });
  });

  it.each([
    ["a job nobody runs", { job: "backup" }, "job_runs_job"],
    [
      "finishing before it started",
      {
        job: "refresh",
        startedAt: new Date("2026-09-17T08:00:00Z"),
        finishedAt: new Date("2026-09-17T07:00:00Z"),
      },
      "job_runs_finishes_after_it_starts",
    ],
  ])("refuse %s", async (_name, values, constraint) => {
    expect(await refusal(db.insert(jobRuns).values(values))).toMatch(constraint);
  });
});

describe("what a signed-in browser can read", () => {
  beforeEach(async () => {
    for (const id of [ids.alice!, ids.bob!]) {
      await db.insert(notificationSettings).values({ userId: id });
      await db.insert(limitAlerts).values(alertRow(id));
      await db.insert(pushSubscriptions).values(deviceRow(id));
      await db
        .insert(netAssets)
        .values({ userId: id, sealedAmount: "v1.sealed", masterKeyVersion: 1 });
      await db.insert(pushDeliveries).values({
        userId: id,
        kind: "limit",
        dedupeKey: "limit:80:2026-09-01",
        sentOn: "2026-09-17",
      });
    }
  });

  /** A refusal aborts its transaction, so each one gets a transaction of its own. */
  const denied = (work: (tx: Parameters<Parameters<typeof asUser>[2]>[0]) => Promise<unknown>) =>
    asUser(db, ALICE, (tx) => refusal(work(tx)));

  it("is their own settings and alerts — never anyone else's", async () => {
    await asUser(db, ALICE, async (tx) => {
      expect(await tx.select().from(notificationSettings)).toHaveLength(1);
      const alerts = await tx.select().from(limitAlerts);
      expect(alerts).toHaveLength(1);
      expect(alerts[0]!.userId).toBe(ids.alice);
    });
  });

  it("is their own devices, by name — never the keys that push to them", async () => {
    await asUser(db, ALICE, async (tx) => {
      const devices = await tx
        .select({ id: pushSubscriptions.id, label: pushSubscriptions.label })
        .from(pushSubscriptions);
      expect(devices).toEqual([{ id: expect.any(String), label: "iPhone" }]);
    });
    expect(await denied((tx) => tx.select().from(pushSubscriptions))).toMatch(/permission denied/);
  });

  it("is when net assets were last reviewed — never the sealed figure", async () => {
    await asUser(db, ALICE, async (tx) => {
      const [row] = await tx.select({ reviewedAt: netAssets.reviewedAt }).from(netAssets);
      expect(row!.reviewedAt).toBeInstanceOf(Date);
    });
    expect(await denied((tx) => tx.select().from(netAssets))).toMatch(/permission denied/);
  });

  it("is never the server's own bookkeeping", async () => {
    await db.insert(jobRuns).values({ job: "refresh" });
    await db.insert(recommendationState).values({
      userId: ids.alice!,
      trigger: "urgent_move",
      subject: "NVDA_US_EQ",
      state: "clear",
    });

    expect(await denied((tx) => tx.select().from(jobRuns))).toMatch(/permission denied/);
    expect(await denied((tx) => tx.select().from(recommendationState))).toMatch(
      /permission denied/,
    );
    expect(await denied((tx) => tx.select().from(pushDeliveries))).toMatch(/permission denied/);
  });
});
