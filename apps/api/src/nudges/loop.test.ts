import {
  DEFAULT_TRUST_SETTINGS,
  type TrustRulesView,
  type WeekResponse,
} from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { stubSeriesAnchors } from "../market/stub/anchors.js";
import { createStubMarketData } from "../market/stub/index.js";
import { stubReadModel } from "../read/stub.js";
import { memoryRulesStore } from "../rules/store.js";
import { fixedSideBetLimits } from "../rules/side-bet.js";
import { memoryTrustSettingsStore } from "../rules/trust-settings.js";
import { stubWriter } from "../research/writer.js";
import { testAuth } from "../test-support/auth.js";
import { stubFactsReader } from "./gather.js";
import { memoryProfileStore } from "./profile.js";
import { createNudgeService } from "./service.js";
import { memoryNudgeStore } from "./store.js";

/**
 * The loop, end to end through the real
 * routes in stub mode — no network, no database:
 *
 *   planted fact → passes the trust rules → a nudge in the log and in Your week
 *   → one trust rule changed through the API → gone from Your week, kept in the log
 *
 * plus the broken-cap nudge the sample data always has. The screen side of the
 * same loop is `apps/web/src/screens/loop.test.tsx`.
 */

const MONDAY_MORNING = new Date("2026-09-14T08:00:00Z");

function stubApp() {
  const auth = testAuth(["test@example.com"]);
  auth.allowlistStore.rows.get("test@example.com")!.personalResearch = true;
  const rulesStore = memoryRulesStore();
  const sideBetLimits = fixedSideBetLimits({ moneyInPence: 40_000 });
  const trustSettingsStore = memoryTrustSettingsStore();
  const profileStore = memoryProfileStore();
  const log = memoryNudgeStore();
  const readModel = stubReadModel(
    createStubMarketData({
      anchors: stubSeriesAnchors(),
      now: () => new Date("2026-09-17T12:00:00Z"),
    }),
    rulesStore,
    sideBetLimits,
  );
  const nudges = createNudgeService(
    {
      readModel,
      rulesStore,
      sideBetLimits,
      trustStore: trustSettingsStore,
      profileStore,
      facts: stubFactsReader(),
      store: log,
      writer: stubWriter(),
    },
    { buildOnRead: true, now: () => MONDAY_MORNING },
  );
  const app = buildApp({
    ...auth.options,
    readModel,
    rulesStore,
    trustSettingsStore,
    profileStore,
    nudges,
  });
  const headers = auth.headersFor("test@example.com");
  const getWeek = async () =>
    (await app.inject({ method: "GET", url: "/week", headers })).json() as WeekResponse;
  return { app, headers, log, getWeek };
}

describe("the loop", () => {
  it("plants a fact, shows it, changes one rule, and it's gone", async () => {
    const { app, headers, log, getWeek } = stubApp();

    // 1. The planted ASML story passes the default trust rules and is in Your week.
    const before = (await getWeek()).week!;
    const asml = before.nudges.find((n) => n.reason === "news" && n.instrumentId === "asml");
    expect(asml).toMatchObject({
      title: "ASML in the news",
      basis: "Based on 2 sources over 1 day",
    });
    expect(asml!.sources.map((s) => s.publisher)).toEqual(["Financial Times", "Reuters"]);
    expect(asml!.checks.map((c) => [c.rule, c.passed])).toEqual(
      expect.arrayContaining([["Enough different publishers", true]]),
    );

    // 2. It's in the log, with the facts it was built from and how it was written.
    const logged = log.all().find((n) => n.id === asml!.id)!;
    expect(logged).toMatchObject({
      shown: true,
      model: "stub",
      promptVersion: "wording.v1",
      personalised: true,
    });
    expect((logged.facts as { reports: unknown[] }).reports).toHaveLength(2);

    // The sample's broken cap is there too.
    expect(before.nudges.map((n) => n.title)).toContain("Side Bet has reached its starter limit");

    // 3. One trust rule changed, through the API.
    const saved = await app.inject({
      method: "PUT",
      url: "/trust-rules",
      headers,
      payload: { ...structuredClone(DEFAULT_TRUST_SETTINGS), minSources: 3 },
    });
    expect((saved.json() as TrustRulesView).settings.minSources).toBe(3);

    // 4. Gone from Your week, straight away, and the reason is one tap away.
    const after = (await getWeek()).week!;
    expect(after.nudges.map((n) => n.id)).not.toContain(asml!.id);
    expect(after.heldBack.find((n) => n.id === asml!.id)?.heldBackBecause).toBe(
      "Not enough different publishers — 2 publishers: Financial Times, Reuters",
    );
    expect(after.nudges.map((n) => n.title)).toContain("Side Bet has reached its starter limit");

    // 5. The log still has it exactly as it was built — nothing is rewritten.
    expect(log.all().find((n) => n.id === asml!.id)).toMatchObject({ shown: true });

    // And putting the rule back brings it back.
    await app.inject({
      method: "PUT",
      url: "/trust-rules",
      headers,
      payload: structuredClone(DEFAULT_TRUST_SETTINGS),
    });
    expect((await getWeek()).week!.nudges.map((n) => n.id)).toContain(asml!.id);
  });

  it("does the same through an exclusion saved on Your plan", async () => {
    const { app, headers, getWeek } = stubApp();
    expect((await getWeek()).week!.nudges.map((n) => n.title)).toContain("ASML in the news");
    await app.inject({
      method: "PUT",
      url: "/profile",
      headers,
      payload: {
        goals: "",
        horizonYears: null,
        monthlyInPence: null,
        riskWords: "",
        exclusions: ["ASML"],
      },
    });
    const after = (await getWeek()).week!;
    expect(after.nudges.map((n) => n.title)).not.toContain("ASML in the news");
    expect(after.heldBack.map((n) => n.heldBackBecause)).toContain(
      "On your exclusions list — ASML",
    );
  });
});
