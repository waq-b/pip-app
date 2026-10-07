import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { connectionGaps, instruments, providerCredentials, users } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { recordConnectionGaps } from "./gaps.js";
import { fixedJobStatus } from "../routes/status.js";
import { stubSeriesAnchors } from "../market/stub/anchors.js";
import { createStubMarketData } from "../market/stub/index.js";
import { createNudgeService, type NudgeUser } from "../nudges/service.js";
import { dbNudgeStore } from "../nudges/store.js";
import { memoryProfileStore } from "../nudges/profile.js";
import { stubFactsReader } from "../nudges/gather.js";
import { dbTriggerStateStore } from "../nudges/trigger-store.js";
import { llmWriter, stubWriter, type NudgeWriter } from "../research/writer.js";
import { stubReadModel } from "../read/stub.js";
import { checkLimitAlerts } from "../rules/limit-alerts.js";
import type { SideBetInput } from "../rules/engine.js";
import { fixedSideBetLimits } from "../rules/side-bet.js";
import { memoryRulesStore } from "../rules/store.js";
import { memoryTrustSettingsStore } from "../rules/trust-settings.js";
import { testDatabase } from "../test-support/pglite.js";
import { createNotifier } from "./notify.js";
import { stubEmailSender, stubPushSender } from "./senders.js";
import { dbNotificationStore } from "./store.js";

/**
 * Every way Pip speaks, end to end, on real Postgres with nothing stubbed but
 * the market and the writer — no network anywhere (design rule 6):
 *
 *   a line crossed → the alert or brief code decided → `notify()`'s switches,
 *   one push per event, the daily budget → the device, the inbox and the bell.
 *
 * The rules this proves are the ones a real person would notice if they broke:
 * one push per crossing however many runs see it, a flickering value that
 * speaks once, a switch that really stops a channel, and a gap that never
 * wakes anyone up.
 */

const AUTH = "99999999-9999-4999-8999-999999999999";
const FRIEND_AUTH = "88888888-8888-4888-8888-888888888888";
const IPHONE = {
  endpoint: "https://web.push.apple.com/waqar-iphone",
  p256dh: "k",
  auth: "a",
  label: "iPhone",
};
/** The sample market's own clock, so the sample's notes don't drift with the date. */
const SAMPLE_AT = new Date("2026-09-17T12:00:00Z");
const MONDAY = new Date("2026-09-14T08:00:00Z");
const THURSDAY = new Date("2026-09-17T09:00:00Z");
const later = (from: Date, minutes: number) => new Date(from.getTime() + minutes * 60_000);

let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
});
afterAll(async () => close());

interface World {
  waqar: NudgeUser;
  friend: NudgeUser;
  push: ReturnType<typeof stubPushSender>;
  email: ReturnType<typeof stubEmailSender>;
  notifier: ReturnType<typeof createNotifier>;
  store: ReturnType<typeof dbNotificationStore>;
  nudges: ReturnType<typeof createNudgeService>;
  rulesStore: ReturnType<typeof memoryRulesStore>;
  limits: (input: Partial<SideBetInput>, at?: Date) => Promise<unknown>;
}

/** The sample's holdings, so the nudge log can point at them. */
const SAMPLE_INSTRUMENTS = [
  "vanguard-ftse-global-all-cap",
  "vanguard-sp-500",
  "cash-waiting",
  "nvidia",
  "apple",
  "asml",
  "greggs",
  "rolls-royce",
  "bitcoin",
  "ethereum",
  "solana",
];

