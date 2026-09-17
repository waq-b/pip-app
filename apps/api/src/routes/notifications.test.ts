import type { NotificationSettingsView, NotificationsView } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { memoryNotificationStore } from "../notify/store.js";
import { testAuth } from "../test-support/auth.js";

/**
 * The bell's routes (Phase 6 decision 4): switches, this device, and what Pip
 * has told you. Behind the guard like everything else, and one person never
 * sees another's.
 */

const NOW = new Date("2026-09-17T09:00:00Z");

function setup() {
  const auth = testAuth(["test@example.com", "friend@example.test"]);
  const store = memoryNotificationStore();
  const app = buildApp({ ...auth.options, notifications: store, now: () => NOW });
  const waqar = auth.headersFor("test@example.com");
  const call = (
    method: "GET" | "PUT" | "POST" | "DELETE",
    url: string,
    payload?: unknown,
    headers: Record<string, string> = waqar,
  ) =>
    app.inject({
      method,
      url,
      headers,
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  return { auth, store, call, friend: auth.headersFor("friend@example.test") };
}

const subscription = {
  endpoint: "https://web.push.apple.com/one",
  keys: { p256dh: "a-public-key", auth: "a-secret" },
  label: "iPhone",
};

describe("the notification routes", () => {
  it.each([
    ["GET", "/notification-settings"],
    ["PUT", "/notification-settings"],
    ["POST", "/push/subscriptions"],
    ["DELETE", "/push/subscriptions"],
    ["GET", "/push/subscriptions/this-device"],
    ["GET", "/notifications"],
    ["POST", "/notifications/read"],
  ] as const)("%s %s needs a session", async (method, url) => {
    const { call } = setup();
    expect((await call(method, url, {}, {})).statusCode).toBe(401);
  });
});

describe("the switches", () => {
  it("start all on, with the sheet unanswered", async () => {
    const { call } = setup();
    const view = (await call("GET", "/notification-settings")).json<NotificationSettingsView>();
    expect(view).toEqual({
      settings: { push: true, pushLimit: true, pushUrgent: true, pushDigest: true, email: true },
      devices: [],
      asked: false,
    });
  });

  it("change one at a time, leaving the rest alone", async () => {
    const { call } = setup();
    const response = await call("PUT", "/notification-settings", { pushUrgent: false });
    expect(response.statusCode).toBe(200);
    expect(response.json<NotificationSettingsView>().settings).toEqual({
      push: true,
      pushLimit: true,
      pushUrgent: false,
      pushDigest: true,
      email: true,
    });
  });

  it("remember that the first-login sheet was answered, once", async () => {
    const { call } = setup();
    await call("PUT", "/notification-settings", { push: false, email: false, answered: true });
    expect(
      (await call("GET", "/notification-settings")).json<NotificationSettingsView>(),
    ).toMatchObject({ asked: true, settings: { push: false, email: false } });

    await call("PUT", "/notification-settings", { push: true });
    expect(
      (await call("GET", "/notification-settings")).json<NotificationSettingsView>().asked,
    ).toBe(true);
  });

  it("refuse anything that isn't a switch", async () => {
    const { call } = setup();
    for (const body of [{ push: "yes" }, { email: 1 }, { answered: "later" }, [true]]) {
      const response = await call("PUT", "/notification-settings", body);
      expect(response.statusCode).toBe(400);
      expect(response.json()).toEqual({ error: "invalid_body" });
    }
  });
});

describe("a device", () => {
  it("is remembered by its subscription, and listed by name only", async () => {
    const { call } = setup();
    const response = await call("POST", "/push/subscriptions", subscription);

    expect(response.statusCode).toBe(200);
    const view = response.json<NotificationSettingsView>();
    expect(view.devices).toHaveLength(1);
    expect(view.devices[0]).toMatchObject({ label: "iPhone" });
    expect(JSON.stringify(view)).not.toContain("a-secret");
    expect(JSON.stringify(view)).not.toContain("web.push.apple.com");
  });

  it("is updated, not duplicated, when the browser subscribes again", async () => {
    const { call } = setup();
    await call("POST", "/push/subscriptions", subscription);
    const view = (
      await call("POST", "/push/subscriptions", {
        ...subscription,
        keys: { p256dh: "new-key", auth: "new-secret" },
      })
    ).json<NotificationSettingsView>();
    expect(view.devices).toHaveLength(1);
  });

  it("can be asked about by endpoint, and turned off again", async () => {
    const { call } = setup();
    await call("POST", "/push/subscriptions", subscription);

    const known = await call(
      "GET",
      `/push/subscriptions/this-device?endpoint=${encodeURIComponent(subscription.endpoint)}`,
    );
    expect(known.json()).toMatchObject({ known: true, device: { label: "iPhone" } });

    expect(
      (await call("DELETE", "/push/subscriptions", { endpoint: subscription.endpoint })).statusCode,
    ).toBe(200);
    expect(
      (
        await call(
          "GET",
          `/push/subscriptions/this-device?endpoint=${encodeURIComponent(subscription.endpoint)}`,
        )
      ).json(),
    ).toEqual({ known: false });
  });

  it("belongs to one person: someone else's endpoint is unknown, and can't be removed", async () => {
    const { call, friend } = setup();
    await call("POST", "/push/subscriptions", subscription);

    expect(
      (
        await call(
          "GET",
          `/push/subscriptions/this-device?endpoint=${encodeURIComponent(subscription.endpoint)}`,
          undefined,
          friend,
        )
      ).json(),
    ).toEqual({ known: false });
    expect(
      (await call("DELETE", "/push/subscriptions", { endpoint: subscription.endpoint }, friend))
        .statusCode,
    ).toBe(404);
  });

  it.each([
    ["no endpoint", { keys: subscription.keys }],
    ["an endpoint that isn't https", { ...subscription, endpoint: "http://evil.test" }],
    ["no keys", { endpoint: subscription.endpoint }],
  ])("is refused with %s", async (_name, body) => {
    const { call } = setup();
    const response = await call("POST", "/push/subscriptions", body);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "invalid_subscription" });
  });
});

