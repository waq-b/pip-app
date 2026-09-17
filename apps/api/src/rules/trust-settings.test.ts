import { DEFAULT_TRUST_SETTINGS, EMPTY_PROFILE } from "@finance-app/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { trustSettings, userProfiles, users } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { dbProfileStore } from "../nudges/profile.js";
import { testDatabase } from "../test-support/pglite.js";
import { dbTrustSettingsStore } from "./trust-settings.js";

const ALICE = { authUserId: "66666666-6666-4666-8666-666666666661", userId: "" };
const BOB = { authUserId: "66666666-6666-4666-8666-666666666662", userId: "" };
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
});
afterAll(async () => close());

beforeEach(async () => {
  await db.delete(trustSettings);
  await db.delete(userProfiles);
  await db.delete(users);
  for (const person of [ALICE, BOB]) {
    const [row] = await db
      .insert(users)
      .values({ email: `${person.authUserId}@example.test`, authUserId: person.authUserId })
      .returning();
    person.userId = row!.id;
  }
});

describe("trust settings in the database", () => {
  it("are the defaults, never changed, until someone saves", async () => {
    expect(await dbTrustSettingsStore(db).get(ALICE)).toEqual({
      settings: DEFAULT_TRUST_SETTINGS,
      updatedAt: null,
    });
  });

  it("save, replace, and read back as the user — big moves per pot included", async () => {
    const store = dbTrustSettingsStore(db);
    const at = new Date("2026-09-17T10:00:00Z");
    await store.set(ALICE, { ...DEFAULT_TRUST_SETTINGS, minSources: 3 }, new Date(0));
    const settings = {
      ...DEFAULT_TRUST_SETTINGS,
      namedPublishers: ["reuters.com"],
      bigMovePercent: { Base: 4, Medium: 8, Degen: 20 },
    };
    await store.set(ALICE, settings, at);
    expect(await store.get(ALICE)).toEqual({ settings, updatedAt: at });
    expect(await db.select().from(trustSettings)).toHaveLength(1);
  });

  it("never show one person's to another", async () => {
    const store = dbTrustSettingsStore(db);
    await store.set(ALICE, { ...DEFAULT_TRUST_SETTINGS, weeklyBudget: 8 }, new Date());
    expect((await store.get(BOB)).settings.weeklyBudget).toBe(DEFAULT_TRUST_SETTINGS.weeklyBudget);
  });
});

describe("profiles in the database", () => {
  it("are empty until someone saves", async () => {
    expect(await dbProfileStore(db).get(ALICE)).toEqual({
      profile: EMPTY_PROFILE,
      updatedAt: null,
    });
  });

  it("save, replace, and read back as the user", async () => {
    const store = dbProfileStore(db);
    const at = new Date("2026-09-17T10:00:00Z");
    const profile = {
      goals: "Grow savings",
      horizonYears: 15,
      monthlyInPence: 50_000,
      riskWords: "Ride the dips",
      exclusions: ["Tobacco"],
    };
    await store.set(ALICE, { ...profile, goals: "first" }, new Date(0));
    await store.set(ALICE, profile, at);
    expect(await store.get(ALICE)).toEqual({ profile, updatedAt: at });
    expect((await store.get(BOB)).profile).toEqual(EMPTY_PROFILE);
  });
});
