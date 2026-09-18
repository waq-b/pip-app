import { DEFAULT_TRUST_SETTINGS, EMPTY_PROFILE } from "@finance-app/shared";
import { describe, expect, it, vi } from "vitest";
import { stubSeriesAnchors } from "../market/stub/anchors.js";
import { createStubMarketData } from "../market/stub/index.js";
import { stubReadModel } from "../read/stub.js";
import { memoryRulesStore } from "../rules/store.js";
import { fixedSideBetLimits } from "../rules/side-bet.js";
import { memoryTrustSettingsStore } from "../rules/trust-settings.js";
import { stubWriter, type NudgeWriter } from "../research/writer.js";
import { moveSince, stubFactsReader } from "./gather.js";
import { memoryProfileStore } from "./profile.js";
import { createNudgeService, mondayOf, pushUrgent, type NudgeUser } from "./service.js";
import { memoryNudgeStore, type NewNudge } from "./store.js";
import { createNotifier } from "../notify/notify.js";
import { stubEmailSender, stubPushSender } from "../notify/senders.js";
import { memoryNotificationStore } from "../notify/store.js";

/** Monday 14 September 2026, 08:00 UTC — the week's build is due. */
const MONDAY = new Date("2026-09-14T08:00:00Z");
/**
 * The sample market's own clock. It used to be the real one, so these
 * expectations quietly drifted with the date; they were written against the
 * sample as it stood on this day, so that's where it's pinned.
 */
const SAMPLE_MARKET_AT = new Date("2026-09-17T12:00:00Z");
const waqar: NudgeUser = { userId: "user-1", authUserId: "auth-1", personalResearch: true };
const friend: NudgeUser = { userId: "user-2", authUserId: "auth-2", personalResearch: false };

function setup(writer: NudgeWriter = stubWriter(), moneyInPence = 40_000) {
  const rulesStore = memoryRulesStore();
  const trustStore = memoryTrustSettingsStore();
  const profileStore = memoryProfileStore();
  const store = memoryNudgeStore();
  const service = createNudgeService({
    readModel: stubReadModel(
      createStubMarketData({ anchors: stubSeriesAnchors(), now: () => SAMPLE_MARKET_AT }),
      rulesStore,
    ),
    rulesStore,
    sideBetLimits: fixedSideBetLimits({ moneyInPence }),
    trustStore,
    profileStore,
    facts: stubFactsReader(),
    store,
    writer,
  });
  return { service, store, rulesStore, trustStore, profileStore };
}

const titles = (nudges: { title: string }[]) => nudges.map((n) => n.title);

