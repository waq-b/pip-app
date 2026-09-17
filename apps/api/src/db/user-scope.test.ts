import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { testDatabase } from "../test-support/pglite.js";
import {
  cash,
  dailyValues,
  holdings,
  instruments,
  prices,
  providerCredentials,
  sourceUsage,
  trades,
  users,
} from "./schema.js";
import { asUser, type Db } from "./user-scope.js";

/**
 * The second wall, tested below the routes: even a query with no `where`
 * clause — the bug a route could have — returns only the signed-in user's rows.
 * Runs our real migrations in an in-process Postgres.
 */
const ALICE_AUTH = "11111111-1111-4111-8111-111111111111";
const BOB_AUTH = "22222222-2222-4222-8222-222222222222";
const UNLINKED_AUTH = "33333333-3333-4333-8333-333333333333";

let db: Db;
let close: () => Promise<void>;
const ids: Record<string, string> = {};

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();

  await db.insert(instruments).values({
    id: "NVDA_US_EQ",
    isin: "US67066G1040",
    name: "Nvidia",
    shortName: "NVDA",
    currency: "USD",
    type: "STOCK",
  });
  await db.insert(prices).values({
    key: "NVDA_US_EQ",
    price: "215.3",
    currency: "USD",
    source: "test",
    asOf: new Date(),
  });
  await db.insert(sourceUsage).values({ source: "yahoo", day: "2026-09-16", calls: 3 });

  for (const [name, authUserId] of [
    ["alice", ALICE_AUTH],
    ["bob", BOB_AUTH],
  ] as const) {
    const [user] = await db
      .insert(users)
      .values({ email: `${name}@example.test`, authUserId })
      .returning({ id: users.id });
    ids[name] = user!.id;
    const [credential] = await db
      .insert(providerCredentials)
      .values({
        userId: user!.id,
        provider: "trading212",
        accountKind: "isa",
        sealedKey: `pip:1:sealed-key-${name}`,
        sealedSecret: `pip:1:sealed-secret-${name}`,
        keyVersion: 1,
        status: "live",
        accountCurrency: "GBP",
      })
      .returning({ id: providerCredentials.id });
    const credentialId = credential!.id;
    const now = new Date();
    await db.insert(holdings).values({
      credentialId,
      userId: user!.id,
      instrumentId: "NVDA_US_EQ",
      quantity: "1",
      averagePricePaid: "200",
      totalCostPence: 15_000,
      polledAt: now,
    });
    await db.insert(cash).values({
      credentialId,
      userId: user!.id,
      availablePence: 100,
      reservedPence: 0,
      inPiesPence: 0,
      polledAt: now,
    });
    await db.insert(trades).values({
      credentialId,
      userId: user!.id,
      fillId: `fill-${name}`,
      instrumentId: "NVDA_US_EQ",
      side: "BUY",
      quantity: "1",
      price: "200",
      netValuePence: 15_000,
      feesPence: 0,
      filledAt: now,
    });
    await db.insert(dailyValues).values({
      userId: user!.id,
      bucket: "Base",
      day: "2026-09-15",
      valuePence: 15_000,
      costPence: 15_000,
      source: "snapshot",
    });
  }
  await db.insert(users).values({ email: "unlinked@example.test" });
});

afterAll(async () => {
  await close();
});

describe("reading as a signed-in user", () => {
  it.each([
    ["holdings", holdings],
    ["cash", cash],
    ["trades", trades],
    ["daily_values", dailyValues],
  ] as const)("sees only their own %s, even with no where clause", async (_name, table) => {
    const rows = await asUser(db, ALICE_AUTH, (tx) =>
      tx.select({ userId: table.userId }).from(table),
    );
    expect(rows).toEqual([{ userId: ids.alice }]);
  });

  it("sees their own credential's status, never anyone else's", async () => {
    const rows = await asUser(db, ALICE_AUTH, (tx) =>
      tx
        .select({ userId: providerCredentials.userId, status: providerCredentials.status })
        .from(providerCredentials),
    );
    expect(rows).toEqual([{ userId: ids.alice, status: "live" }]);
  });

  it("can't read the sealed key or secret, even their own", async () => {
    await expect(
      asUser(db, ALICE_AUTH, (tx) =>
        tx.select({ sealedKey: providerCredentials.sealedKey }).from(providerCredentials),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("can't write anything", async () => {
    await expect(
      asUser(db, ALICE_AUTH, (tx) =>
        tx.update(dailyValues).set({ valuePence: 1 }).where(eq(dailyValues.userId, ids.alice!)),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it("reads shared market data but not the server's call budget", async () => {
    const shared = await asUser(db, BOB_AUTH, (tx) => tx.select({ key: prices.key }).from(prices));
    expect(shared).toEqual([{ key: "NVDA_US_EQ" }]);
    await expect(asUser(db, BOB_AUTH, (tx) => tx.select().from(sourceUsage))).rejects.toThrow(
      /permission denied/,
    );
  });

  it("sees nothing at all until their allowlist row is linked to their sign-in", async () => {
    const rows = await asUser(db, UNLINKED_AUTH, (tx) => tx.select().from(holdings));
    expect(rows).toEqual([]);
  });

  it("can't read shared prices or instruments with a Supabase session that isn't on the list", async () => {
    const stranger = "99999999-9999-4999-8999-999999999999";
    const seen = await asUser(db, stranger, async (tx) => ({
      instruments: await tx.select().from(instruments),
      prices: await tx.select().from(prices),
    }));
    expect(seen).toEqual({ instruments: [], prices: [] });
  });

  it("can't touch the allowlist or the waiting list at all", async () => {
    await expect(asUser(db, ALICE_AUTH, (tx) => tx.select().from(users))).rejects.toThrow(
      /permission denied/,
    );
    await expect(
      asUser(db, ALICE_AUTH, (tx) => tx.execute(sql`select * from waitlist`)),
    ).rejects.toThrow(/permission denied/);
  });

  it("leaves nothing behind: the next query on the connection is privileged again", async () => {
    await asUser(db, ALICE_AUTH, (tx) => tx.select().from(holdings));
    const role = await db.execute(sql`select current_user as role`);
    expect(JSON.stringify(role)).toMatch(/postgres/);
    const all = await db.select({ userId: holdings.userId }).from(holdings);
    expect(all).toHaveLength(2);
  });

  it("refuses an id that isn't a verified Supabase user id", async () => {
    await expect(asUser(db, "' or 1=1 --", async () => "nope")).rejects.toThrow(
      /verified Supabase user id/,
    );
  });
});
