import { DEFAULT_NOTIFICATION_SETTINGS } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { stubSeriesAnchors } from "../market/stub/anchors.js";
import { createStubMarketData } from "../market/stub/index.js";
import { createNotifier } from "../notify/notify.js";
import { stubEmailSender, stubPushSender } from "../notify/senders.js";
import { memoryNotificationStore } from "../notify/store.js";
import { stubReadModel } from "../read/stub.js";
import { fixedSideBetLimits } from "../rules/side-bet.js";
import { memoryRulesStore } from "../rules/store.js";
import { memoryTrustSettingsStore } from "../rules/trust-settings.js";
import { stubWriter } from "../research/writer.js";
import { stubFactsReader } from "./gather.js";
import { memoryProfileStore } from "./profile.js";
import { createNudgeService, type NudgeUser } from "./service.js";
import { memoryNudgeStore } from "./store.js";
import { memoryTriggerStateStore } from "./triggers.js";

/**
 * Monday's email and "Your week is ready" push (phase-6.md decision 6): sent
 * by the run that builds the week, once, through `notify()`'s switches — and
 * the words match the week in Pip.
 */

const SAMPLE_MARKET_AT = new Date("2026-09-17T12:00:00Z");
/** The sample market is pinned to Thu 17 Sep; this Monday is the one its notes were written for. */
const MONDAY = new Date("2026-09-14T08:00:00Z");
const waqar: NudgeUser = {
  userId: "user-1",
  authUserId: "auth-1",
  personalResearch: true,
  email: "waqar@example.test",
};
const friend: NudgeUser = {
  userId: "user-2",
  authUserId: "auth-2",
  personalResearch: false,
  email: "friend@example.test",
};

async function world(options: { limitPence?: number } = {}) {
  const rulesStore = memoryRulesStore();
  const notifications = memoryNotificationStore();
  const push = stubPushSender();
  const email = stubEmailSender();
  const notifier = createNotifier({ store: notifications, push, email });
  for (const user of [waqar, friend]) {
    await notifications.addDevice(
      user,
      {
        endpoint: `https://web.push.apple.com/${user.userId}`,
        p256dh: "k",
        auth: "a",
        label: "iPhone",
      },
      MONDAY,
    );
  }
  const service = createNudgeService({
    readModel: stubReadModel(
      createStubMarketData({ anchors: stubSeriesAnchors(), now: () => SAMPLE_MARKET_AT }),
      rulesStore,
    ),
    rulesStore,
    sideBetLimits: fixedSideBetLimits({
      moneyInPence: 40_000,
      limitPence: options.limitPence ?? 640_000,
      starterLimit: false,
    }),
    trustStore: memoryTrustSettingsStore(),
    profileStore: memoryProfileStore(),
    facts: stubFactsReader(),
    store: memoryNudgeStore(),
    writer: stubWriter(),
    notifier,
    triggers: memoryTriggerStateStore(),
  });
  return { service, push, email, notifications };
}

