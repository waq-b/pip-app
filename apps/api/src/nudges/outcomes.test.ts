import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { dailyCloses, dailyValues, digests, instruments, nudges, users } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { testDatabase } from "../test-support/pglite.js";
import { fillOutcomes, GIVE_UP_AFTER_DAYS, pencePerUnitOn } from "./outcomes.js";

const DAY = 86_400_000;
let db: Db;
let close: () => Promise<void>;
let userId = "";

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
  await db.insert(instruments).values([
    {
      id: "NVDA_US_EQ",
      isin: "US67066G1040",
      name: "Nvidia",
      shortName: "NVDA",
      currency: "USD",
      type: "STOCK",
    },
    {
      id: "GRGl_EQ",
      isin: "GB00B63QSB39",
      name: "Greggs",
      shortName: "GRG",
      currency: "GBX",
      type: "STOCK",
    },
  ]);
  await db.insert(dailyCloses).values([
    { key: "NVDA_US_EQ", day: "2026-09-14", close: "200", currency: "USD", source: "t" },
    { key: "NVDA_US_EQ", day: "2026-09-18", close: "220", currency: "USD", source: "t" },
    { key: "FX:GBPUSD", day: "2026-09-18", close: "1.25", currency: "USD", source: "t" },
    { key: "GRGl_EQ", day: "2026-09-21", close: "2150", currency: "GBX", source: "t" },
  ]);
  const [user] = await db.insert(users).values({ email: "o@example.test" }).returning();
  userId = user!.id;
});
afterAll(async () => close());

beforeEach(async () => {
  await db.delete(nudges);
  await db.delete(digests);
  await db.delete(dailyValues);
});

let n = 0;
async function nudge(overrides: Partial<typeof nudges.$inferInsert>) {
  n += 1;
  const [row] = await db
    .insert(nudges)
    .values({
      userId,
      cadence: "daily",
      kind: "awareness",
      reason: "move",
      bucket: "Medium",
      instrumentId: "NVDA_US_EQ",
      title: "t",
      body: "b",
      facts: {},
      checks: [],
      shown: true,
      model: "template",
      personalised: false,
      dedupeKey: `k${n}`,
      builtOn: "2026-09-14",
      createdAt: new Date("2026-09-14T09:00:00Z"),
      ...overrides,
    })
    .returning();
  return row!;
}

describe("prices 7 and 30 days on", () => {
  it("are pence of pounds per unit, from the close on or before the day, at that day's FX", async () => {
    expect(await pencePerUnitOn(db, "NVDA_US_EQ", "2026-09-21")).toBe(17_600);
    expect(await pencePerUnitOn(db, "GRGl_EQ", "2026-09-21")).toBe(2_150);
    // More than 5 days stale is no close at all.
    expect(await pencePerUnitOn(db, "GRGl_EQ", "2026-10-14")).toBeNull();
  });

  it("fill in once due, and not before", async () => {
    const move = await nudge({});
    expect(await fillOutcomes(db, new Date("2026-09-20T09:00:00Z"))).toMatchObject({ filled: 0 });
    const summary = await fillOutcomes(db, new Date("2026-09-21T10:00:00Z"));
    expect(summary.filled).toBe(1);
    const [row] = await db.select().from(nudges);
    expect(row).toMatchObject({ id: move.id, price7d: "17600", price30d: null });
    expect(row!.price7dAt).toBeInstanceOf(Date);
    expect((await fillOutcomes(db, new Date("2026-09-21T11:00:00Z"))).filled).toBe(0);
  });

  it("wait for closes that aren't cached yet, then give up", async () => {
    await nudge({
      instrumentId: "GRGl_EQ",
      builtOn: "2026-10-01",
      createdAt: new Date("2026-10-01T09:00:00Z"),
    });
    expect(await fillOutcomes(db, new Date("2026-10-09T09:00:00Z"))).toMatchObject({
      waiting: 1,
      filled: 0,
    });
    const late = new Date(Date.parse("2026-10-01T09:00:00Z") + (7 + GIVE_UP_AFTER_DAYS + 1) * DAY);
    expect(await fillOutcomes(db, late)).toMatchObject({ givenUp: 1 });
    const [row] = await db.select().from(nudges);
    expect(row!.price7d).toBeNull();
    expect(row!.price7dAt).toBeInstanceOf(Date);
  });
});

describe("a pot's share for shape nudges", () => {
  it("is its invested value over every pot's that day", async () => {
    await nudge({ kind: "shape", reason: "cap", bucket: "Degen", instrumentId: null });
    await db.insert(dailyValues).values([
      {
        userId,
        bucket: "Base",
        day: "2026-09-21",
        valuePence: 9_000,
        costPence: 0,
        source: "snapshot",
      },
      {
        userId,
        bucket: "Degen",
        day: "2026-09-21",
        valuePence: 1_000,
        costPence: 0,
        source: "snapshot",
      },
    ]);
    await fillOutcomes(db, new Date("2026-09-21T10:00:00Z"));
    const [row] = await db.select().from(nudges);
    expect(row).toMatchObject({ potShare7d: "10", price7d: null });
  });
});

describe("nudges with nothing to measure", () => {
  it("are marked done so they aren't looked at every run", async () => {
    await nudge({ kind: "calendar", reason: "isa_year_end", bucket: "Base", instrumentId: null });
    await fillOutcomes(db, new Date("2026-09-21T10:00:00Z"));
    const [row] = await db.select().from(nudges);
    expect(row!.price7dAt).toBeInstanceOf(Date);
  });
});
