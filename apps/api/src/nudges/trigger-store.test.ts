import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { users } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { testDatabase } from "../test-support/pglite.js";
import { dbTriggerStateStore } from "./trigger-store.js";
import { evaluateRecommendations } from "./triggers.js";

/**
 * The trigger state on a real Postgres: the database insists an event id exists
 * exactly while a crossing is fired, so the evaluator has to keep to that.
 */

let db: Db;
let close: () => Promise<void>;
let userId: string;

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
  const [row] = await db
    .insert(users)
    .values({ email: "test@example.com", authUserId: "99999999-9999-4999-8999-999999999999" })
    .returning({ id: users.id });
  userId = row!.id;
});
afterAll(async () => close());

describe("trigger state in the database", () => {
  it("moves through pending, fired and clear without breaking the table's rules", async () => {
    const store = dbTriggerStateStore(db);
    const at = (minutes: number) => new Date(Date.parse("2026-09-17T09:00:00Z") + minutes * 60_000);
    const pots = (driftPoints: number) => [
      { bucket: "Medium" as const, driftPoints, offTargetPence: driftPoints * 10_000 },
    ];
    const run = (minutes: number, drift: number) =>
      evaluateRecommendations(store, userId, {
        now: at(minutes),
        day: "2026-09-17",
        sideBet: null,
        holdings: [],
        pots: pots(drift),
      });

    expect(await run(0, 6)).toEqual([]);
    expect(await run(30, 6)).toHaveLength(1);
    expect((await store.load(userId))[0]).toMatchObject({ state: "fired" });
    expect((await store.load(userId))[0]!.eventId).toMatch(/^[0-9a-f-]{36}$/);

    await run(60, 1);
    await run(90, 1);
    const [cleared] = await store.load(userId);
    expect(cleared).toMatchObject({ state: "clear", eventId: null });
  });
});
