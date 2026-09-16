import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { credentialContext } from "../crypto/reseal.js";
import { createSecretBox } from "../crypto/secrets.js";
import {
  cash,
  dailyValues,
  holdings,
  instruments,
  krakenLedger,
  prices,
  providerCredentials,
  users,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import {
  KrakenAuthError,
  KrakenUnavailableError,
  type KrakenBalance,
  type KrakenClient,
  type KrakenLedgerEntry,
} from "../providers/kraken/client.js";
import { testDatabase } from "../test-support/pglite.js";
import { liveConnectionService } from "./connections.js";
import { baseAsset, pollKraken, type CoinDirectory } from "./kraken.js";

const box = createSecretBox({ version: 1, key: randomBytes(32) });
const AUTH_ID = "55555555-5555-4555-8555-555555555555";
const NOW = new Date("2026-09-16T21:00:00Z");
let db: Db;
let close: () => Promise<void>;
let user: { userId: string; authUserId: string };

const ALTNAMES = new Map([
  ["XXBT", "XBT"],
  ["XETH", "ETH"],
  ["ZGBP", "GBP"],
  ["ZUSD", "USD"],
  ["DOT", "DOT"],
  ["DOT.S", "DOT.S"],
  ["DOT28.S", "DOT28.S"],
  ["CAD.HOLD", "CAD.HOLD"],
  ["ZCAD", "CAD"],
  ["PEPE", "PEPE"],
]);

const BALANCES: KrakenBalance[] = [
  { asset: "XXBT", balance: 0.01, holdTrade: 0 },
  { asset: "DOT", balance: 2, holdTrade: 0 },
  { asset: "DOT.S", balance: 10, holdTrade: 0 },
  { asset: "DOT28.S", balance: 3, holdTrade: 0 },
  { asset: "PEPE", balance: 1_000_000, holdTrade: 0 },
  { asset: "ZGBP", balance: 25.5, holdTrade: 5 },
  { asset: "ZUSD", balance: 13.4, holdTrade: 0 },
  { asset: "ZCAD", balance: 100, holdTrade: 0 },
  { asset: "XETH", balance: 0, holdTrade: 0 },
];

function entry(id: string, n: number): KrakenLedgerEntry {
  return {
    id,
    refid: `R${id}`,
    time: new Date(NOW.getTime() - n * 3_600_000),
    type: "trade",
    subtype: "",
    asset: "XXBT",
    amount: 0.001,
    fee: 0,
    balance: 0.01,
  };
}

function fakeKraken(
  overrides: Partial<KrakenClient> = {},
  ledger = [entry("L2", 1), entry("L1", 2)],
) {
  return {
    keyInfo: vi.fn(async () => ({ permissions: ["query-funds", "query-ledger"], ipAllowlist: [] })),
    balances: vi.fn(async () => BALANCES),
    ledger: vi.fn(async function* () {
      yield* ledger;
    }),
    ...overrides,
  } satisfies KrakenClient;
}

function fakeDirectory(): CoinDirectory {
  return {
    altnames: vi.fn(async () => ALTNAMES),
    coinIds: vi.fn(
      async () =>
        new Map([
          ["XBT", "bitcoin"],
          ["DOT", "polkadot"],
        ]),
    ),
    details: vi.fn(
      async (ids: string[]) =>
        new Map(
          ids.map((id) => [
            id,
            id === "bitcoin"
              ? { name: "Bitcoin", symbol: "BTC" }
              : { name: "Polkadot", symbol: "DOT" },
          ]),
        ),
    ),
    gbpPair: vi.fn(async (alt: string) => (alt === "XBT" || alt === "DOT" ? `${alt}GBP` : null)),
  };
}

async function storeCredential() {
  const base = { userId: user.userId, provider: "kraken", accountKind: "spot" };
  const [row] = await db
    .insert(providerCredentials)
    .values({
      ...base,
      sealedKey: box.seal("kraken-key", credentialContext(base, "key")),
      sealedSecret: box.seal("kraken-secret", credentialContext(base, "secret")),
      keyVersion: 1,
      status: "live",
      accountCurrency: "GBP",
      backfillStatus: "done",
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
    krakenLedger,
    dailyValues,
    holdings,
    cash,
    providerCredentials,
    prices,
    instruments,
    users,
  ]) {
    await db.delete(table);
  }
  const [row] = await db
    .insert(users)
    .values({ email: "waqar@example.test", authUserId: AUTH_ID })
    .returning();
  user = { userId: row!.id, authUserId: AUTH_ID };
  await db.insert(prices).values({
    key: "FX:GBPUSD",
    price: "1.34",
    currency: "USD",
    source: "Yahoo Finance",
    asOf: NOW,
    fetchedAt: NOW,
  });
});