async function world(
  options: { sideBet?: Partial<SideBetInput>; writer?: NudgeWriter } = {},
): Promise<World> {
  await db.delete(connectionGaps);
  await db.delete(providerCredentials);
  await db.delete(users);
  const [waqarRow] = await db
    .insert(users)
    .values({ email: "test@example.com", authUserId: AUTH, personalResearch: true })
    .returning({ id: users.id });
  const [friendRow] = await db
    .insert(users)
    .values({ email: "friend@example.test", authUserId: FRIEND_AUTH })
    .returning({ id: users.id });
  const waqar: NudgeUser = {
    userId: waqarRow!.id,
    authUserId: AUTH,
    personalResearch: true,
    email: "test@example.com",
  };
  const friend: NudgeUser = {
    userId: friendRow!.id,
    authUserId: FRIEND_AUTH,
    personalResearch: false,
    email: "friend@example.test",
  };

  await db
    .insert(instruments)
    .values(
      SAMPLE_INSTRUMENTS.map((id) => ({
        id,
        isin: `ISIN-${id}`,
        name: id,
        shortName: id,
        currency: "GBP",
        type: id === "bitcoin" || id === "ethereum" || id === "solana" ? "CRYPTO" : "STOCK",
      })),
    )
    .onConflictDoNothing();

  const store = dbNotificationStore(db);
  const push = stubPushSender();
  const email = stubEmailSender();
  const notifier = createNotifier({ store, push, email });
  await store.addDevice(waqar, IPHONE, MONDAY);
  await store.addDevice(
    friend,
    { ...IPHONE, endpoint: "https://web.push.apple.com/friend" },
    MONDAY,
  );

  const rulesStore = memoryRulesStore();
  const sideBet: SideBetInput = {
    limitPence: 35_000,
    moneyInPence: 20_000,
    starterLimit: true,
    ...options.sideBet,
  };
  const sideBetLimits = fixedSideBetLimits(sideBet);
  const writer = options.writer ?? stubWriter();
  const nudges = createNudgeService({
    readModel: stubReadModel(
      createStubMarketData({ anchors: stubSeriesAnchors(), now: () => SAMPLE_AT }),
      rulesStore,
      sideBetLimits,
    ),
    rulesStore,
    sideBetLimits,
    trustStore: memoryTrustSettingsStore(),
    profileStore: memoryProfileStore(),
    facts: stubFactsReader(),
    store: dbNudgeStore(db),
    writer,
    notifier,
    triggers: dbTriggerStateStore(db),
  });

  return {
    waqar,
    friend,
    push,
    email,
    notifier,
    store,
    nudges,
    rulesStore,
    limits: (input, at = THURSDAY) =>
      checkLimitAlerts({ db, notifier }, waqar, { ...sideBet, ...input }, at),
  };
}

const titles = (push: ReturnType<typeof stubPushSender>) => push.sent.map((sent) => sent.title);

describe("Side Bet's limit", () => {
  it("speaks once at 80% and once at the limit, then not again until it clears", async () => {
    const w = await world();
    // £280 of the £350 starter limit is 80%.
    await w.limits({ moneyInPence: 28_000 });
    await w.limits({ moneyInPence: 30_000 }, later(THURSDAY, 30));
    expect(titles(w.push)).toEqual(["Side Bet is near its limit"]);

    await w.limits({ moneyInPence: 35_000 }, later(THURSDAY, 60));
    expect(titles(w.push)).toEqual([
      "Side Bet is near its limit",
      "Side Bet has reached its starter limit",
    ]);

    // Taking money out clears it quietly, and it can speak again after that.
    await w.limits({ moneyInPence: 20_000 }, later(THURSDAY, 90));
    expect(w.push.sent).toHaveLength(2);
    await w.limits({ moneyInPence: 34_000 }, new Date("2026-10-02T09:00:00Z"));
    expect(titles(w.push)).toHaveLength(3);
    expect(titles(w.push).at(-1)).toBe("Side Bet is near its limit");
  });

  it("is one push per event, however many runs see it", async () => {
    const w = await world();
    for (const minute of [0, 30, 60]) {
      await w.limits({ moneyInPence: 28_000 }, later(THURSDAY, minute));
    }
    expect(w.push.sent).toHaveLength(1);
    expect(w.push.sent[0]!.url).toBe("/rules");
  });
});

describe("what gets pushed and what waits", () => {
  it("keeps the week's notes for the week: the bell lists them, the phone only hears it's ready", async () => {
    const w = await world();
    await w.nudges.buildWeekIfDue(w.waqar, MONDAY);
    const feed = await w.store.feed(w.waqar, MONDAY);

    // Everything Pip wrote is in the bell, unread, pointing at the week.
    expect(feed.length).toBeGreaterThan(1);
    expect(feed.every((item) => !item.read)).toBe(true);
    expect(feed.filter((item) => item.kind === "nudge").every((item) => item.url === "/week")).toBe(
      true,
    );
    // None of them woke the phone: only "Your week is ready" did.
    expect(titles(w.push)).toEqual(["Your week is ready"]);
  });

  it("puts a limit alert in the bell as well as on the phone", async () => {
    const w = await world();
    await w.limits({ moneyInPence: 28_000 });
    const feed = await w.store.feed(w.waqar, THURSDAY);
    expect(feed.map((item) => [item.kind, item.title, item.url])).toContainEqual([
      "limit_alert",
      "Side Bet is near its limit",
      "/rules",
    ]);
    expect(titles(w.push)).toEqual(["Side Bet is near its limit"]);
  });

  it("sends nobody else's notes anywhere, and never Pip's take", async () => {
    const w = await world({ sideBet: { limitPence: 50_000, starterLimit: false } });
    await w.nudges.buildDaily(w.friend, THURSDAY);
    await w.nudges.buildDaily(w.friend, later(THURSDAY, 30));

    expect(w.push.sent).toEqual([]);
    expect(w.email.sent).toEqual([]);
    const feed = await w.store.feed(w.friend, later(THURSDAY, 30));
    expect(feed.filter((item) => item.title.startsWith("Side Bet is worth"))).toEqual([]);
  });

  it("stops at two urgent pushes a day, and says why in the log", async () => {
    const w = await world();
    await w.nudges.buildDaily(w.waqar, THURSDAY);
    const sent = w.push.sent.length;
    // Two more urgent notes on the same day, by hand: the budget is the point.
    for (const key of ["one", "two"]) {
      await w.notifier.push(
        {
          userId: w.waqar.userId,
          kind: "urgent",
          dedupeKey: `urgent:${key}`,
          message: { title: `Planted ${key}`, body: "b", url: "/week" },
        },
        THURSDAY,
      );
    }
    expect(w.push.sent).toHaveLength(Math.min(sent + 2, 2));
    const outcome = await w.notifier.push(
      {
        userId: w.waqar.userId,
        kind: "urgent",
        dedupeKey: "urgent:three",
        message: { title: "Planted three", body: "b", url: "/week" },
      },
      THURSDAY,
    );
    expect(outcome).toEqual({ sent: false, why: "over_budget" });
  });
});

