import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { pushSubscriptions, users } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { testDatabase } from "../test-support/pglite.js";
import { createNotifier } from "./notify.js";
import { stubEmailSender, type PushSender } from "./senders.js";
import { dbNotificationStore } from "./store.js";

/**
 * The notification store against real Postgres (PGlite, the real migrations).
 * The in-memory store hid a bad query: marking one device delivered crashed
 * after a real push had already gone out (found with the first real test push,
 * 2026-09-18).
 */

const AUTH = "77777777-7777-4777-8777-777777777777";
const NOW = new Date("2026-09-18T22:00:00Z");
let db: Db;
let close: () => Promise<void>;
let user: { userId: string; authUserId: string };

beforeAll(async () => {
  const test = await testDatabase();
  db = test.db;
  close = () => test.client.close();
});
afterAll(async () => close());

beforeEach(async () => {
  await db.delete(pushSubscriptions);
  await db.delete(users);
  const [row] = await db
    .insert(users)
    .values({ email: "test@example.com", authUserId: AUTH })
    .returning({ id: users.id });
  user = { userId: row!.id, authUserId: AUTH };
});

const device = (n: number) => ({
  endpoint: `https://web.push.apple.com/device-${n}`,
  p256dh: "k",
  auth: "a",
  label: "iPhone",
});

const sender = (status: (endpoint: string) => "ok" | "gone" | "failed"): PushSender => ({
  async send(target) {
    const result = status(target.endpoint);
    return result === "ok" ? { ok: true } : { ok: false, gone: result === "gone", detail: result };
  },
});

async function pushWith(push: PushSender) {
  const store = dbNotificationStore(db);
  const notifier = createNotifier({ store, push, email: stubEmailSender() });
  return notifier.push(
    {
      userId: user.userId,
      kind: "digest",
      dedupeKey: "test",
      message: { title: "t", body: "b", url: "/" },
    },
    NOW,
  );
}

const rows = () =>
  db.select().from(pushSubscriptions).where(eq(pushSubscriptions.userId, user.userId));

describe("delivery bookkeeping, on Postgres", () => {
  it("marks one device delivered", async () => {
    await dbNotificationStore(db).addDevice(user, device(1), NOW);
    expect(await pushWith(sender(() => "ok"))).toMatchObject({ sent: true, delivered: 1 });
    expect((await rows())[0]!.lastDeliveredAt).toEqual(NOW);
  });

  it("marks several, and a failure on its own", async () => {
    const store = dbNotificationStore(db);
    for (const n of [1, 2, 3]) await store.addDevice(user, device(n), NOW);
    await pushWith(sender((endpoint) => (endpoint.endsWith("3") ? "failed" : "ok")));
    const byEnd = Object.fromEntries((await rows()).map((r) => [r.endpoint.slice(-1), r]));
    expect(byEnd["1"]!.lastDeliveredAt).toEqual(NOW);
    expect(byEnd["2"]!.lastDeliveredAt).toEqual(NOW);
    expect(byEnd["3"]!.lastFailedAt).toEqual(NOW);
    expect(byEnd["3"]!.lastDeliveredAt).toBeNull();
  });

  it("forgets a device the push service says is gone", async () => {
    const store = dbNotificationStore(db);
    for (const n of [1, 2]) await store.addDevice(user, device(n), NOW);
    await pushWith(sender((endpoint) => (endpoint.endsWith("2") ? "gone" : "ok")));
    expect((await rows()).map((r) => r.endpoint)).toEqual([device(1).endpoint]);
  });
});
