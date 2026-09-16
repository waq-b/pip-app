import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../app.js";
import { jobSecretMatches } from "../auth/guard.js";
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
  trades,
  users,
} from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { withFallback } from "../market/sources/fallback.js";
import type { PriceSource } from "../market/sources/types.js";
import type {
  T212AccountSummary,
  T212Client,
  T212Exchange,
  T212Instrument,
  T212Position,
} from "../providers/t212/client.js";
import { testAuth } from "../test-support/auth.js";
import { testDatabase } from "../test-support/pglite.js";
import { createRefreshJob } from "./refresh-job.js";

describe("the job door", () => {
  const secret = "job-secret-for-tests-0123456789";

  it("compares secrets without leaking them", () => {
    expect(jobSecretMatches(secret, secret)).toBe(true);
    expect(jobSecretMatches(secret, "wrong")).toBe(false);
    expect(jobSecretMatches(secret, undefined)).toBe(false);
    expect(jobSecretMatches(undefined, secret)).toBe(false);
    expect(jobSecretMatches("", "")).toBe(false);
  });

  it("answers 202 straight away with the right secret, and starts the job", async () => {
    const run = vi.fn(() => new Promise(() => {})); // never finishes — the route mustn't wait
    const app = buildApp({ ...testAuth().options, jobSecret: secret, refreshJob: { run } });
    const response = await app.inject({
      method: "POST",
      url: "/jobs/refresh",
      headers: { "x-job-secret": secret },
    });
    expect(response.statusCode).toBe(202);
    expect(run).toHaveBeenCalledOnce();
  });

  it.each([
    ["no secret", {}],
    ["the wrong secret", { "x-job-secret": "nope" }],
    ["a user token instead", { authorization: "Bearer anything" }],
  ])("refuses %s", async (_label, headers) => {
    const run = vi.fn();
    const app = buildApp({ ...testAuth().options, jobSecret: secret, refreshJob: { run } });
    const response = await app.inject({ method: "POST", url: "/jobs/refresh", headers });
    expect(response.statusCode).toBe(401);
    expect(run).not.toHaveBeenCalled();
  });

  it("refuses everyone when no job secret is configured", async () => {
    const app = buildApp(testAuth().options);
    const response = await app.inject({
      method: "POST",
      url: "/jobs/refresh",
      headers: { "x-job-secret": "" },
    });
    expect(response.statusCode).toBe(401);
  });
});

describe("the scheduled refresh", () => {
  const recorded = <T>(name: string) =>
    JSON.parse(
      readFileSync(resolve(import.meta.dirname, "../../fixtures/recorded/t212", name), "utf8"),
    ) as T;
  const box = createSecretBox({ version: 1, key: randomBytes(32) });
  const NOW = new Date("2026-09-16T14:00:00Z");
  let db: Db;
  let close: () => Promise<void>;

  const client: T212Client = {
    accountSummary: vi.fn(async () => recorded<T212AccountSummary>("account-summary.json")),
    positions: vi.fn(async () => recorded<T212Position[]>("positions.json")),
    instruments: async () => recorded<T212Instrument[]>("instruments-sample.json"),
    exchanges: async () => recorded<T212Exchange[]>("exchanges-sample.json"),
    async *fills() {
      yield* [];
    },
  };
  const source: PriceSource = {
    id: "yahoo",
    label: "Yahoo Finance",
    quote: vi.fn(async (target) => ({
      price: target.kind === "fx" ? 1.3 : 100,
      previousClose: null,
      currency: target.kind === "fx" ? target.quote : target.currency,
      asOf: NOW,
    })),
    dailyCloses: async () => [],
  };

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
      cash,
      providerCredentials,
      prices,
      instruments,
      marketSchedules,
      users,
    ]) {
      await db.delete(table);
    }
    const [user] = await db.insert(users).values({ email: "w@example.test" }).returning();
    const base = { userId: user!.id, provider: "trading212", accountKind: "isa" };
    await db.insert(providerCredentials).values({
      ...base,
      sealedKey: box.seal("k", credentialContext(base, "key")),
      sealedSecret: box.seal("s", credentialContext(base, "secret")),
      keyVersion: 1,
      status: "live",
      accountCurrency: "GBP",
    });
  });

  const job = () =>
    createRefreshJob({
      db,
      box,
      clientFor: () => client,
      marketFor: () => withFallback([{ source, symbolFor: (target) => target }]),
      now: () => NOW,
    });

  it("polls, rebuilds history, refreshes prices and saves today's values in one go", async () => {
    const summary = await job().run();

    expect(summary).toMatchObject({
      polled: 1,
      backfilled: 1,
      pricesRefreshed: 6,
      snapshots: 1,
      errors: [],
    });
    const [today] = await db.select().from(dailyValues);
    expect(today).toMatchObject({ bucket: "Base", day: "2026-09-16", source: "snapshot" });
    const [account] = await db.select().from(providerCredentials);
    expect(account!.backfillStatus).toBe("done");
  });

  it("does nothing twice: a second run finds everything fresh", async () => {
    const refresh = job();
    await refresh.run();
    vi.mocked(client.positions).mockClear();
    const second = await refresh.run();
    expect(second).toMatchObject({ polled: 0, backfilled: 0, pricesRefreshed: 0 });
    expect(client.positions).not.toHaveBeenCalled();
  });

  it("joins a run already in progress instead of starting another", async () => {
    const refresh = job();
    const [first, second] = [refresh.run(), refresh.run()];
    expect(first).toBe(second);
    await first;
  });
});