describe("building a week", () => {
  it("isn't due before 07:00 UTC on the Monday, and is built once", async () => {
    const { service } = setup();
    expect(await service.buildWeekIfDue(waqar, new Date("2026-09-14T06:59:00Z"))).toBe("not_due");
    expect(await service.buildWeekIfDue(waqar, MONDAY)).toBe("built");
    expect(await service.buildWeekIfDue(waqar, new Date("2026-09-16T12:00:00Z"))).toBe("exists");
  });

  it("builds a week missed on Monday later that week", async () => {
    const { service } = setup();
    const wednesday = new Date("2026-09-16T12:00:00Z");
    expect(await service.buildWeekIfDue(waqar, wednesday)).toBe("built");
    expect((await service.week(waqar, "latest", wednesday))!.weekOf).toBe("2026-09-14");
  });

  it("shows the sample's broken cap and the planted ASML story; holds back what the rules don't pass", async () => {
    const { service, store } = setup();
    await service.buildWeekIfDue(waqar, MONDAY);
    const week = (await service.week(waqar, "latest", MONDAY))!;
    expect(week.weekOf).toBe("2026-09-14");
    expect(titles(week.nudges)).toEqual([
      "Side Bet has reached its starter limit",
      "Apple is up £50 this week",
      "ASML in the news",
    ]);
    const asml = week.nudges[2]!;
    expect(asml).toMatchObject({
      kind: "awareness",
      reason: "news",
      basis: "Based on 2 sources over 1 day",
    });
    expect(asml.sources.map((s) => s.publisher)).toEqual(
      ["stockchatter.example", "Financial Times", "Reuters"].slice(1),
    );
    expect(asml.checks.every((c) => c.passed)).toBe(true);
    expect(week.heldBack.map((n) => [n.title, n.heldBackBecause?.split(" — ")[0]])).toEqual([
      ["Nvidia was in the news", "Not enough different publishers"],
      ["Bitcoin was in the news", "Side Bet is over its cap"],
    ]);
    // Everything is in the log, with its facts and how it was written.
    const logged = store.all();
    expect(logged.map((n) => [n.reason, n.shown, n.model])).toEqual([
      ["cap", true, "template"],
      ["news", false, "template"],
      ["move", true, "template"],
      ["news", true, "stub"],
      ["news", false, "template"],
    ]);
    expect(logged.find((n) => n.shown && n.reason === "news")).toMatchObject({
      promptVersion: "awareness.v2",
      personalised: true,
      priceCurrency: "GBP_PENCE",
    });
    expect(week.opening).toBe("Here's your week, from stub mode.");
  });

  it("gives general words and sends nothing to a writer for someone without personal research", async () => {
    const writer = stubWriter();
    const news = vi.spyOn(writer, "news");
    const opening = vi.spyOn(writer, "opening");
    const { service, store } = setup(writer);
    await service.buildWeekIfDue(friend, MONDAY);
    const week = (await service.week(friend, "latest", MONDAY))!;
    expect(titles(week.nudges)).toContain("ASML was in the news");
    expect(news.mock.calls.every(([input]) => input.plan === null)).toBe(true);
    expect(opening).not.toHaveBeenCalled();
    expect(week.opening).toBe("Here's your week.");
    expect(store.all().every((n) => !n.personalised)).toBe(true);
  });

  it("holds a story back when the writer cites too few publishers", async () => {
    const writer: NudgeWriter = {
      ...stubWriter(),
      async news(input) {
        const reuters = input.reports.filter((r) => r.publisher === "Reuters");
        return {
          title: "ASML story",
          body: "Reuters reports it.",
          citedIds: reuters.map((r) => r.id),
          model: "groq:m",
          promptVersion: "awareness.v2",
        };
      },
    };
    const { service } = setup(writer);
    await service.buildWeekIfDue(waqar, MONDAY);
    const week = (await service.week(waqar, "latest", MONDAY))!;
    expect(titles(week.nudges)).not.toContain("ASML story");
    expect(week.heldBack.find((n) => n.title === "ASML story")?.heldBackBecause).toBe(
      "Not enough different publishers — Cited: 1 publisher: Reuters",
    );
  });

  it("holds a story back when the writer judges it routine, and says nothing needs you if that was all", async () => {
    const writer: NudgeWriter = {
      ...stubWriter(),
      news: async () => ({ material: false, model: "groq:m", promptVersion: "awareness.v2" }),
    };
    // Side Bet well under its limit too, so a quiet week really is quiet.
    const { service, rulesStore, profileStore } = setup(writer, 10_000);
    await rulesStore.set(waqar, { handpickedTarget: 21 }, MONDAY);
    await profileStore.set(waqar, { ...EMPTY_PROFILE, exclusions: ["Apple"] }, MONDAY);
    await service.buildWeekIfDue(waqar, MONDAY);
    const week = (await service.week(waqar, "latest", MONDAY))!;
    expect(week.nudges).toHaveLength(1);
    expect(week.nudges[0]).toMatchObject({ kind: "none", title: "Nothing needs you this week." });
    expect(week.nudges[0]!.body).toMatch(
      /^Pip checked \d+ holdings and read \d+ news reports\. \d+ things didn't get past your trust rules\. Next on the calendar: Nvidia results/,
    );
    expect(week.heldBack.map((n) => n.heldBackBecause)).toContain(
      "Routine news — The writer judged these reports routine",
    );
    expect(week.opening).toBe("Here's your week.");
  });
});

