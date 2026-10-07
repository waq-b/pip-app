import { URGENT_PUSH_DAILY_MAX } from "@finance-app/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { createNotifier, londonDay, type Notifier } from "./notify.js";
import { stubEmailSender, stubPushSender, webPushSender } from "./senders.js";
import { memoryNotificationStore, type NotificationStore } from "./store.js";

/**
 * The rules about sending : the switches decide, one event
 * is one push however many times a job runs, urgent has a daily budget, and a
 * subscription the push service has forgotten is forgotten here too.
 */

const WAQAR = { userId: "user-1", authUserId: "11111111-1111-4111-8111-111111111111" };
const MONDAY = new Date("2026-09-14T07:05:00Z");

const message = { title: "Side Bet has reached its limit", body: "£350 of £350.", url: "/rules" };

let store: NotificationStore;
let push: ReturnType<typeof stubPushSender>;
let email: ReturnType<typeof stubEmailSender>;
let notifier: Notifier;

async function withDevice(label = "iPhone", endpoint = "https://web.push.apple.com/one") {
  await store.addDevice(WAQAR, { endpoint, p256dh: "key", auth: "secret", label }, MONDAY);
}

beforeEach(async () => {
  store = memoryNotificationStore();
  push = stubPushSender();
  email = stubEmailSender();
  notifier = createNotifier({ store, push, email });
});

describe("a push", () => {
  it("goes to every device the user has", async () => {
    await withDevice("iPhone", "https://web.push.apple.com/one");
    await withDevice("Android tablet", "https://fcm.googleapis.com/two");

    const outcome = await notifier.push(
      { userId: WAQAR.userId, kind: "limit", dedupeKey: "limit:100:2026-09-01", message },
      MONDAY,
    );

    expect(outcome).toEqual({ sent: true, devices: 2, delivered: 2 });
    expect(push.sent.map((sent) => sent.endpoint)).toEqual([
      "https://web.push.apple.com/one",
      "https://fcm.googleapis.com/two",
    ]);
    expect(push.sent[0]).toMatchObject(message);
  });

  it("is sent once per event, however many times the job runs", async () => {
    await withDevice();
    const send = () =>
      notifier.push(
        { userId: WAQAR.userId, kind: "limit", dedupeKey: "limit:80:2026-09-01", message },
        MONDAY,
      );

    expect(await send()).toMatchObject({ sent: true });
    expect(await send()).toEqual({ sent: false, why: "already_sent" });
    expect(push.sent).toHaveLength(1);

    // The next threshold is a different event.
    await notifier.push(
      { userId: WAQAR.userId, kind: "limit", dedupeKey: "limit:100:2026-09-01", message },
      MONDAY,
    );
    expect(push.sent).toHaveLength(2);
  });

  it("obeys the master switch and the switch for its own kind", async () => {
    await withDevice();
    const send = (kind: "limit" | "digest", key: string) =>
      notifier.push({ userId: WAQAR.userId, kind, dedupeKey: key, message }, MONDAY);

    await store.saveSettings(
      WAQAR,
      { push: true, pushLimit: false, pushUrgent: true, pushDigest: true, email: true },
      { now: MONDAY },
    );
    expect(await send("limit", "limit:80:a")).toEqual({ sent: false, why: "switched_off" });
    expect(await send("digest", "digest:2026-09-14")).toMatchObject({ sent: true });

    await store.saveSettings(
      WAQAR,
      { push: false, pushLimit: true, pushUrgent: true, pushDigest: true, email: true },
      { now: MONDAY },
    );
    expect(await send("limit", "limit:80:b")).toEqual({ sent: false, why: "switched_off" });
    expect(push.sent).toHaveLength(1);
  });

  it("stops at two urgent pushes a day, and starts again tomorrow", async () => {
    await withDevice();
    const urgent = (n: number, at: Date) =>
      notifier.push(
        { userId: WAQAR.userId, kind: "urgent", dedupeKey: `urgent:${n}`, message },
        at,
      );

    for (let n = 0; n < URGENT_PUSH_DAILY_MAX; n++) {
      expect(await urgent(n, MONDAY)).toMatchObject({ sent: true });
    }
    expect(await urgent(99, MONDAY)).toEqual({ sent: false, why: "over_budget" });

    // A limit alert isn't counted against the urgent budget.
    expect(
      await notifier.push(
        { userId: WAQAR.userId, kind: "limit", dedupeKey: "limit:100:x", message },
        MONDAY,
      ),
    ).toMatchObject({ sent: true });

    const tuesday = new Date("2026-09-15T07:05:00Z");
    expect(await urgent(100, tuesday)).toMatchObject({ sent: true });
  });

  it("forgets a device the push service says is gone, and keeps the rest", async () => {
    await withDevice("iPhone", "https://web.push.apple.com/gone");
    await withDevice("Mac", "https://web.push.apple.com/here");
    push.gone.add("https://web.push.apple.com/gone");

    const outcome = await notifier.push(
      { userId: WAQAR.userId, kind: "digest", dedupeKey: "digest:2026-09-14", message },
      MONDAY,
    );

    expect(outcome).toEqual({ sent: true, devices: 2, delivered: 1 });
    expect((await store.devices(WAQAR)).map((device) => device.label)).toEqual(["Mac"]);
  });

  it("waits for a device rather than using up the event", async () => {
    const send = () =>
      notifier.push(
        { userId: WAQAR.userId, kind: "digest", dedupeKey: "digest:2026-09-14", message },
        MONDAY,
      );

    expect(await send()).toEqual({ sent: false, why: "no_devices" });
    await withDevice();
    expect(await send()).toMatchObject({ sent: true, delivered: 1 });
  });

  it("records when each device last took one", async () => {
    await withDevice();
    await notifier.push(
      { userId: WAQAR.userId, kind: "limit", dedupeKey: "limit:80:2026-09-01", message },
      MONDAY,
    );
    const [device] = await store.devices(WAQAR);
    expect(device!.lastDeliveredAt).toEqual(MONDAY);
    expect(device!.lastFailedAt).toBeNull();
  });
});

