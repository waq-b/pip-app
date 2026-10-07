import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { limitAlerts, users } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { createNotifier, type Notifier } from "../notify/notify.js";
import { stubEmailSender, stubPushSender } from "../notify/senders.js";
import { memoryNotificationStore } from "../notify/store.js";
import { testDatabase } from "../test-support/pglite.js";
import type { SideBetInput } from "./engine.js";
import { checkLimitAlerts } from "./limit-alerts.js";

/**
 * Side Bet's two alerts. Money in, less taken out, only
 * moves when money moves — so unlike the old percentage cap there is nothing to
 * flicker, and an alert that has spoken stays quiet until it clearly clears.
 */

const WAQAR = "88888888-8888-4888-8888-888888888888";
const NOW = new Date("2026-09-17T09:00:00Z");
let db: Db;
let close: () => Promise<void>;
let userId: string;
let push: ReturnType<typeof stubPushSender>;
let notifier: Notifier;

/** The £350 starter limit: 80% is £280. */
const sideBet = (moneyInPence: number, overrides: Partial<SideBetInput> = {}): SideBetInput => ({
  limitPence: 35_000,
  moneyInPence,
  starterLimit: true,
  ...overrides,
});

const check = (input: SideBetInput, at = NOW) =>
  checkLimitAlerts({ db, notifier }, { userId }, input, at);

const alerts = () =>
  db
    .select()
    .from(limitAlerts)
    .where(eq(limitAlerts.userId, userId))
    .orderBy(limitAlerts.threshold);

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
});
afterAll(async () => close());

beforeEach(async () => {
  await db.delete(limitAlerts);
  await db.delete(users);
  const [row] = await db
    .insert(users)
    .values({ email: "test@example.com", authUserId: WAQAR })
    .returning({ id: users.id });
  userId = row!.id;

  const store = memoryNotificationStore();
  push = stubPushSender();
  notifier = createNotifier({ store, push, email: stubEmailSender() });
  await store.addDevice(
    { userId, authUserId: WAQAR },
    { endpoint: "https://web.push.apple.com/one", p256dh: "k", auth: "a", label: "iPhone" },
    NOW,
  );
});

describe("the 80% alert", () => {
  it("says nothing while there's room", async () => {
    expect(await check(sideBet(20_000))).toEqual([]);
    expect(await alerts()).toHaveLength(0);
    expect(push.sent).toHaveLength(0);
  });

  it("speaks once at 80%, and not again while it stays there", async () => {
    expect(await check(sideBet(28_000))).toEqual([
      { threshold: 80, action: "alerted", pushed: true },
    ]);
    expect(push.sent[0]).toMatchObject({
      title: "Side Bet is near its limit",
      url: "/rules",
    });
    expect(push.sent[0]!.body).toContain("£280 of £350");

    // More money in, still under the limit: the same alert, so nothing new.
    expect(await check(sideBet(30_000))).toEqual([]);
    expect(await alerts()).toHaveLength(1);
    expect(push.sent).toHaveLength(1);
  });
});

describe("the limit itself", () => {
  it("speaks at 100%, separately from the 80% alert", async () => {
    await check(sideBet(28_000));
    const outcomes = await check(sideBet(35_000));

    expect(outcomes).toEqual([{ threshold: 100, action: "alerted", pushed: true }]);
    expect(push.sent).toHaveLength(2);
    expect(push.sent[1]).toMatchObject({ title: "Side Bet has reached its starter limit" });
    expect(push.sent[1]!.body).toContain("Pip can't stop anything");
  });

  it("keeps a real limit's pounds off the lock screen — it's net assets ÷ 10", async () => {
    await check(sideBet(640_000, { limitPence: 640_000, starterLimit: false }));
    expect(push.sent.map((p) => p.title)).toEqual([
      "Side Bet is near its limit",
      "Side Bet has reached its limit",
    ]);
    for (const sent of push.sent) expect(`${sent.title} ${sent.body}`).not.toMatch(/£/);
  });

  it("goes straight to both when money in jumps past the limit in one go", async () => {
    const outcomes = await check(sideBet(40_000));
    expect(outcomes.map((o) => o.threshold)).toEqual([80, 100]);
    expect(push.sent).toHaveLength(2);
  });
});

describe("clearing and speaking again", () => {
  it("stays quiet until money in is clearly back under, then can speak again", async () => {
    await check(sideBet(28_000));
    expect(push.sent).toHaveLength(1);

    // A pound under is not "clearly" under: nothing changes.
    expect(await check(sideBet(27_900))).toEqual([]);
    expect((await alerts())[0]!.clearedAt).toBeNull();

    // £25 under the threshold clears it — quietly, with no push.
    expect(await check(sideBet(25_400))).toEqual([{ threshold: 80, action: "cleared" }]);
    expect((await alerts())[0]!.clearedAt).toBeInstanceOf(Date);
    expect(push.sent).toHaveLength(1);

    // Back over on another day: a new alert, and a new push.
    const later = new Date("2026-10-01T09:00:00Z");
    expect(await check(sideBet(29_000), later)).toEqual([
      { threshold: 80, action: "alerted", pushed: true },
    ]);
    expect(await alerts()).toHaveLength(2);
    expect(push.sent).toHaveLength(2);
  });

  it("records what it was built from, so the bell can say it in pounds", async () => {
    await check(sideBet(28_000));
    expect((await alerts())[0]).toMatchObject({
      threshold: 80,
      moneyInPence: 28_000,
      limitPence: 35_000,
      starterLimit: true,
      windowStart: "2026-09-17",
    });
  });
});

describe("when Pip can't judge", () => {
  it("says nothing without a limit at all", async () => {
    expect(await check(sideBet(50_000, { limitPence: 0 }))).toEqual([]);
    expect(await alerts()).toHaveLength(0);
  });

  it("still records the alert when there's nobody to push to", async () => {
    const quiet = createNotifier({
      store: memoryNotificationStore(),
      push: stubPushSender(),
      email: stubEmailSender(),
    });
    const outcomes = await checkLimitAlerts(
      { db, notifier: quiet },
      { userId },
      sideBet(35_000),
      NOW,
    );
    expect(outcomes).toEqual([
      { threshold: 80, action: "alerted", pushed: false },
      { threshold: 100, action: "alerted", pushed: false },
    ]);
    expect(await alerts()).toHaveLength(2);
  });
});