describe("Pip's take", () => {
  it("makes one recommendation through a flickering value, and one push", async () => {
    // Side Bet's sample value is £780; a £500 limit puts it past 10% of net assets.
    const w = await world({ sideBet: { limitPence: 50_000, starterLimit: false } });
    await w.nudges.buildDaily(w.waqar, THURSDAY);
    await w.nudges.buildDaily(w.waqar, later(THURSDAY, 30));
    await w.nudges.buildDaily(w.waqar, later(THURSDAY, 60));

    const feed = await w.store.feed(w.waqar, later(THURSDAY, 60));
    const briefs = feed.filter((item) => item.title.startsWith("Side Bet is worth"));
    expect(briefs).toHaveLength(1);
    expect(titles(w.push)).toContain("Side Bet has grown past its limit");
    expect(titles(w.push).filter((t) => t === "Side Bet has grown past its limit")).toHaveLength(1);
  });

  it("keeps a pot's drift in the bell and off the phone", async () => {
    const w = await world();
    // The sample's Handpicked is about 23% of the shape: well over a 15% target.
    await w.rulesStore.set(w.waqar, { handpickedTarget: 15 }, THURSDAY);
    await w.nudges.buildDaily(w.waqar, THURSDAY);
    await w.nudges.buildDaily(w.waqar, later(THURSDAY, 30));

    const feed = await w.store.feed(w.waqar, later(THURSDAY, 30));
    const drift = feed.find((item) => item.title.includes("points over its target"));
    expect(drift?.title).toBe("Handpicked is 8 points over its target");
    expect(titles(w.push)).not.toContain(drift!.title);
    expect(w.push.sent).toEqual([]);
  });

  it("falls back to Pip's own words when the writer answers badly", async () => {
    // A planted answer that tells the reader to buy: the guard throws it out.
    const chat = async () => ({
      content: JSON.stringify({
        notes: [],
        briefs: [
          {
            id: "r1",
            why: "It has run up a long way — buy more while it lasts.",
            typical: "Everyone takes some profit here.",
            tradeoff: "None to speak of.",
          },
        ],
        opening: null,
      }),
      model: "planted",
    });
    const fellBack: string[] = [];
    const w = await world({
      sideBet: { limitPence: 50_000, starterLimit: false },
      writer: llmWriter({ chat, model: "planted", onFallback: (why) => fellBack.push(why) }),
    });
    await w.nudges.buildDaily(w.waqar, THURSDAY);
    await w.nudges.buildDaily(w.waqar, later(THURSDAY, 30));

    const feed = await w.store.feed(w.waqar, later(THURSDAY, 30));
    const brief = feed.find((item) => item.title.startsWith("Side Bet is worth"));
    expect(fellBack).toContain("buy or sell");
    expect(brief?.body).toContain("A disciplined investor");
    expect(brief?.body).toContain("Your call.");
    expect(brief?.body).not.toMatch(/buy/i);
  });
});