describe("reading a week with today's trust rules", () => {
  it("takes the ASML story off the week the moment three publishers are needed", async () => {
    const { service, trustStore } = setup();
    await service.buildWeekIfDue(waqar, MONDAY);
    await trustStore.set(
      waqar,
      { ...structuredClone(DEFAULT_TRUST_SETTINGS), minSources: 3 },
      MONDAY,
    );
    const week = (await service.week(waqar, "latest", MONDAY))!;
    expect(titles(week.nudges)).toEqual([
      "Side Bet has reached its starter limit",
      "Apple is up £50 this week",
    ]);
    expect(week.heldBack.find((n) => n.title === "ASML in the news")?.heldBackBecause).toBe(
      "Not enough different publishers — 2 publishers: Financial Times, Reuters",
    );
  });

  it("brings it back when the rule goes back — it was never deleted", async () => {
    const { service, trustStore } = setup();
    await service.buildWeekIfDue(waqar, MONDAY);
    await trustStore.set(
      waqar,
      { ...structuredClone(DEFAULT_TRUST_SETTINGS), minSources: 3 },
      MONDAY,
    );
    await trustStore.set(waqar, structuredClone(DEFAULT_TRUST_SETTINGS), MONDAY);
    expect(titles((await service.week(waqar, "latest", MONDAY))!.nudges)).toContain(
      "ASML in the news",
    );
  });

  it("hides anything that mentions something newly excluded", async () => {
    const { service, profileStore } = setup();
    await service.buildWeekIfDue(waqar, MONDAY);
    await profileStore.set(
      waqar,
      { ...EMPTY_PROFILE, exclusions: ["ASML", "Side Bet", "Apple"] },
      MONDAY,
    );
    const week = (await service.week(waqar, "latest", MONDAY))!;
    expect(week.nudges).toHaveLength(1);
    expect(week.nudges[0]).toMatchObject({
      kind: "none",
      body: expect.stringMatching(/Your trust rules have changed since this week was built\.$/),
    });
  });

  it("drops a named publisher and the story goes with it", async () => {
    const { service, trustStore } = setup();
    await service.buildWeekIfDue(waqar, MONDAY);
    const withoutFt = DEFAULT_TRUST_SETTINGS.namedPublishers.filter((p) => p !== "ft.com");
    await trustStore.set(
      waqar,
      { ...structuredClone(DEFAULT_TRUST_SETTINGS), namedPublishers: withoutFt },
      MONDAY,
    );
    expect(titles((await service.week(waqar, "latest", MONDAY))!.nudges)).not.toContain(
      "ASML in the news",
    );
  });
});

describe("daily nudges", () => {
  it("say a broken cap once, and don't repeat it within a week", async () => {
    const { service, store } = setup();
    const tuesday = new Date("2026-09-15T09:00:00Z");
    expect(await service.buildDaily(waqar, tuesday)).toBeGreaterThan(0);
    expect(await service.buildDaily(waqar, new Date("2026-09-15T09:30:00Z"))).toBe(0);
    const response = await service.thisWeek(waqar, tuesday);
    expect(titles(response.today)).toEqual(["Side Bet has reached its starter limit"]);
    await service.buildDaily(waqar, new Date("2026-09-17T09:00:00Z"));
    expect(store.all().filter((n) => n.reason === "cap" && n.shown)).toHaveLength(1);
  });

  it("don't repeat the cap the weekly build already said", async () => {
    const { service, store } = setup();
    await service.buildWeekIfDue(waqar, MONDAY);
    await service.buildDaily(waqar, new Date("2026-09-14T09:00:00Z"));
    expect(store.all().filter((n) => n.cadence === "daily" && n.reason === "cap")).toEqual([]);
  });
});