describe("the weekly email", () => {
  const letter = { to: "test@example.com", subject: "Your week", html: "<p>Hi</p>", text: "Hi" };

  it("goes when the switch is on", async () => {
    expect(await notifier.email(WAQAR.userId, letter)).toEqual({ sent: true });
    expect(email.sent).toEqual([letter]);
  });

  it("doesn't when it's off", async () => {
    await store.saveSettings(
      WAQAR,
      { push: true, pushLimit: true, pushUrgent: true, pushDigest: true, email: false },
      { now: MONDAY },
    );
    expect(await notifier.email(WAQAR.userId, letter)).toEqual({
      sent: false,
      why: "switched_off",
    });
    expect(email.sent).toHaveLength(0);
  });

  it("says so, without throwing, when the sender fails", async () => {
    const failing = createNotifier({
      store,
      push,
      email: {
        async send() {
          return { ok: false, detail: "resend 500" };
        },
      },
    });
    expect(await failing.email(WAQAR.userId, letter)).toEqual({
      sent: false,
      why: "failed",
    });
  });
});

describe("web push", () => {
  const target = {
    id: "device-1",
    endpoint: "https://web.push.apple.com/x",
    p256dh: "k",
    auth: "a",
  };

  it("sends the payload with the VAPID pair, and says when it worked", async () => {
    const calls: unknown[] = [];
    const sender = webPushSender(
      { publicKey: "pub", privateKey: "priv", subject: "mailto:test@example.com" },
      {
        async sendNotification(subscription, payload, options) {
          calls.push({ subscription, payload, options });
        },
      },
    );

    expect(await sender.send(target, message)).toEqual({ ok: true });
    expect(calls[0]).toMatchObject({
      subscription: { endpoint: target.endpoint, keys: { p256dh: "k", auth: "a" } },
      payload: JSON.stringify(message),
      options: { vapidDetails: { subject: "mailto:test@example.com", publicKey: "pub" } },
    });
  });

  it.each([
    [404, true],
    [410, true],
    [500, false],
  ])("reads a %s as gone=%s", async (statusCode, gone) => {
    const sender = webPushSender(
      { publicKey: "pub", privateKey: "priv", subject: "mailto:x@example.test" },
      {
        async sendNotification() {
          throw Object.assign(new Error("push service"), { statusCode });
        },
      },
    );
    expect(await sender.send(target, message)).toEqual({
      ok: false,
      gone,
      detail: String(statusCode),
    });
  });
});

describe("the London day", () => {
  it("is the day the budgets count in, through the clock change", async () => {
    expect(londonDay(new Date("2026-06-01T23:30:00Z"))).toBe("2026-06-02");
    expect(londonDay(new Date("2026-01-01T23:30:00Z"))).toBe("2026-01-01");
  });
});