describe("Monday", () => {
  it("brings one push and one email, and only once", async () => {
    const w = await world();
    expect(await w.nudges.buildWeekIfDue(w.waqar, MONDAY)).toBe("built");
    expect(await w.nudges.buildWeekIfDue(w.waqar, later(MONDAY, 30))).toBe("exists");

    expect(titles(w.push)).toEqual(["Your week is ready"]);
    expect(w.email.sent).toHaveLength(1);
    expect(w.email.sent[0]).toMatchObject({ to: "test@example.com" });
    expect(w.email.sent[0]!.subject).toMatch(/^Your week: /);
  });

  it("goes quiet on the channels that are switched off", async () => {
    const w = await world();
    await w.store.saveSettings(
      w.waqar,
      { push: true, pushLimit: true, pushUrgent: true, pushDigest: false, email: false },
      { now: MONDAY },
    );
    await w.nudges.buildWeekIfDue(w.waqar, MONDAY);
    expect(w.push.sent).toEqual([]);
    expect(w.email.sent).toEqual([]);
  });

  it("stops every push when the master is off, and still keeps the bell", async () => {
    const w = await world();
    await w.store.saveSettings(
      w.waqar,
      { push: false, pushLimit: true, pushUrgent: true, pushDigest: true, email: true },
      { now: THURSDAY },
    );
    await w.limits({ moneyInPence: 28_000 });
    await w.nudges.buildDaily(w.waqar, THURSDAY);

    expect(w.push.sent).toEqual([]);
    const feed = await w.store.feed(w.waqar, THURSDAY);
    expect(feed.map((item) => item.title)).toEqual(
      expect.arrayContaining(["Side Bet is near its limit"]),
    );
  });
});

describe("a quiet connection", () => {
  it("becomes one bell row and no push, and closes itself when it comes back", async () => {
    const w = await world();
    const quiet = new Date(THURSDAY.getTime() - 5 * 3_600_000);
    await db.insert(providerCredentials).values({
      userId: w.waqar.userId,
      provider: "kraken",
      accountKind: "spot",
      status: "live",
      sealedKey: "sealed",
      sealedSecret: "sealed",
      keyVersion: 1,
      accountCurrency: "GBP",
      lastPolledAt: quiet,
    });

    expect(await recordConnectionGaps(db, THURSDAY)).toEqual({ opened: 1, closed: 0 });
    // Seen again on the next run: still one gap, still nothing pushed.
    expect(await recordConnectionGaps(db, later(THURSDAY, 30))).toEqual({ opened: 0, closed: 0 });

    const feed = await w.store.feed(w.waqar, THURSDAY);
    const gaps = feed.filter((item) => item.kind === "connection_gap");
    expect(gaps).toHaveLength(1);
    expect(gaps[0]).toMatchObject({ title: "Kraken went quiet", url: "/setup", read: false });
    expect(w.push.sent).toEqual([]);

    await db
      .update(providerCredentials)
      .set({ lastPolledAt: later(THURSDAY, 60) })
      .where(eq(providerCredentials.userId, w.waqar.userId));
    expect(await recordConnectionGaps(db, later(THURSDAY, 61))).toEqual({ opened: 0, closed: 1 });
    expect(await recordConnectionGaps(db, later(THURSDAY, 62))).toEqual({ opened: 0, closed: 0 });
  });
});

describe("a device that stops answering", () => {
  it("is forgotten when the push service says it's gone, so the app can ask again", async () => {
    const w = await world();
    const gone = createNotifier({
      store: w.store,
      push: {
        async send() {
          return { ok: false, gone: true, detail: "410" };
        },
      },
      email: stubEmailSender(),
    });
    const outcome = await gone.push(
      {
        userId: w.waqar.userId,
        kind: "limit",
        dedupeKey: "limit:80:2026-09-17",
        message: { title: "t", body: "b", url: "/rules" },
      },
      THURSDAY,
    );

    expect(outcome).toMatchObject({ sent: true, devices: 1, delivered: 0 });
    expect(await w.store.devices(w.waqar)).toEqual([]);
    // Nothing is pushed to a user with no devices; the bell still has the list.
    expect(
      await gone.push(
        {
          userId: w.waqar.userId,
          kind: "limit",
          dedupeKey: "limit:100:2026-09-17",
          message: { title: "t", body: "b", url: "/rules" },
        },
        THURSDAY,
      ),
    ).toEqual({ sent: false, why: "no_devices" });
  });
});

describe("the jobs health check", () => {
  it("answers 200 while the jobs are fresh and 503 once they're stale", async () => {
    const fresh = buildApp({ jobStatus: fixedJobStatus(() => THURSDAY), now: () => THURSDAY });
    expect((await fresh.inject({ method: "GET", url: "/health/jobs" })).statusCode).toBe(200);

    const stale = buildApp({
      jobStatus: fixedJobStatus(() => new Date(THURSDAY.getTime() - 4 * 3_600_000)),
      now: () => THURSDAY,
    });
    const response = await stale.inject({ method: "GET", url: "/health/jobs" });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toMatchObject({ status: "stale" });
  });
});
