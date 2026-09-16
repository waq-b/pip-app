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
import { liveConnectionService } from "./connections.js";

const recorded = <T>(name: string) =>
  JSON.parse(
    readFileSync(resolve(import.meta.dirname, "../../fixtures/recorded/t212", name), "utf8"),
  ) as T;

const box = createSecretBox({ version: 1, key: randomBytes(32) });
const AUTH_ID = "44444444-4444-4444-8444-444444444444";
let db: Db;
let close: () => Promise<void>;
let user: { userId: string; authUserId: string };

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

function service(client: T212Client = fakeClient(), onConnected = vi.fn()) {
  const clientFor = vi.fn(() => client);
  return {
    clientFor,
    onConnected,
    connections: liveConnectionService({ db, box, keyVersion: 1, clientFor, onConnected }),
  };
}

const request = {
  accountKind: "isa" as const,
  key: "practice-key-0123456789",
  secret: "practice-secret-0123",
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
    holdings,
    cash,
    providerCredentials,
    instruments,
    marketSchedules,
    users,
  ]) {
    await db.delete(table);
  }
  const [row] = await db
    .insert(users)
    .values({ email: "waqar@example.test", authUserId: AUTH_ID })
    .returning();
  user = { userId: row!.id, authUserId: AUTH_ID };
});

describe("connecting a Trading 212 account", () => {
  it("validates the key, seals it, polls straight away and reports connected", async () => {
    const { connections, clientFor, onConnected } = service();
    const result = await connections.connect(user, "trading212", request);

    expect(result).toMatchObject({ outcome: "connected", accountKind: "isa" });
    expect(clientFor).toHaveBeenCalledWith(request.key, request.secret);
    const [stored] = await db.select().from(providerCredentials);
    expect(stored).toMatchObject({
      provider: "trading212",
      accountKind: "isa",
      status: "live",
      keyVersion: 1,
    });
    expect(stored!.sealedKey).not.toContain(request.key);
    expect(box.open(stored!.sealedKey, credentialContext(stored!, "key"))).toBe(request.key);
    expect(await db.select().from(holdings)).toHaveLength(4);
    expect(onConnected).toHaveBeenCalledOnce();
  });

  it("reads the account summary and positions once, not again for the first poll", async () => {
    const client = fakeClient();
    await service(client).connections.connect(user, "trading212", request);
    expect(client.accountSummary).toHaveBeenCalledOnce();
    expect(client.positions).toHaveBeenCalledOnce();
  });

  it("refuses the same Trading 212 account for a second pot, storing nothing", async () => {
    const { connections } = service();
    await connections.connect(user, "trading212", request);
    const [isa] = await db.select().from(providerCredentials);
    expect(isa!.providerAccountId).toBe(
      String(recorded<T212AccountSummary>("account-summary.json").id),
    );

    const result = await connections.connect(user, "trading212", {
      ...request,
      accountKind: "invest",
      key: "the-same-practice-key-again",
    });

    expect(result).toMatchObject({ outcome: "same_account", accountKind: "invest" });
    expect(result.message).toContain("already connected as Trading 212 ISA");
    const rows = await db.select().from(providerCredentials);
    expect(rows.map((row) => row.accountKind)).toEqual(["isa"]);
  });

  it("connects a different Trading 212 account to the other pot", async () => {
    const summary = recorded<T212AccountSummary>("account-summary.json");
    await service().connections.connect(user, "trading212", request);
    const invest = fakeClient({
      accountSummary: vi.fn(async () => ({ ...summary, id: summary.id + 1 })),
    });
    const result = await service(invest).connections.connect(user, "trading212", {
      ...request,
      accountKind: "invest",
    });
    expect(result.outcome).toBe("connected");
    expect(await db.select().from(providerCredentials)).toHaveLength(2);
  });

  it("replaces the key when the same account is connected again", async () => {
    const { connections } = service();
    await connections.connect(user, "trading212", request);
    await connections.connect(user, "trading212", { ...request, key: "a-newer-practice-key-000" });
    const rows = await db.select().from(providerCredentials);
    expect(rows).toHaveLength(1);
    expect(box.open(rows[0]!.sealedKey, credentialContext(rows[0]!, "key"))).toBe(
      "a-newer-practice-key-000",
    );
  });

  it.each([
    ["an unrecognised key", new T212AuthError(), "invalid_key"],
    ["a missing permission", new T212PermissionError("Account data"), "missing_permission"],
    ["Trading 212 being down", new T212UnavailableError(503), "unavailable"],
  ] as const)("stores nothing for %s", async (_label, error, outcome) => {
    const failing = fakeClient({
      accountSummary: async () => {
        throw error;
      },
    });
    const result = await service(failing).connections.connect(user, "trading212", request);
    expect(result.outcome).toBe(outcome);
    expect(await db.select().from(providerCredentials)).toEqual([]);
  });

  it("names the missing permission", async () => {
    const failing = fakeClient({
      positions: async () => {
        throw new T212PermissionError("Portfolio");
      },
    });
    const result = await service(failing).connections.connect(user, "trading212", request);
    expect(result).toMatchObject({ outcome: "missing_permission", missingPermission: "Portfolio" });
    expect(result.message).toMatch(/^That key can't see your Portfolio\./);
  });

  it("refuses an account that isn't in pounds", async () => {
    const euros = { ...recorded<T212AccountSummary>("account-summary.json"), currency: "EUR" };
    const result = await service(
      fakeClient({ accountSummary: async () => euros }),
    ).connections.connect(user, "trading212", request);
    expect(result.outcome).toBe("not_pounds");
    expect(await db.select().from(providerCredentials)).toEqual([]);
  });

  it("needs both halves of the key", async () => {
    const result = await service().connections.connect(user, "trading212", {
      accountKind: "isa",
      key: "k",
    });
    expect(result.outcome).toBe("invalid_key");
  });

  it("says Kraken isn't available yet", async () => {
    const result = await service().connections.connect(user, "kraken", {
      key: "anything-at-all-0000",
    });
    expect(result.outcome).toBe("not_available_yet");
  });
});

describe("listing and disconnecting", () => {
  it("lists both Trading 212 accounts and Kraken, reading as the user", async () => {
    const { connections } = service();
    await connections.connect(user, "trading212", request);

    const list = await connections.list(user);
    expect(list.map((c) => [c.id, c.status, c.available])).toEqual([
      ["trading212:isa", "live", true],
      ["trading212:invest", "not_connected", true],
      ["kraken", "not_connected", false],
    ]);
    expect(list[0]).toMatchObject({ feeds: ["Base"], holdingsSeen: 4, permissionsVerified: false });
  });

  it("disconnecting removes the key, what it held, and that pot's history", async () => {
    const { connections } = service();
    await connections.connect(user, "trading212", request);
    await db.insert(dailyValues).values({
      userId: user.userId,
      bucket: "Base",
      day: "2026-09-15",
      valuePence: 1,
      costPence: 1,
      source: "snapshot",
    });

    await connections.disconnect(user, "trading212", "isa");

    expect(await db.select().from(providerCredentials)).toEqual([]);
    expect(await db.select().from(holdings)).toEqual([]);
    expect(await db.select().from(cash)).toEqual([]);
    expect(await db.select().from(dailyValues).where(eq(dailyValues.userId, user.userId))).toEqual(
      [],
    );
  });
});