describe("urgent notes (Phase 6)", () => {
  const urgentRow = (n: number): NewNudge => ({
    cadence: "daily",
    kind: "awareness",
    reason: "move",
    urgent: true,
    bucket: "Medium",
    instrumentId: `I${n}`,
    title: `Holding ${n} fell 16% today`,
    body: "That's past twice your big-move line for Handpicked.",
    basis: null,
    facts: {},
    checks: [],
    shown: true,
    model: "template",
    promptVersion: null,
    personalised: false,
    dedupeKey: `move:I${n}:2026-09-17`,
    builtOn: "2026-09-17",
    priceAt: null,
    priceCurrency: null,
    priceSource: null,
    potShareAt: null,
  });

  function withNotifier() {
    const notifications = memoryNotificationStore();
    const push = stubPushSender();
    const notifier = createNotifier({ store: notifications, push, email: stubEmailSender() });
    const store = memoryNudgeStore();
    return { notifications, push, notifier, store };
  }

  const THURSDAY = new Date("2026-09-17T10:00:00Z");

  it("pushes an urgent note straight away, and opens Your week when tapped", async () => {
    const { notifications, push, notifier, store } = withNotifier();
    await notifications.addDevice(
      waqar,
      { endpoint: "https://web.push.apple.com/w", p256dh: "k", auth: "a", label: "iPhone" },
      THURSDAY,
    );
    await pushUrgent({ store, notifier } as never, waqar, [urgentRow(1)], "2026-09-17", THURSDAY);

    expect(push.sent).toEqual([
      expect.objectContaining({ title: "Holding 1 fell 16% today", url: "/week" }),
    ]);
  });

  it("never pushes one to someone without personal research", async () => {
    const { notifications, push, notifier, store } = withNotifier();
    await notifications.addDevice(
      friend,
      { endpoint: "https://web.push.apple.com/f", p256dh: "k", auth: "a", label: "iPhone" },
      THURSDAY,
    );
    await pushUrgent({ store, notifier } as never, friend, [urgentRow(1)], "2026-09-17", THURSDAY);
    expect(push.sent).toEqual([]);
  });

  it("stops at two a day, and the third says why in its checks", async () => {
    const { notifications, push, notifier, store } = withNotifier();
    await notifications.addDevice(
      waqar,
      { endpoint: "https://web.push.apple.com/w", p256dh: "k", auth: "a", label: "iPhone" },
      THURSDAY,
    );
    const rows = [urgentRow(1), urgentRow(2), urgentRow(3)];
    await store.saveDaily(waqar, rows);
    await pushUrgent({ store, notifier } as never, waqar, rows, "2026-09-17", THURSDAY);

    expect(push.sent).toHaveLength(2);
    const third = store.all().find((n) => n.instrumentId === "I3")!;
    expect(third.checks.at(-1)).toMatchObject({
      rule: "daily_budget",
      passed: false,
      detail: "Not pushed: 2 urgent notes had already gone out today",
    });
  });

  it("sends each once, however many times the daily build sees it", async () => {
    const { notifications, push, notifier, store } = withNotifier();
    await notifications.addDevice(
      waqar,
      { endpoint: "https://web.push.apple.com/w", p256dh: "k", auth: "a", label: "iPhone" },
      THURSDAY,
    );
    for (const at of [THURSDAY, new Date("2026-09-17T10:30:00Z")]) {
      await pushUrgent({ store, notifier } as never, waqar, [urgentRow(1)], "2026-09-17", at);
    }
    expect(push.sent).toHaveLength(1);
  });
});

describe("the log", () => {
  it("records what you did, only on your own nudges", async () => {
    const { service, store } = setup();
    await service.buildWeekIfDue(waqar, MONDAY);
    const [first] = store.all();
    const at = new Date("2026-09-14T10:00:00Z");
    expect(await service.respond(friend, first!.id, "acted", at)).toBeNull();
    expect(await service.respond(waqar, first!.id, "acted", at)).toMatchObject({
      response: "acted",
      respondedAt: at,
    });
    const week = (await service.week(waqar, "latest", MONDAY))!;
    expect(week.nudges[0]!.response).toBe("acted");
  });

  it("lists earlier weeks, newest first", async () => {
    const { service } = setup();
    await service.buildWeekIfDue(waqar, MONDAY);
    const next = new Date("2026-09-21T08:00:00Z");
    await service.buildWeekIfDue(waqar, next);
    const response = await service.thisWeek(waqar, next);
    expect(response.week!.weekOf).toBe("2026-09-21");
    expect(response.pastWeeks).toEqual(["2026-09-14"]);
  });
});

describe("helpers", () => {
  it("finds the Monday", () => {
    expect(mondayOf("2026-09-14")).toBe("2026-09-14");
    expect(mondayOf("2026-09-20")).toBe("2026-09-14");
    expect(mondayOf("2026-09-21")).toBe("2026-09-21");
  });

  it("works out a move in percent and pounds from a price series", () => {
    const series = [
      { at: "2026-09-01T16:00:00Z", value: 1_000 },
      { at: "2026-09-07T16:00:00Z", value: 1_100 },
      { at: "2026-09-13T16:00:00Z", value: 1_150 },
    ];
    expect(moveSince(series, new Date("2026-09-07T20:00:00Z"), 1_210, 12_100)).toEqual({
      percent: 10,
      pence: 1_100,
    });
    expect(moveSince(series, new Date("2026-08-01T00:00:00Z"), 1_210, 12_100)).toBeNull();
  });
});
