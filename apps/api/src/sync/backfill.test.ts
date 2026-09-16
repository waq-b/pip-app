import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { credentialContext } from "../crypto/reseal.js";
import { createSecretBox } from "../crypto/secrets.js";
import {
  dailyCloses,
  dailyValues,
  holdings,
  instruments,
  providerCredentials,
  trades,
  users,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { withFallback } from "../market/sources/fallback.js";
import type { PriceSource } from "../market/sources/types.js";
import type { T212Client, T212Fill } from "../providers/t212/client.js";
import { testDatabase } from "../test-support/pglite.js";
import { backfillHistory } from "./backfill.js";
import type { Credential } from "./poll.js";

const box = createSecretBox({ version: 1, key: randomBytes(32) });
// Wednesday 16 Sep 2026, 15:00 London.
const NOW = new Date("2026-09-16T14:00:00Z");
let db: Db;
let close: () => Promise<void>;
let credential: Credential;

function fill(overrides: Partial<T212Fill>): T212Fill {
  return {
    orderId: "o",
    fillId: "f",
    ticker: "GRGl_EQ",
    side: "BUY",
    status: "FILLED",
    quantity: 10,
    price: 1700,
    filledAt: "2026-09-10T10:00:00.000Z",
    walletCurrency: "GBP",
    netValue: 170,
    fees: 0,
    ...overrides,
  };
}

function client(fills: T212Fill[]): T212Client {
  return {
    accountSummary: async () => {
      throw new Error("not needed");
    },
    positions: async () => [],
    instruments: async () => [],
    exchanges: async () => [],
    async *fills() {
      yield* fills;
    },
  };
}

/** A market with no network: every close it's asked for is already in the table. */
const quietSource: PriceSource = {
  id: "yahoo",
  label: "Yahoo Finance",
  quote: async () => {
    throw new Error("not needed");
  },
  dailyCloses: async () => [],
};
const market = () => withFallback([{ source: quietSource, symbolFor: (target) => target }]);

async function setHolding(quantity: string) {
  await db.delete(holdings);
  await db.insert(holdings).values({
    credentialId: credential.id,
    userId: credential.userId,
    instrumentId: "GRGl_EQ",
    quantity,
    averagePricePaid: "1700",
    totalCostPence: 17_000,
    polledAt: NOW,
  });
}

async function closesFor(days: [string, number][]) {
  await db.insert(dailyCloses).values(
    days.map(([day, value]) => ({
      key: "GRGl_EQ",
      day,
      close: String(value),
      currency: "GBX",
      source: "Yahoo Finance",
    })),
  );
}

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
});
afterAll(async () => close());

beforeEach(async () => {
  for (const table of [
    dailyValues,
    trades,
    holdings,
    dailyCloses,
    providerCredentials,
    instruments,
    users,
  ]) {
    await db.delete(table);
  }
  const [user] = await db.insert(users).values({ email: "w@example.test" }).returning();
  const base = { userId: user!.id, provider: "trading212", accountKind: "isa" };
  [credential] = (await db
    .insert(providerCredentials)
    .values({
      ...base,
      sealedKey: box.seal("k", credentialContext(base, "key")),
      sealedSecret: box.seal("s", credentialContext(base, "secret")),
      keyVersion: 1,
      status: "live",
      accountCurrency: "GBP",
    })
    .returning()) as [Credential];
  await db.insert(instruments).values({
    id: "GRGl_EQ",
    isin: "GB00B63QSB39",
    name: "Greggs",
    shortName: "GRG",
    currency: "GBX",
    type: "STOCK",
    yahooSymbol: "GRG.L",
  });
});

const run = (fills: T212Fill[]) =>
  backfillHistory(db, box, credential, () => client(fills), market, NOW);
const values = async () =>
  (await db.select().from(dailyValues).orderBy(dailyValues.day)).map((row) => [
    row.day,
    row.valuePence,
    row.costPence,
    row.source,
  ]);

