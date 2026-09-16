import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { userRules, users } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { testDatabase } from "../test-support/pglite.js";
import { dbRulesStore } from "./store.js";

const ALICE = { authUserId: "77777777-7777-4777-8777-777777777777", userId: "" };
const BOB = { authUserId: "88888888-8888-4888-8888-888888888888", userId: "" };
let db: Db;
let close: () => Promise<void>;

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
});
afterAll(async () => close());

beforeEach(async () => {
  await db.delete(userRules);
  await db.delete(users);
  for (const person of [ALICE, BOB]) {
    const [row] = await db
      .insert(users)
      .values({ email: `${person.authUserId}@example.test`, authUserId: person.authUserId })
      .returning();
    person.userId = row!.id;
  }
});

describe("rules in the database", () => {
  it("gives the defaults, never changed, until someone saves", async () => {
    expect(await dbRulesStore(db).get(ALICE)).toEqual({
      settings: { handpickedTarget: 25, sideBetCap: 5 },
      updatedAt: null,
    });
  });

  it("saves, replaces, and reads back as the user", async () => {
    const store = dbRulesStore(db);
    const first = new Date("2026-09-16T20:00:00Z");
    const second = new Date("2026-09-16T21:00:00Z");
    await store.set(ALICE, { handpickedTarget: 30, sideBetCap: 8 }, first);
    await store.set(ALICE, { handpickedTarget: 20, sideBetCap: 12 }, second);
    expect(await store.get(ALICE)).toEqual({
      settings: { handpickedTarget: 20, sideBetCap: 12 },
      updatedAt: second,
    });
    expect(await db.select().from(userRules)).toHaveLength(1);
  });

  it("never shows one person's rules to another", async () => {
    const store = dbRulesStore(db);
    await store.set(ALICE, { handpickedTarget: 40, sideBetCap: 15 }, new Date());
    expect((await store.get(BOB)).settings).toEqual({ handpickedTarget: 25, sideBetCap: 5 });
  });

  it("refuses a cap above 20% in the database too", async () => {
    await expect(
      db.insert(userRules).values({ userId: ALICE.userId, handpickedTarget: 25, sideBetCap: 21 }),
    ).rejects.toThrow();
    await expect(
      db.insert(userRules).values({ userId: ALICE.userId, handpickedTarget: 90, sideBetCap: 20 }),
    ).rejects.toThrow();
    const rows = await db.select().from(userRules).where(eq(userRules.userId, ALICE.userId));
    expect(rows).toHaveLength(0);
  });
});