describe("Monday's email and push", () => {
  it("go out once, from the run that builds the week", async () => {
    const { service, push, email } = await world();
    expect(await service.buildWeekIfDue(waqar, MONDAY)).toBe("built");
    expect(await service.buildWeekIfDue(waqar, new Date("2026-09-14T08:30:00Z"))).toBe("exists");

    expect(email.sent).toHaveLength(1);
    expect(email.sent[0]).toMatchObject({
      to: "waqar@example.test",
      subject: "Your week: 2 things worth a look",
    });
    expect(push.sent).toEqual([
      expect.objectContaining({
        title: "Your week is ready",
        body: "2 things worth a look.",
        url: "/week",
      }),
    ]);
  });

  it("say what the week in Pip says", async () => {
    const { service, email } = await world();
    await service.buildWeekIfDue(waqar, MONDAY);
    const week = (await service.week(waqar, "latest", MONDAY))!;
    const { html, text } = email.sent[0]!;
    for (const nudge of week.nudges) {
      expect(text).toContain(nudge.title.toUpperCase());
      expect(html).toContain(nudge.title.replace(/'/g, "&#39;"));
    }
    // Held-back notes stay in Pip.
    for (const nudge of week.heldBack) expect(text).not.toContain(nudge.title.toUpperCase());
    expect(text).toContain("https://pip.example.com/week");
    expect(text).toContain("INFORMATION, NOT ADVICE");
  });

  it("never carries Side Bet's limit in pounds, or anything that works it out", async () => {
    // Side Bet's £780 against a £500 limit, with R1 in the week: £500 and the
    // £280 above it would both give net assets away.
    const { service, email } = await world({ limitPence: 50_000 });
    await service.buildDaily(waqar, new Date("2026-09-11T09:00:00Z"));
    await service.buildDaily(waqar, new Date("2026-09-11T09:30:00Z"));
    await service.buildWeekIfDue(waqar, MONDAY);
    const { html, text } = email.sent[0]!;
    for (const figure of ["£500", "£280"]) {
      expect(text).not.toContain(figure);
      expect(html).not.toContain(figure);
    }
  });

  it("respects the switches: email off sends no email, the digest push off sends no push", async () => {
    const { service, push, email, notifications } = await world();
    await notifications.saveSettings(
      waqar,
      { ...DEFAULT_NOTIFICATION_SETTINGS, email: false, pushDigest: false },
      { answered: true, now: MONDAY },
    );
    await service.buildWeekIfDue(waqar, MONDAY);
    expect(email.sent).toEqual([]);
    expect(push.sent).toEqual([]);
  });

  it("carries Waqar's latest recommendation, laid out part by part", async () => {
    // Side Bet's £780 against a £500 limit: R1 fires on the second check.
    const { service, email } = await world({ limitPence: 50_000 });
    await service.buildDaily(waqar, new Date("2026-09-11T09:00:00Z"));
    await service.buildDaily(waqar, new Date("2026-09-11T09:30:00Z"));
    await service.buildWeekIfDue(waqar, MONDAY);

    const { text, subject } = email.sent[0]!;
    expect(subject).toBe("Your week: 3 things worth a look");
    expect(text).toContain("PIP'S TAKE ON SIDE BET");
    expect(text).toContain("Take some profit — the part above the limit.");
    expect(text.replace(/\s+/g, " ")).toContain("A disciplined investor usually takes some profit");
    expect(text).toContain("YOUR CALL.");
  });

  it("never carries a recommendation for anyone else", async () => {
    const { service, email } = await world({ limitPence: 50_000 });
    for (const at of ["2026-09-11T09:00:00Z", "2026-09-11T09:30:00Z"]) {
      await service.buildDaily(friend, new Date(at));
    }
    await service.buildWeekIfDue(friend, MONDAY);
    expect(email.sent[0]!.to).toBe("friend@example.test");
    expect(email.sent[0]!.text).not.toMatch(/Pip's take|Your call/i);
  });

  it("builds the week without emailing when there's no address", async () => {
    const { service, email, push } = await world();
    await service.buildWeekIfDue({ ...waqar, email: undefined }, MONDAY);
    expect(email.sent).toEqual([]);
    expect(push.sent).toHaveLength(1);
  });

  it("looks the same every time (snapshot)", async () => {
    const { service, email } = await world({ limitPence: 50_000 });
    await service.buildDaily(waqar, new Date("2026-09-11T09:00:00Z"));
    await service.buildDaily(waqar, new Date("2026-09-11T09:30:00Z"));
    await service.buildWeekIfDue(waqar, MONDAY);
    expect(email.sent[0]!.subject).toMatchSnapshot("subject");
    expect(email.sent[0]!.text).toMatchSnapshot("text");
    expect(email.sent[0]!.html).toMatchSnapshot("html");
  });
});