describe("rebuilding history from order history", () => {
  it("values what was held each day at that day's close, carrying prices over the weekend", async () => {
    await setHolding("10");
    await closesFor([
      ["2026-09-10", 1700],
      ["2026-09-11", 1750],
      ["2026-09-14", 1800],
      ["2026-09-15", 1760],
    ]);

    const result = await run([fill({ fillId: "1" })]);

    expect(result).toEqual({ outcome: "done", days: 6, startsOn: "2026-09-10" });
    expect(await values()).toEqual([
      ["2026-09-10", 17_000, 17_000, "backfill"],
      ["2026-09-11", 17_500, 17_000, "backfill"],
      ["2026-09-12", 17_500, 17_000, "backfill"],
      ["2026-09-13", 17_500, 17_000, "backfill"],
      ["2026-09-14", 18_000, 17_000, "backfill"],
      ["2026-09-15", 17_600, 17_000, "backfill"],
    ]);
    const [stored] = await db.select().from(providerCredentials);
    expect(stored).toMatchObject({ backfillStatus: "done", historyStartsOn: "2026-09-10" });
  });

  it("follows buys and sells, removing cost in proportion on a sale", async () => {
    await setHolding("5");
    await closesFor([
      ["2026-09-10", 1700],
      ["2026-09-14", 1800],
    ]);

    await run([
      fill({ fillId: "1", filledAt: "2026-09-10T10:00:00.000Z" }),
      fill({
        fillId: "2",
        side: "SELL",
        quantity: 5,
        netValue: 90,
        filledAt: "2026-09-14T10:00:00.000Z",
      }),
    ]);

    const rows = await values();
    expect(rows.find((row) => row[0] === "2026-09-13")).toEqual([
      "2026-09-13",
      17_000,
      17_000,
      "backfill",
    ]);
    expect(rows.find((row) => row[0] === "2026-09-14")).toEqual([
      "2026-09-14",
      9_000,
      8_500,
      "backfill",
    ]);
  });

  it("counts cost without fees, matching Trading 212's own cost basis", async () => {
    await setHolding("10");
    await closesFor([["2026-09-10", 1700]]);
    // £170 spent including £5 stamp duty: T212 records a £165 cost.
    await run([fill({ fillId: "1", netValue: 170, fees: 5 })]);
    expect((await values())[0]).toEqual(["2026-09-10", 17_000, 16_500, "backfill"]);
  });

  it("never overwrites a real daily snapshot", async () => {
    await setHolding("10");
    await closesFor([["2026-09-10", 1700]]);
    await db.insert(dailyValues).values({
      userId: credential.userId,
      bucket: "Base",
      day: "2026-09-11",
      valuePence: 12_345,
      costPence: 17_000,
      source: "snapshot",
    });

    await run([fill({ fillId: "1" })]);

    expect((await values()).find((row) => row[0] === "2026-09-11")).toEqual([
      "2026-09-11",
      12_345,
      17_000,
      "snapshot",
    ]);
  });

  it("writes nothing when the fills don't add up to what's held now", async () => {
    await setHolding("25"); // e.g. shares transferred in, which order history doesn't show
    await closesFor([["2026-09-10", 1700]]);

    const result = await run([fill({ fillId: "1" })]);

    expect(result).toEqual({
      outcome: "partial",
      reason: "holdings_mismatch",
      days: 0,
      startsOn: "2026-09-16",
    });
    expect(await values()).toEqual([]);
  });

  it("starts history on the first day it can price, and says it's partial", async () => {
    await setHolding("10");
    await closesFor([["2026-09-14", 1800]]); // nothing before the 14th

    const result = await run([fill({ fillId: "1" })]);

    expect(result).toMatchObject({
      outcome: "partial",
      reason: "prices_missing",
      startsOn: "2026-09-14",
    });
    expect((await values())[0]![0]).toBe("2026-09-14");
  });

  it("can run twice without counting a trade twice", async () => {
    await setHolding("10");
    await closesFor([["2026-09-10", 1700]]);
    await run([fill({ fillId: "1" })]);
    const again = await run([fill({ fillId: "1" })]);

    expect(again.outcome).toBe("done");
    expect(
      await db.select().from(trades).where(eq(trades.credentialId, credential.id)),
    ).toHaveLength(1);
  });

  it("marks itself failed if something goes wrong, rather than half-writing", async () => {
    const broken: T212Client = {
      ...client([]),
      fills: () =>
        ({
          [Symbol.asyncIterator]() {
            return this;
          },
          next: async () => {
            throw new Error("T212 down");
          },
          return: async () => ({ done: true, value: undefined }),
          throw: async () => ({ done: true, value: undefined }),
        }) as unknown as ReturnType<T212Client["fills"]>,
    };
    const result = await backfillHistory(db, box, credential, () => broken, market, NOW);
    expect(result).toEqual({ outcome: "failed" });
    expect((await db.select().from(providerCredentials))[0]!.backfillStatus).toBe("failed");
  });
});