describe("Kraken asset names", () => {
  it("merges staked, bonded and held views into the base asset", () => {
    expect(baseAsset("XXBT", ALTNAMES)).toEqual({ base: "XBT", staked: false, held: false });
    expect(baseAsset("DOT.S", ALTNAMES)).toEqual({ base: "DOT", staked: true, held: false });
    expect(baseAsset("DOT28.S", ALTNAMES)).toEqual({ base: "DOT", staked: true, held: false });
    expect(baseAsset("CAD.HOLD", ALTNAMES)).toEqual({ base: "CAD", staked: false, held: true });
  });
});

describe("polling a Kraken account", () => {
  it("stores coins as Side Bet holdings, fiat as cash in pounds, and the ledger", async () => {
    const credential = await storeCredential();
    const result = await pollKraken(db, box, credential, () => fakeKraken(), fakeDirectory(), NOW);

    expect(result).toEqual({
      outcome: "polled",
      holdings: 3,
      newInstruments: 3,
      newLedgerEntries: 2,
    });
    const held = await db.select().from(holdings).orderBy(holdings.instrumentId);
    expect(
      held.map((row) => [
        row.instrumentId,
        Number(row.quantity),
        row.stakedQuantity && Number(row.stakedQuantity),
      ]),
    ).toEqual([
      ["kraken:DOT", 15, 13],
      ["kraken:PEPE", 1_000_000, null],
      ["kraken:XBT", 0.01, null],
    ]);
    expect(held.every((row) => row.totalCostPence === null)).toBe(true);

    const [bitcoin] = await db.select().from(instruments).where(eq(instruments.id, "kraken:XBT"));
    expect(bitcoin).toMatchObject({
      name: "Bitcoin",
      shortName: "BTC",
      currency: "GBP",
      type: "CRYPTO",
      coingeckoId: "bitcoin",
      krakenPair: "XBTGBP",
    });
    const [pepe] = await db.select().from(instruments).where(eq(instruments.id, "kraken:PEPE"));
    expect(pepe).toMatchObject({ coingeckoId: null, krakenPair: null });

    // £20.50 free + £5 held for an order + $13.40 at 1.34 = £10; Canadian dollars left out.
    const [money] = await db.select().from(cash);
    expect(money).toMatchObject({ availablePence: 3050, reservedPence: 500, inPiesPence: 0 });

    expect(await db.select().from(krakenLedger)).toHaveLength(2);
    const [stored] = await db.select().from(providerCredentials);
    expect(stored).toMatchObject({ status: "live", lastPolledAt: NOW });
  });

  it("reads only new ledger entries, and doesn't look up known coins again", async () => {
    const credential = await storeCredential();
    await pollKraken(db, box, credential, () => fakeKraken(), fakeDirectory(), NOW);
    const directory = fakeDirectory();
    const later = fakeKraken({}, [entry("L3", 0), entry("L2", 1), entry("L1", 2)]);

    const result = await pollKraken(db, box, credential, () => later, directory, NOW);

    expect(result).toMatchObject({ outcome: "polled", newInstruments: 0, newLedgerEntries: 1 });
    expect(await db.select().from(krakenLedger)).toHaveLength(3);
    expect(directory.coinIds).not.toHaveBeenCalled();
  });

  it("stops using a key that has since been given trading rights", async () => {
    const credential = await storeCredential();
    const risky = fakeKraken({
      keyInfo: async () => ({
        permissions: ["query-funds", "query-ledger", "modify-trades"],
        ipAllowlist: [],
      }),
    });
    const result = await pollKraken(db, box, credential, () => risky, fakeDirectory(), NOW);

    expect(result).toMatchObject({ outcome: "too_much_access" });
    expect(risky.balances).not.toHaveBeenCalled();
    expect(await db.select().from(holdings)).toHaveLength(0);
    const [stored] = await db.select().from(providerCredentials);
    expect(stored!.status).toBe("error");
  });

  it("marks a rejected key invalid, and keeps what it had when Kraken is down", async () => {
    const credential = await storeCredential();
    await pollKraken(db, box, credential, () => fakeKraken(), fakeDirectory(), NOW);

    const down = fakeKraken({
      balances: async () => {
        throw new KrakenUnavailableError("EService:Unavailable");
      },
    });
    expect(await pollKraken(db, box, credential, () => down, fakeDirectory(), NOW)).toEqual({
      outcome: "unavailable",
    });
    expect(await db.select().from(holdings)).toHaveLength(3);

    const rejected = fakeKraken({
      keyInfo: async () => {
        throw new KrakenAuthError();
      },
    });
    expect(await pollKraken(db, box, credential, () => rejected, fakeDirectory(), NOW)).toEqual({
      outcome: "invalid_key",
    });
    const [stored] = await db.select().from(providerCredentials);
    expect(stored!.status).toBe("invalid");
  });
});

