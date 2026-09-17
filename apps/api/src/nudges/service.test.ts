import { DEFAULT_TRUST_SETTINGS, EMPTY_PROFILE } from "@finance-app/shared";
import { describe, expect, it, vi } from "vitest";
import { stubSeriesAnchors } from "../market/stub/anchors.js";
import { createStubMarketData } from "../market/stub/index.js";
import { stubReadModel } from "../read/stub.js";
import { memoryRulesStore } from "../rules/store.js";
import { memoryTrustSettingsStore } from "../rules/trust-settings.js";
import { stubWriter, type NudgeWriter } from "../research/writer.js";
import { moveSince, stubFactsReader } from "./gather.js";
import { memoryProfileStore } from "./profile.js";
import { createNudgeService, mondayOf, type NudgeUser } from "./service.js";
import { memoryNudgeStore } from "./store.js";

/** Monday 14 September 2026, 08:00 UTC — the week's build is due. */
const MONDAY = new Date("2026-09-14T08:00:00Z");
const waqar: NudgeUser = { userId: "user-1", authUserId: "auth-1", personalResearch: true };
const friend: NudgeUser = { userId: "user-2", authUserId: "auth-2", personalResearch: false };

function setup(writer: NudgeWriter = stubWriter()) {
  const rulesStore = memoryRulesStore();
  const trustStore = memoryTrustSettingsStore();
  const profileStore = memoryProfileStore();
  const store = memoryNudgeStore();
  const service = createNudgeService({
    readModel: stubReadModel(createStubMarketData({ anchors: stubSeriesAnchors() }), rulesStore),
    rulesStore,
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
      "Side Bet is £209 over its cap",
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
    const { service, rulesStore, profileStore } = setup(writer);
    await rulesStore.set(waqar, { handpickedTarget: 21, sideBetCap: 10 }, MONDAY);
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
      "Side Bet is £209 over its cap",
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
    expect(titles(response.today)).toEqual(["Side Bet is £209 over its cap"]);
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
