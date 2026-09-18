import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { digests, nudges, users } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { testDatabase } from "../test-support/pglite.js";
import { dbNudgeStore, type NewNudge } from "./store.js";

const ALICE = { authUserId: "12121212-1212-4212-8212-121212121212", userId: "" };
const BOB = { authUserId: "34343434-3434-4343-8343-343434343434", userId: "" };
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
});
afterAll(async () => close());

beforeEach(async () => {
  await db.delete(nudges);
  await db.delete(digests);
  await db.delete(users);
  for (const person of [ALICE, BOB]) {
    const [row] = await db
      .insert(users)
      .values({ email: `${person.authUserId}@example.test`, authUserId: person.authUserId })
      .returning();
    person.userId = row!.id;
  }
});

function row(overrides: Partial<NewNudge> = {}): NewNudge {
  return {
    cadence: "weekly",
    kind: "shape",
    reason: "cap",
    urgent: false,
    bucket: "Degen",
    instrumentId: null,
    title: "Side Bet has reached its starter limit",
    body: "That's 1.8% past the line you set.",
    basis: null,
    facts: { type: "cap" },
    checks: [
      { rule: "exclusions", setting: 0, passed: true, detail: "Not on your exclusions list" },
    ],
    shown: true,
    model: "template",
    promptVersion: null,
    personalised: false,
    dedupeKey: "cap:Degen:2026-09-14",
    builtOn: "2026-09-14",
    priceAt: null,
    priceCurrency: null,
    priceSource: null,
    potShareAt: "6.82",
    ...overrides,
  };
}

const week = {
  weekOf: "2026-09-14",
  opening: "Here's your week.",
  counts: { holdingsChecked: 4 },
  builtAt: new Date("2026-09-14T08:00:00Z"),
};

describe("the nudge log in the database", () => {
  it("saves a week once, with its nudges, and reads it back as the user", async () => {
    const store = dbNudgeStore(db);
    expect(
      await store.saveWeek(ALICE, week, [
        row(),
        row({
          reason: "drift",
          kind: "shape",
          bucket: "Base",
          dedupeKey: "drift:Base:2026-09-14",
          shown: false,
        }),
      ]),
    ).toBe(true);
    expect(await store.saveWeek(ALICE, week, [row()])).toBe(false);
    expect(await store.weekExists(ALICE, "2026-09-14")).toBe(true);
    const saved = await store.week(ALICE, "latest");
    expect(saved).toMatchObject({
      weekOf: "2026-09-14",
      opening: "Here's your week.",
      counts: { holdingsChecked: 4 },
    });
    expect(saved!.nudges.map((n) => [n.reason, n.shown])).toEqual([
      ["cap", true],
      ["drift", false],
    ]);
    expect(await store.weeks(ALICE)).toEqual(["2026-09-14"]);
  });

  it("never shows one person's weeks or nudges to another", async () => {
    const store = dbNudgeStore(db);
    await store.saveWeek(ALICE, week, [row()]);
    expect(await store.week(BOB, "latest")).toBeNull();
    expect(await store.weekExists(BOB, "2026-09-14")).toBe(false);
  });

  it("logs a daily nudge once a day however often the job runs, and knows what's been shown", async () => {
    const store = dbNudgeStore(db);
    const daily = row({
      cadence: "daily",
      builtOn: "2026-09-15",
      dedupeKey: "cap:Degen:2026-09-15",
    });
    expect(await store.saveDaily(ALICE, [daily])).toBe(1);
    expect(await store.saveDaily(ALICE, [daily])).toBe(0);
    expect(await store.daily(ALICE, "2026-09-15")).toHaveLength(1);
    const history = await store.history(ALICE, "2026-09-16", "2026-09-14");
    expect(history).toMatchObject({
      dailyShownToday: 0,
      dailyShownThisWeek: 1,
      shownKeys: ["cap:Degen:2026-09-15"],
    });
    expect(history.lastCapNudgeAt).toBeInstanceOf(Date);
  });

  it("records what someone did only on their own nudge", async () => {
    const store = dbNudgeStore(db);
    await store.saveWeek(ALICE, week, [row()]);
    const [nudge] = (await store.week(ALICE, "latest"))!.nudges;
    const at = new Date("2026-09-14T09:00:00Z");
    expect(await store.respond(BOB, nudge!.id, "acted", at)).toBeNull();
    expect(await store.respond(ALICE, "not-a-uuid", "acted", at)).toBeNull();
    expect(await store.respond(ALICE, nudge!.id, "dismissed", at)).toMatchObject({
      response: "dismissed",
      respondedAt: at,
    });
  });
});
