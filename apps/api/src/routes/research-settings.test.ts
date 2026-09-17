import {
  DEFAULT_TRUST_SETTINGS,
  EMPTY_PROFILE,
  type ProfileView,
  type TrustRulesView,
  type TrustSettings,
} from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { buildApp } from "../app.js";
import { testAuth } from "../test-support/auth.js";

function setup() {
  const auth = testAuth(["test@example.com", "friend@example.test"]);
  const app = buildApp({ ...auth.options });
  const waqar = auth.headersFor("test@example.com");
  const call = (
    method: "GET" | "PUT",
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
  return { auth, call, friend: auth.headersFor("friend@example.test") };
}

const plan = {
  goals: "Grow long-term savings, keep a small fun pot",
  horizonYears: 15,
  monthlyInPence: 50_000,
  riskWords: "Happy to ride dips in the index funds",
  exclusions: ["Tobacco", "tobacco", "  ", "Greggs"],
};

describe("the profile", () => {
  it.each([
    ["GET", "/profile"],
    ["PUT", "/profile"],
    ["GET", "/trust-rules"],
    ["PUT", "/trust-rules"],
  ] as const)("%s %s needs a session", async (method, url) => {
    const { call } = setup();
    expect((await call(method, url, method === "PUT" ? {} : undefined, {})).statusCode).toBe(401);
  });

  it("starts empty, and says general notes until Waqar turns personal research on", async () => {
    const { call, auth } = setup();
    expect((await call("GET", "/profile")).json()).toEqual({
      profile: EMPTY_PROFILE,
      personalised: false,
    });
    auth.allowlistStore.rows.get("test@example.com")!.personalResearch = true;
    expect(((await call("GET", "/profile")).json() as ProfileView).personalised).toBe(true);
  });

  it("saves a plan tidied up — trimmed, blank and repeated exclusions dropped", async () => {
    const { call } = setup();
    const saved = (await call("PUT", "/profile", plan)).json() as ProfileView;
    expect(saved.profile).toEqual({ ...plan, exclusions: ["Tobacco", "Greggs"] });
    expect(saved.lastChangedAt).toBeTruthy();
    expect(((await call("GET", "/profile")).json() as ProfileView).profile.goals).toBe(plan.goals);
  });

  it("accepts an unanswered horizon and money in", async () => {
    const { call } = setup();
    const response = await call("PUT", "/profile", {
      goals: "",
      riskWords: "",
      horizonYears: null,
      monthlyInPence: null,
      exclusions: [],
    });
    expect(response.statusCode).toBe(200);
  });

  it.each([
    ["not an object", [], "invalid_body"],
    ["goals as a number", { ...plan, goals: 5 }, "invalid_body"],
    ["goals over 280 characters", { ...plan, goals: "x".repeat(281) }, "goals_too_long"],
    ["risk words over 280", { ...plan, riskWords: "x".repeat(281) }, "risk_words_too_long"],
    ["a 61-year horizon", { ...plan, horizonYears: 61 }, "horizon_out_of_range"],
    ["half a year", { ...plan, horizonYears: 2.5 }, "horizon_out_of_range"],
    ["negative money in", { ...plan, monthlyInPence: -1 }, "monthly_in_invalid"],
    ["pounds as text", { ...plan, monthlyInPence: "500" }, "monthly_in_invalid"],
    [
      "21 exclusions",
      { ...plan, exclusions: Array.from({ length: 21 }, (_, i) => `x${i}`) },
      "too_many_exclusions",
    ],
    [
      "an exclusion over 60 characters",
      { ...plan, exclusions: ["x".repeat(61)] },
      "exclusion_invalid",
    ],
    ["exclusions as text", { ...plan, exclusions: "Tobacco" }, "exclusion_invalid"],
  ])("refuses %s", async (_label, payload, error) => {
    const { call } = setup();
    const response = await call("PUT", "/profile", payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
  });

  it("keeps each person's plan to themselves", async () => {
    const { call, friend } = setup();
    await call("PUT", "/profile", plan);
    expect(
      ((await call("GET", "/profile", undefined, friend)).json() as ProfileView).profile,
    ).toEqual(EMPTY_PROFILE);
  });
});

describe("trust rules", () => {
  const valid = (overrides: Partial<TrustSettings> = {}): TrustSettings => ({
    ...structuredClone(DEFAULT_TRUST_SETTINGS),
    ...overrides,
  });

  it("start at the signed-off defaults", async () => {
    const { call } = setup();
    expect((await call("GET", "/trust-rules")).json()).toEqual({
      settings: DEFAULT_TRUST_SETTINGS,
    });
  });

  it("save, with publishers written any way turned into bare domains", async () => {
    const { call } = setup();
    const response = await call(
      "PUT",
      "/trust-rules",
      valid({
        minSources: 3,
        namedPublishers: ["https://www.Reuters.com/markets", "ft.com", "FT.com"],
      }),
    );
    expect(response.statusCode).toBe(200);
    const body = response.json() as TrustRulesView;
    expect(body.settings.minSources).toBe(3);
    expect(body.settings.namedPublishers).toEqual(["reuters.com", "ft.com"]);
    expect(body.lastChangedAt).toBeTruthy();
    expect(((await call("GET", "/trust-rules")).json() as TrustRulesView).settings.minSources).toBe(
      3,
    );
  });

  it("accept the edges", async () => {
    const { call } = setup();
    for (const settings of [
      valid({
        recencyDays: 1,
        minSources: 1,
        resultsQuietDays: 0,
        weeklyBudget: 1,
        dailyBudgetPerDay: 0,
        dailyBudgetPerWeek: 0,
      }),
      valid({
        recencyDays: 14,
        minSources: 5,
        resultsQuietDays: 7,
        weeklyBudget: 8,
        dailyBudgetPerDay: 3,
        dailyBudgetPerWeek: 7,
        bigMovePercent: { Base: 1, Medium: 50, Degen: 50 },
      }),
    ]) {
      expect((await call("PUT", "/trust-rules", settings)).statusCode).toBe(200);
    }
  });

  it.each([
    ["not an object", ["rules"], "invalid_body"],
    ["fractions", valid({ minSources: 2.5 }), "whole_numbers_needed"],
    ["numbers as text", { ...valid(), recencyDays: "7" }, "whole_numbers_needed"],
    ["no big moves", { ...valid(), bigMovePercent: undefined }, "whole_numbers_needed"],
    ["15 days", valid({ recencyDays: 15 }), "recency_out_of_range"],
    ["no sources", valid({ minSources: 0 }), "sources_out_of_range"],
    ["an 8-day quiet period", valid({ resultsQuietDays: 8 }), "quiet_days_out_of_range"],
    ["no weekly nudges", valid({ weeklyBudget: 0 }), "weekly_budget_out_of_range"],
    ["4 daily nudges a day", valid({ dailyBudgetPerDay: 4 }), "daily_budget_out_of_range"],
    ["8 daily nudges a week", valid({ dailyBudgetPerWeek: 8 }), "daily_budget_out_of_range"],
    [
      "a 51% big move",
      valid({ bigMovePercent: { Base: 3, Medium: 7, Degen: 51 } }),
      "big_move_out_of_range",
    ],
    [
      "a publisher that isn't a domain",
      valid({ namedPublishers: ["Reuters"] }),
      "publishers_invalid",
    ],
    ["publishers as text", { ...valid(), namedPublishers: "reuters.com" }, "publishers_invalid"],
    ["no publishers", valid({ namedPublishers: [] }), "publishers_count"],
    [
      "101 publishers",
      valid({ namedPublishers: Array.from({ length: 101 }, (_, i) => `p${i}.com`) }),
      "publishers_count",
    ],
  ])("refuse %s, whatever the screen allowed", async (_label, payload, error) => {
    const { call } = setup();
    const response = await call("PUT", "/trust-rules", payload);
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error });
  });

  it("keep each person's rules to themselves", async () => {
    const { call, friend } = setup();
    await call("PUT", "/trust-rules", valid({ minSources: 4 }));
    const theirs = (await call("GET", "/trust-rules", undefined, friend)).json() as TrustRulesView;
    expect(theirs.settings.minSources).toBe(DEFAULT_TRUST_SETTINGS.minSources);
  });

  it("change nothing about the shape rules", async () => {
    const { call } = setup();
    await call("PUT", "/trust-rules", valid({ minSources: 5 }));
    await call("PUT", "/profile", plan);
    const rules = (await call("GET", "/rules")).json() as { settings: unknown };
    expect(rules.settings).toEqual({ handpickedTarget: 25, sideBetCap: 5 });
  });
});