describe("the bell", () => {
  const seed = (store: ReturnType<typeof memoryNotificationStore>, userId: string) => {
    store.seedNudge(userId, {
      id: "nudge-1",
      title: "ASML fell 16% today",
      body: "That's past your big-move line.",
      bucket: "Medium",
      at: new Date("2026-09-17T08:00:00Z"),
      url: "/week",
    });
    store.seedNudge(userId, {
      id: "nudge-2",
      title: "Your week is ready",
      body: null,
      bucket: null,
      at: new Date("2026-09-14T07:05:00Z"),
      url: "/week",
    });
  };

  it("lists what Pip has said, newest first, with a count of the unread", async () => {
    const { call, store, auth } = setup();
    seed(store, auth.userIdFor("test@example.com"));

    const view = (await call("GET", "/notifications")).json<NotificationsView>();
    expect(view.unread).toBe(2);
    expect(view.items.map((item) => item.title)).toEqual([
      "ASML fell 16% today",
      "Your week is ready",
    ]);
    expect(view.items[0]).toMatchObject({
      kind: "nudge",
      bucket: "Medium",
      url: "/week",
      read: false,
    });
  });

  it("marks rows read, and marking twice is harmless", async () => {
    const { call, store, auth } = setup();
    seed(store, auth.userIdFor("test@example.com"));

    const marked = (
      await call("POST", "/notifications/read", { items: [{ kind: "nudge", id: "nudge-1" }] })
    ).json<NotificationsView>();
    expect(marked.unread).toBe(1);
    expect(marked.items.find((item) => item.id === "nudge-1")!.read).toBe(true);

    const again = (
      await call("POST", "/notifications/read", { items: [{ kind: "nudge", id: "nudge-1" }] })
    ).json<NotificationsView>();
    expect(again.unread).toBe(1);
  });

  it("shows nobody else's", async () => {
    const { call, store, auth, friend } = setup();
    seed(store, auth.userIdFor("test@example.com"));
    expect(
      (await call("GET", "/notifications", undefined, friend)).json<NotificationsView>(),
    ).toEqual({ items: [], unread: 0 });
  });

  it("refuses a kind of row the bell doesn't have", async () => {
    const { call } = setup();
    const response = await call("POST", "/notifications/read", {
      items: [{ kind: "milestone", id: "x" }],
    });
    expect(response.statusCode).toBe(400);
  });
});
