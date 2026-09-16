import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialContext } from "../crypto/reseal.js";
import { createSecretBox } from "../crypto/secrets.js";
import {
  cash,
  dailyValues,
  holdings,
  instruments,
  marketSchedules,
  prices,
  providerCredentials,
  users,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import {
  T212AuthError,
  T212PermissionError,
  T212UnavailableError,
  type T212AccountSummary,
  type T212Client,
  type T212Exchange,
  type T212Instrument,
  type T212Position,
} from "../providers/t212/client.js";
import { testDatabase } from "../test-support/pglite.js";
import {
  credentialsDue,
  londonDay,
  pollCredential,
  snapshotDailyValues,
  type Credential,
} from "./poll.js";

const recorded = <T>(name: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../fixtures/recorded/t212", name), "utf8"),
  ) as T;

const box = createSecretBox({ version: 1, key: randomBytes(32) });
const NOW = new Date("2026-09-16T15:00:00Z");
let db: Db;
let close: () => Promise<void>;
let userId: string;

function fakeClient(overrides: Partial<T212Client> = {}): T212Client {
  return {
    accountSummary: vi.fn(async () => recorded<T212AccountSummary>("account-summary.json")),
    positions: vi.fn(async () => recorded<T212Position[]>("positions.json")),
    instruments: vi.fn(async () => recorded<T212Instrument[]>("instruments-sample.json")),
    exchanges: vi.fn(async () => recorded<T212Exchange[]>("exchanges-sample.json")),
    fills: async function* () {},
    ...overrides,
  };
}

async function addCredential(accountKind = "isa"): Promise<Credential> {
  const base = { userId, provider: "trading212", accountKind };
  const [row] = await db
    .insert(providerCredentials)
    .values({
      ...base,
      sealedKey: box.seal("practice-key", credentialContext(base, "key")),
      sealedSecret: box.seal("practice-secret", credentialContext(base, "secret")),
      keyVersion: 1,
      status: "live",
      accountCurrency: "GBP",
    })
    .returning();
  return row!;
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
    holdings,
    cash,
    providerCredentials,
    prices,
    instruments,
    marketSchedules,
    users,
  ]) {
    await db.delete(table);
  }
  const [user] = await db.insert(users).values({ email: "waqar@example.test" }).returning();
  userId = user!.id;
});