describe("connecting Kraken", () => {
  function service(client: KrakenClient = fakeKraken()) {
    const clientFor = vi.fn(() => client);
    return {
      clientFor,
      connections: liveConnectionService({
        db,
        box,
        keyVersion: 1,
        clientFor: vi.fn(),
        kraken: { clientFor, directory: fakeDirectory() },
        now: () => NOW,
      }),
    };
  }
  const request = { key: "kraken-api-key-0123456789", secret: "kraken-private-key-0123456789" };

  it("checks the key can't move money, seals it and polls", async () => {
    const { connections, clientFor } = service();
    const result = await connections.connect(user, "kraken", request);

    expect(result).toMatchObject({ outcome: "connected", provider: "kraken" });
    expect(clientFor).toHaveBeenCalledWith(request.key, request.secret);
    const [stored] = await db.select().from(providerCredentials);
    expect(stored).toMatchObject({ provider: "kraken", accountKind: "spot", status: "live" });
    expect(stored!.sealedSecret).not.toContain(request.secret);
    expect(box.open(stored!.sealedSecret, credentialContext(stored!, "secret"))).toBe(
      request.secret,
    );
    expect(await db.select().from(holdings)).toHaveLength(3);

    const kraken = (await connections.list(user)).find((c) => c.provider === "kraken");
    expect(kraken).toMatchObject({
      status: "live",
      holdingsSeen: 3,
      feeds: ["Degen"],
      available: true,
      permissionsVerified: true,
    });
  });

  it("refuses a key that can trade or withdraw, stores nothing, and says what to untick", async () => {
    const risky = fakeKraken({
      keyInfo: async () => ({
        permissions: ["query-funds", "query-ledger", "withdraw-funds", "modify-trades"],
        ipAllowlist: [],
      }),
    });
    const result = await service(risky).connections.connect(user, "kraken", request);

    expect(result.outcome).toBe("too_much_access");
    expect(result.permissions).toEqual([
      { name: "Query funds", granted: true, required: true },
      { name: "Query ledger entries", granted: true, required: true },
      { name: "Withdraw", granted: true, required: false },
      { name: "Create & modify orders", granted: true, required: false },
    ]);
    expect(risky.balances).not.toHaveBeenCalled();
    expect(await db.select().from(providerCredentials)).toHaveLength(0);
  });

  it("names a missing permission", async () => {
    const partial = fakeKraken({
      keyInfo: async () => ({ permissions: ["query-funds"], ipAllowlist: [] }),
    });
    const result = await service(partial).connections.connect(user, "kraken", request);
    expect(result).toMatchObject({
      outcome: "missing_permission",
      missingPermission: "Query ledger entries",
    });
    expect(await db.select().from(providerCredentials)).toHaveLength(0);
  });

  it("needs both halves of the key, and reports an unknown one", async () => {
    const { connections } = service(
      fakeKraken({
        keyInfo: async () => {
          throw new KrakenAuthError();
        },
      }),
    );
    expect((await connections.connect(user, "kraken", { key: request.key })).outcome).toBe(
      "invalid_key",
    );
    expect((await connections.connect(user, "kraken", request)).outcome).toBe("invalid_key");
    expect(await db.select().from(providerCredentials)).toHaveLength(0);
  });

  it("disconnects: the key, holdings, ledger and Side Bet's history go", async () => {
    const { connections } = service();
    await connections.connect(user, "kraken", request);
    await db.insert(dailyValues).values({
      userId: user.userId,
      bucket: "Degen",
      day: "2026-09-15",
      valuePence: 100,
      costPence: 100,
      source: "snapshot",
    });

    await connections.disconnect(user, "kraken");

    expect(await db.select().from(providerCredentials)).toHaveLength(0);
    expect(await db.select().from(holdings)).toHaveLength(0);
    expect(await db.select().from(krakenLedger)).toHaveLength(0);
    expect(await db.select().from(dailyValues)).toHaveLength(0);
  });

  it("says Kraken isn't available when it isn't configured", async () => {
    const connections = liveConnectionService({ db, box, keyVersion: 1, clientFor: vi.fn() });
    expect((await connections.connect(user, "kraken", request)).outcome).toBe("not_available_yet");
    const kraken = (await connections.list(user)).find((c) => c.provider === "kraken");
    expect(kraken!.available).toBe(false);
  });
});
