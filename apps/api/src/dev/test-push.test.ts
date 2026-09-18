import { describe, expect, it } from "vitest";
import { createNotifier } from "../notify/notify.js";
import { stubEmailSender, stubPushSender } from "../notify/senders.js";
import { memoryNotificationStore } from "../notify/store.js";
import { sendTestPush, TEST_MESSAGE, vapidFrom } from "./test-push.js";

/** The hand-run test push goes through the real notifier, and never needs a network in CI. */
describe("the test push", () => {
  it("reaches every device through the notifier, and can be sent again", async () => {
    const store = memoryNotificationStore();
    const push = stubPushSender();
    const notifier = createNotifier({ store, push, email: stubEmailSender() });
    const user = { userId: "u1", authUserId: "a1" };
    await store.addDevice(
      user,
      { endpoint: "https://web.push.apple.com/x", p256dh: "k", auth: "a", label: "iPhone" },
      new Date(),
    );

    expect(await sendTestPush(notifier, "u1", new Date("2026-09-18T22:00:00Z"))).toMatchObject({
      sent: true,
      devices: 1,
    });
    expect(await sendTestPush(notifier, "u1", new Date("2026-09-18T22:01:00Z"))).toMatchObject({
      sent: true,
    });
    expect(push.sent).toEqual([
      expect.objectContaining(TEST_MESSAGE),
      expect.objectContaining(TEST_MESSAGE),
    ]);
  });

  it("needs the key pair from the environment", () => {
    expect(() => vapidFrom({})).toThrow(/VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY/);
    expect(vapidFrom({ VAPID_PUBLIC_KEY: "p", VAPID_PRIVATE_KEY: "s" }).subject).toBe(
      "https://pip.example.com",
    );
  });
});