describe("polling a Trading 212 account", () => {
  it("opens the sealed key in memory and hands it only to the client", async () => {
    const credential = await addCredential();
    const clientFor = vi.fn(() => fakeClient());
    await pollCredential(db, box, credential, clientFor, NOW);
    expect(clientFor).toHaveBeenCalledWith("practice-key", "practice-secret");
  });

  it("stores holdings and cash, learns new instruments and their market hours", async () => {
    const credential = await addCredential();
    const result = await pollCredential(db, box, credential, () => fakeClient(), NOW);

    expect(result).toEqual({ outcome: "polled", holdings: 4, newInstruments: 4 });
    const held = await db.select().from(holdings).where(eq(holdings.credentialId, credential.id));
    expect(held.map((h) => h.instrumentId).sort()).toEqual([
      "ASMLa_EQ",
      "GRGl_EQ",
      "NVDA_US_EQ",
      "VWRLl_EQ",
    ]);
    const [greggs] = await db.select().from(instruments).where(eq(instruments.id, "GRGl_EQ"));
    expect(greggs).toMatchObject({ currency: "GBX", yahooSymbol: "GRG.L", workingScheduleId: 55 });
    expect((await db.select().from(marketSchedules)).length).toBeGreaterThan(0);
    const [account] = await db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.id, credential.id));
    expect(account!.lastPolledAt).toEqual(NOW);
  });

  it("doesn't refetch instrument metadata when nothing is new", async () => {
    const credential = await addCredential();
    await pollCredential(db, box, credential, () => fakeClient(), NOW);
    const client = fakeClient();
    await pollCredential(db, box, credential, () => client, new Date(NOW.getTime() + 60_000));
    expect(client.instruments).not.toHaveBeenCalled();
    expect(client.exchanges).not.toHaveBeenCalled();
  });

  it("replaces holdings wholesale, so a sold holding disappears", async () => {
    const credential = await addCredential();
    await pollCredential(db, box, credential, () => fakeClient(), NOW);
    const onlyNvidia = recorded<T212Position[]>("positions.json").slice(0, 1);
    await pollCredential(
      db,
      box,
      credential,
      () => fakeClient({ positions: async () => onlyNvidia }),
      NOW,
    );
    expect(await db.select().from(holdings)).toHaveLength(1);
  });

  it.each([
    ["a key T212 no longer recognises", new T212AuthError(), { outcome: "invalid_key" }, "invalid"],
    [
      "a missing permission",
      new T212PermissionError("Portfolio"),
      { outcome: "missing_permission", permission: "Portfolio" },
      "error",
    ],
    ["T212 being down", new T212UnavailableError(503), { outcome: "unavailable" }, "live"],
  ] as const)("handles %s", async (_label, error, outcome, status) => {
    const credential = await addCredential();
    const failing = fakeClient({
      positions: async () => {
        throw error;
      },
    });
    expect(await pollCredential(db, box, credential, () => failing, NOW)).toEqual(outcome);
    const [account] = await db
      .select()
      .from(providerCredentials)
      .where(eq(providerCredentials.id, credential.id));
    expect(account!.status).toBe(status);
  });

  it("refuses an account that isn't in pounds", async () => {
    const credential = await addCredential();
    const euros = { ...recorded<T212AccountSummary>("account-summary.json"), currency: "EUR" };
    const result = await pollCredential(
      db,
      box,
      credential,
      () => fakeClient({ accountSummary: async () => euros }),
      NOW,
    );
    expect(result).toEqual({ outcome: "not_pounds", currency: "EUR" });
  });

  it("finds accounts due a poll", async () => {
    const credential = await addCredential();
    expect((await credentialsDue(db, NOW, 10 * 60_000)).map((c) => c.id)).toEqual([credential.id]);
    await pollCredential(db, box, credential, () => fakeClient(), NOW);
    expect(await credentialsDue(db, new Date(NOW.getTime() + 60_000), 10 * 60_000)).toEqual([]);
  });
});

describe("daily snapshots", () => {
  async function priced() {
    await db.insert(prices).values([
      { key: "NVDA_US_EQ", price: "215.405", currency: "USD", source: "Yahoo Finance", asOf: NOW },
      { key: "GRGl_EQ", price: "1749", currency: "GBX", source: "Yahoo Finance", asOf: NOW },
      { key: "ASMLa_EQ", price: "1398.2", currency: "EUR", source: "Yahoo Finance", asOf: NOW },
      { key: "VWRLl_EQ", price: "137.98", currency: "GBP", source: "Yahoo Finance", asOf: NOW },
      { key: "FX:GBPUSD", price: "1.3452", currency: "USD", source: "Yahoo Finance", asOf: NOW },
      { key: "FX:GBPEUR", price: "1.1655", currency: "EUR", source: "Yahoo Finance", asOf: NOW },
    ]);
  }

  it("values the pot from market prices, landing close to Trading 212's own figure", async () => {
    const credential = await addCredential("isa");
    await pollCredential(db, box, credential, () => fakeClient(), NOW);
    await priced();

    expect(await snapshotDailyValues(db, userId, "2026-09-16")).toEqual({
      written: ["Base"],
      skipped: [],
    });
    const [foundation] = await db.select().from(dailyValues);
    const t212 = Math.round(recorded<T212AccountSummary>("account-summary.json").totalValue * 100);
    expect(foundation).toMatchObject({
      bucket: "Base",
      day: "2026-09-16",
      costPence: 499_050,
      source: "snapshot",
    });
    expect(Math.abs(foundation!.valuePence - t212) / t212).toBeLessThan(0.002);
  });

  it("skips a pot it can't price rather than writing a wrong number", async () => {
    const credential = await addCredential("isa");
    await pollCredential(db, box, credential, () => fakeClient(), NOW);
    expect(await snapshotDailyValues(db, userId, "2026-09-16")).toEqual({
      written: [],
      skipped: ["Base"],
    });
    expect(await db.select().from(dailyValues)).toEqual([]);
  });

  it("dates by London's calendar", () => {
    expect(londonDay(new Date("2026-09-16T23:30:00Z"))).toBe("2026-09-17");
  });
});
