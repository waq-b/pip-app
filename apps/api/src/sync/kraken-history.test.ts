import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { credentialContext } from "../crypto/reseal.js";
import { createSecretBox } from "../crypto/secrets.js";
import {
  dailyCloses,
  dailyValues,
  holdings,
  instruments,
  krakenLedger,
  providerCredentials,
  users,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { withFallback } from "../market/sources/fallback.js";
import type { PriceSource } from "../market/sources/types.js";
import { testDatabase } from "../test-support/pglite.js";
import {
  backfillKrakenHistory,
  createLedgerBook,
  groupByRefid,
  type LedgerRow,
} from "./kraken-history.js";
import type { CoinDirectory } from "./kraken.js";
import type { Credential } from "./poll.js";

const ALTNAMES = new Map([
  ["XXBT", "XBT"],
  ["XETH", "ETH"],
  ["ZGBP", "GBP"],
  ["ZUSD", "USD"],
  ["DOT", "DOT"],
  ["DOT.S", "DOT.S"],
]);

let n = 0;
function row(
  refid: string,
  day: string,
  asset: string,
  amount: number,
  balance: number,
  extra: Partial<LedgerRow> = {},
): LedgerRow {
  n += 1;
  return {
    entryId: `E${String(n).padStart(4, "0")}`,
    refid,
    at: new Date(`${day}T12:00:00Z`),
    type: "trade",
    subtype: "",
    asset,
    amount,
    fee: 0,
    balance,
    ...extra,
  };
}

const closes = (entries: Record<string, [string, number][]>) =>
  new Map(
    Object.entries(entries).map(([key, list]) => [
      key,
      list.map(([day, close]) => ({ day, close })),
    ]),
  );

function replay(entries: LedgerRow[], prices = closes({})) {
  const book = createLedgerBook(ALTNAMES, prices);
  for (const group of groupByRefid(entries)) book.apply(group);
  return Object.fromEntries(book.positions());
}

describe("working out a coin's cost from the ledger", () => {
  it("costs a coin bought with pounds at what was paid, without the fee", () => {
    expect(
      replay([
        row("buy", "2026-09-01", "ZGBP", -100, 0, { fee: 0.4 }),
        row("buy", "2026-09-01", "XXBT", 0.002, 0.002),
      ]),
    ).toEqual({ XBT: { quantity: 0.002, costPence: 10_000 } });
  });

  it("converts a dollar purchase at that day's rate", () => {
    const prices = closes({ "FX:GBPUSD": [["2026-09-01", 1.25]] });
    expect(
      replay(
        [row("buy", "2026-09-01", "ZUSD", -50, 0), row("buy", "2026-09-01", "XETH", 0.02, 0.02)],
        prices,
      ).ETH,
    ).toEqual({ quantity: 0.02, costPence: 4_000 });
  });

  it("takes cost away in proportion when some is sold", () => {
    expect(
      replay([
        row("buy", "2026-09-01", "ZGBP", -100, 0),
        row("buy", "2026-09-01", "XXBT", 0.002, 0.002),
        row("sell", "2026-09-05", "XXBT", -0.0005, 0.0015),
        row("sell", "2026-09-05", "ZGBP", 40, 40),
      ]).XBT,
    ).toEqual({ quantity: 0.0015, costPence: 7_500 });
  });

  it("counts staking rewards as free and moves into staking as the same coin", () => {
    expect(
      replay([
        row("buy", "2026-09-01", "ZGBP", -60, 0),
        row("buy", "2026-09-01", "DOT", 10, 10),
        row("stake", "2026-09-02", "DOT", -10, 0, { type: "transfer", subtype: "spottostaking" }),
        row("stake", "2026-09-02", "DOT.S", 10, 10, {
          type: "transfer",
          subtype: "stakingfromspot",
        }),
        row("reward", "2026-09-09", "DOT.S", 0.5, 10.5, { type: "staking" }),
      ]).DOT,
    ).toEqual({ quantity: 10.5, costPence: 6_000 });
  });

  it("values coins transferred in at that day's price, or leaves the cost unknown", () => {
    const prices = closes({ "kraken:ETH": [["2026-09-03", 2_000]] });
    expect(
      replay([row("in", "2026-09-03", "XETH", 0.5, 0.5, { type: "deposit" })], prices).ETH,
    ).toEqual({ quantity: 0.5, costPence: 100_000 });
    expect(replay([row("in", "2026-09-03", "XETH", 0.5, 0.5, { type: "deposit" })]).ETH).toEqual({
      quantity: 0.5,
      costPence: null,
    });
  });

  it("forgets an unknown cost once the coin is all gone and bought again", () => {
    expect(
      replay([
        row("in", "2026-09-01", "XETH", 0.5, 0.5, { type: "deposit" }),
        row("out", "2026-09-02", "XETH", -0.5, 0, { type: "withdrawal" }),
        row("buy", "2026-09-03", "ZGBP", -20, 0),
        row("buy", "2026-09-03", "XETH", 0.01, 0.01),
      ]).ETH,
    ).toEqual({ quantity: 0.01, costPence: 2_000 });
  });

  it("values a coin swapped for another at that day's price", () => {
    const prices = closes({ "kraken:ETH": [["2026-09-04", 2_000]] });
    const result = replay(
      [
        row("buy", "2026-09-01", "ZGBP", -100, 0),
        row("buy", "2026-09-01", "XXBT", 0.002, 0.002),
        row("swap", "2026-09-04", "XXBT", -0.001, 0.001),
        row("swap", "2026-09-04", "XETH", 0.03, 0.03),
      ],
      prices,
    );
    expect(result).toEqual({
      XBT: { quantity: 0.001, costPence: 5_000 },
      ETH: { quantity: 0.03, costPence: 6_000 },
    });
  });
});

describe("rebuilding Side Bet's history", () => {
  const box = createSecretBox({ version: 1, key: randomBytes(32) });
  const NOW = new Date("2026-09-06T10:00:00Z");
  let db: Db;
  let close: () => Promise<void>;
  let credential: Credential;

  const quiet: PriceSource = {
    id: "coingecko",
    label: "CoinGecko",
    quote: async () => {
      throw new Error("not needed");
    },
    dailyCloses: async () => [],
  };
  const market = () => withFallback([{ source: quiet, symbolFor: (target) => target }]);
  const directory: CoinDirectory = {
    altnames: async () => ALTNAMES,
    coinIds: async () => new Map([["XBT", "bitcoin"]]),
    details: async () => new Map([["bitcoin", { name: "Bitcoin", symbol: "BTC" }]]),
    gbpPair: async () => "XBTGBP",
  };

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
      providerCredentials,
      dailyCloses,
      instruments,
      users,
    ]) {
      await db.delete(table);
    }
    const [user] = await db.insert(users).values({ email: "w@example.test" }).returning();
    const base = { userId: user!.id, provider: "kraken", accountKind: "spot" };
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
      id: "kraken:XBT",
      isin: "",
      name: "Bitcoin",
      shortName: "BTC",
      currency: "GBP",
      type: "CRYPTO",
      coingeckoId: "bitcoin",
      krakenPair: "XBTGBP",
    });
    const entries = [
      row("buy1", "2026-09-02", "ZGBP", -100, 0),
      row("buy1", "2026-09-02", "XXBT", 0.002, 0.002),
      row("buy2", "2026-09-04", "ZGBP", -60, 0),
      row("buy2", "2026-09-04", "XXBT", 0.001, 0.003),
    ];
    await db.insert(krakenLedger).values(
      entries.map((entry) => ({
        ...entry,
        credentialId: credential.id,
        userId: credential.userId,
        amount: String(entry.amount),
        fee: String(entry.fee),
        balance: String(entry.balance),
      })),
    );
    await db.insert(dailyCloses).values(
      ["2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04", "2026-09-05"].map((day, i) => ({
        key: "kraken:XBT",
        day,
        close: String(50_000 + i * 1_000),
        currency: "GBP",
        source: "CoinGecko",
      })),
    );
  });

  async function holdNow(quantity: string) {
    await db
      .insert(holdings)
      .values({
        credentialId: credential.id,
        userId: credential.userId,
        instrumentId: "kraken:XBT",
        quantity,
        polledAt: NOW,
      })
      .onConflictDoNothing();
  }

  it("writes each day's value and cost up to yesterday, and sets the holding's cost", async () => {
    await holdNow("0.003");

    const outcome = await backfillKrakenHistory(db, credential, directory, market, NOW);

    expect(outcome).toEqual({ outcome: "done", days: 4, startsOn: "2026-09-02" });
    const rows = await db.select().from(dailyValues).orderBy(dailyValues.day);
    expect(rows.map((r) => [r.bucket, r.day, r.valuePence, r.costPence])).toEqual([
      ["Degen", "2026-09-02", 0.002 * 51_000 * 100, 10_000],
      ["Degen", "2026-09-03", 0.002 * 52_000 * 100, 10_000],
      ["Degen", "2026-09-04", 0.003 * 53_000 * 100, 16_000],
      ["Degen", "2026-09-05", 0.003 * 54_000 * 100, 16_000],
    ]);
    const [held] = await db.select().from(holdings);
    expect(held!.totalCostPence).toBe(16_000);
    const [stored] = await db.select().from(providerCredentials);
    expect(stored).toMatchObject({ backfillStatus: "done", historyStartsOn: "2026-09-02" });
  });

  it("writes nothing when the ledger doesn't end at what the account holds", async () => {
    await holdNow("0.5");
    const outcome = await backfillKrakenHistory(db, credential, directory, market, NOW);
    expect(outcome).toMatchObject({ outcome: "partial", reason: "holdings_mismatch", days: 0 });
    expect(await db.select().from(dailyValues)).toHaveLength(0);
  });

  it("is done at once for an account with no ledger", async () => {
    await db.delete(krakenLedger);
    expect(await backfillKrakenHistory(db, credential, directory, market, NOW)).toEqual({
      outcome: "done",
      days: 0,
      startsOn: "2026-09-06",
    });
  });
});
