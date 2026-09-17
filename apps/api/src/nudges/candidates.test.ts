import { DEFAULT_RULES, DEFAULT_TRUST_SETTINGS, type TrustSettings } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { evaluateRules } from "../rules/engine.js";
import type { NewsItem } from "../rules/trust.js";
import {
  buildCandidates,
  dedupeKey,
  nextIsaYearEnd,
  type Candidate,
  type CandidateInput,
  type HoldingInput,
} from "./candidates.js";

const NOW = new Date("2026-09-17T07:30:00Z");
const HOUR = 3_600_000;

let n = 0;
function report(domain: string, hoursAgo: number, publisher = domain): NewsItem {
  n += 1;
  return {
    id: `r${n}`,
    publisher,
    publisherDomain: domain,
    headline: `Report ${n}`,
    snippet: null,
    url: `https://${domain}/${n}`,
    publishedAt: new Date(NOW.getTime() - hoursAgo * HOUR),
  };
}

function holding(overrides: Partial<HoldingInput> & Pick<HoldingInput, "shortName">): HoldingInput {
  return {
    instrumentId: `${overrides.shortName}_ID`,
    name: overrides.shortName,
    bucket: "Medium",
    moves: { day: null, week: null, month: null },
    news: [],
    resultsDates: [],
    ownNewsroomDomains: [],
    ...overrides,
  };
}

/**
 * 75 / 25 exactly on shape unless told otherwise, with Side Bet outside it.
 * A bigger Side Bet stands for more money in: past the £350 starter limit at
 * £9 and up, which is how these tests ask for a Side Bet that needs a look.
 */
function input(
  overrides: Partial<CandidateInput> = {},
  pots = { Base: 7_000, Medium: 2_500, Degen: 500 },
  moneyIn = (pots.Degen ?? 0) >= 900 ? 40_000 : 10_000,
): CandidateInput {
  return {
    now: NOW,
    cadence: "weekly",
    settings: structuredClone(DEFAULT_TRUST_SETTINGS),
    exclusions: [],
    rules: evaluateRules(
      [
        { bucket: "Base", connected: pots.Base !== null, valuePence: pots.Base ?? 0 },
        { bucket: "Medium", connected: true, valuePence: pots.Medium },
        { bucket: "Degen", connected: true, valuePence: pots.Degen },
      ],
      DEFAULT_RULES,
      { limitPence: 35_000, moneyInPence: moneyIn, starterLimit: true },
    ),
    holdings: [],
    history: { dailyShownToday: 0, dailyShownThisWeek: 0, lastCapNudgeAt: null, shownKeys: [] },
    ...overrides,
  };
}

const planted = () =>
  holding({
    shortName: "ASML",
    news: [
      report("reuters.com", 30, "Reuters"),
      report("ft.com", 26, "Financial Times"),
      report("stockchatter.example", 20),
    ],
  });

const shown = (candidates: Candidate[]) => candidates.filter((c) => c.shown);
const reasons = (candidates: Candidate[]) => candidates.map((c) => c.reason);
const settings = (overrides: Partial<TrustSettings>) => ({
  ...structuredClone(DEFAULT_TRUST_SETTINGS),
  ...overrides,
});

describe("a quiet week", () => {
  it("is a result: nothing needs you, with what Pip checked and what's next", () => {
    const build = buildCandidates(
      input({
        holdings: [
          holding({ shortName: "GRG", bucket: "Base" }),
          holding({
            shortName: "NVDA",
            resultsDates: ["2026-10-07"],
            news: [report("reddit.com", 3)],
          }),
        ],
      }),
    );
    expect(reasons(build.candidates)).toEqual(["quiet"]);
    expect(build.candidates[0]).toMatchObject({
      kind: "none",
      shown: true,
      facts: {
        type: "quiet",
        counts: { holdingsChecked: 2, reportsRead: 1, reportsCounted: 0, heldBack: {} },
        next: { what: "NVDA results", onDate: "2026-10-07" },
      },
    });
  });

  it("still says nothing needs you when everything found was held back, and counts why", () => {
    const build = buildCandidates(
      input({ holdings: [planted()], settings: settings({ minSources: 3 }) }),
    );
    expect(reasons(build.candidates)).toEqual(["news", "quiet"]);
    expect(build.candidates[0]).toMatchObject({ shown: false, heldBackBy: "independent_sources" });
    expect(build.counts.heldBack).toEqual({ independent_sources: 1 });
  });

  it("names the ISA year end as next when nothing else is dated", () => {
    expect(buildCandidates(input()).next).toEqual({ what: "ISA year end", onDate: "2027-04-05" });
  });
});

describe("news from named publishers", () => {
  it("passes the planted ASML story with two named publishers, and says how it's backed", () => {
    const [news] = buildCandidates(input({ holdings: [planted()] })).candidates;
    expect(news).toMatchObject({
      kind: "awareness",
      reason: "news",
      shown: true,
      heldBackBy: null,
      basis: "Based on 2 sources over 1 day",
    });
    expect(news!.facts.type === "news" && news!.facts.reports.map((r) => r.publisher)).toEqual([
      "Financial Times",
      "Reuters",
    ]);
    expect(news!.checks.map((c) => [c.rule, c.passed])).toEqual([
      ["cap_room", true],
      ["exclusions", true],
      ["results_quiet", true],
      ["independent_sources", true],
      ["weekly_budget", true],
    ]);
  });

  it("holds it back once three publishers are needed", () => {
    const [news] = buildCandidates(
      input({ holdings: [planted()], settings: settings({ minSources: 3 }) }),
    ).candidates;
    expect(news).toMatchObject({ shown: false, heldBackBy: "independent_sources" });
  });

  it("holds back news near a holding's results, but still puts the date on the calendar", () => {
    const build = buildCandidates(
      input({ holdings: [{ ...planted(), resultsDates: ["2026-09-19"] }] }),
    );
    expect(build.candidates.map((c) => [c.reason, c.shown, c.heldBackBy])).toEqual([
      ["earnings", true, null],
      ["news", false, "results_quiet"],
    ]);
  });

  it("never nudges on Side Bet news while Side Bet is over its cap", () => {
    const build = buildCandidates(
      input(
        { holdings: [{ ...planted(), bucket: "Degen" }] },
        { Base: 7_000, Medium: 2_500, Degen: 900 },
      ),
    );
    expect(build.candidates.map((c) => [c.reason, c.shown, c.heldBackBy])).toEqual([
      ["cap", true, null],
      ["news", false, "cap_room"],
    ]);
  });

  it("never nudges on something on the exclusions list", () => {
    const [news] = buildCandidates(
      input({ holdings: [planted()], exclusions: ["asml"] }),
    ).candidates;
    expect(news).toMatchObject({ shown: false, heldBackBy: "exclusions" });
  });

  it("counts a company's newsroom as a source for that company", () => {
    const nvidia = holding({
      shortName: "NVDA",
      news: [
        report("nvidianews.nvidia.com", 5, "NVIDIA Newsroom"),
        report("reuters.com", 4, "Reuters"),
      ],
      ownNewsroomDomains: ["nvidianews.nvidia.com"],
    });
    const [news] = buildCandidates(input({ holdings: [nvidia] })).candidates;
    expect(news).toMatchObject({ shown: true, basis: "Based on 2 sources over 1 day" });
  });

  it("isn't a daily nudge", () => {
    expect(buildCandidates(input({ cadence: "daily", holdings: [planted()] })).candidates).toEqual(
      [],
    );
  });
});

describe("the weekly budget", () => {
  it("shows the best-backed awareness nudges, holds back the rest, and never drops shape or calendar", () => {
    const many = ["A", "B", "C", "D", "E", "F"].map((name, i) =>
      holding({
        shortName: name,
        news: [
          report("reuters.com", 10 + i, "Reuters"),
          ...(i < 2
            ? [report("ft.com", 10, "FT"), report("bbc.co.uk", 10, "BBC")]
            : [report("ft.com", 10, "FT")]),
        ],
        resultsDates: i === 5 ? ["2026-09-24"] : [],
      }),
    );
    const build = buildCandidates(
      input({ holdings: many }, { Base: 5_000, Medium: 4_500, Degen: 500 }),
    );
    const news = build.candidates.filter((c) => c.reason === "news");
    expect(news.filter((c) => c.shown).map((c) => c.instrumentId)).toEqual([
      "A_ID",
      "B_ID",
      "C_ID",
      "D_ID",
    ]);
    expect(news.filter((c) => !c.shown).map((c) => c.heldBackBy)).toEqual([
      "weekly_budget",
      "weekly_budget",
    ]);
    expect(shown(build.candidates).map((c) => c.reason)).toEqual(
      expect.arrayContaining(["drift", "drift", "earnings"]),
    );
  });
});

describe("shape", () => {
  it("names a broken cap with the engine's numbers", () => {
    const [cap] = buildCandidates(input({}, { Base: 7_000, Medium: 2_500, Degen: 900 })).candidates;
    expect(cap).toMatchObject({
      kind: "shape",
      reason: "cap",
      bucket: "Degen",
      shown: true,
      facts: { type: "cap", overBy: { percent: expect.any(Number), pence: expect.any(Number) } },
    });
  });

  it("names a drifted target weekly, never daily", () => {
    const pots = { Base: 5_000, Medium: 4_500, Degen: 500 };
    expect(reasons(buildCandidates(input({}, pots)).candidates)).toEqual(["drift", "drift"]);
    expect(buildCandidates(input({ cadence: "daily" }, pots)).candidates).toEqual([]);
  });

  it("repeats a broken cap as a daily nudge at most once a week", () => {
    const over = { Base: 7_000, Medium: 2_500, Degen: 900 };
    const sixDaysAgo = new Date(NOW.getTime() - 6 * 24 * HOUR);
    const sevenDaysAgo = new Date(NOW.getTime() - 7 * 24 * HOUR);
    const history = (lastCapNudgeAt: Date) => ({
      dailyShownToday: 0,
      dailyShownThisWeek: 0,
      lastCapNudgeAt,
      shownKeys: [],
    });
    expect(
      buildCandidates(input({ cadence: "daily", history: history(sixDaysAgo) }, over)).candidates,
    ).toEqual([]);
    expect(
      reasons(
        buildCandidates(input({ cadence: "daily", history: history(sevenDaysAgo) }, over))
          .candidates,
      ),
    ).toEqual(["cap"]);
  });

  it("stays quiet about a pot named on the exclusions list", () => {
    const [cap] = buildCandidates(
      input({ exclusions: ["Side Bet"] }, { Base: 7_000, Medium: 2_500, Degen: 900 }),
    ).candidates;
    expect(cap).toMatchObject({ shown: false, heldBackBy: "exclusions" });
  });
});

describe("calendar", () => {
  it("mentions results within a week, and daily only within two days", () => {
    const soon = (day: string) => [holding({ shortName: "NVDA", resultsDates: [day] })];
    expect(reasons(buildCandidates(input({ holdings: soon("2026-09-24") })).candidates)).toEqual([
      "earnings",
    ]);
    expect(reasons(buildCandidates(input({ holdings: soon("2026-09-25") })).candidates)).toEqual([
      "quiet",
    ]);
    expect(
      reasons(
        buildCandidates(input({ cadence: "daily", holdings: soon("2026-09-19") })).candidates,
      ),
    ).toEqual(["earnings"]);
    expect(
      buildCandidates(input({ cadence: "daily", holdings: soon("2026-09-20") })).candidates,
    ).toEqual([]);
  });

  it("doesn't repeat a daily results nudge already shown", () => {
    const nvidia = holding({ shortName: "NVDA", resultsDates: ["2026-09-18"] });
    const history = {
      dailyShownToday: 0,
      dailyShownThisWeek: 1,
      lastCapNudgeAt: null,
      shownKeys: [dedupeKey("earnings", "NVDA_ID", "2026-09-18")],
    };
    expect(
      buildCandidates(input({ cadence: "daily", holdings: [nvidia], history })).candidates,
    ).toEqual([]);
  });

  it("mentions the ISA year end in the fortnight before 5 April, only with Foundation connected", () => {
    const march = new Date("2027-03-22T08:00:00Z");
    expect(reasons(buildCandidates(input({ now: march })).candidates)).toEqual(["isa_year_end"]);
    expect(
      reasons(buildCandidates(input({ now: new Date("2027-03-21T08:00:00Z") })).candidates),
    ).toEqual(["quiet"]);
    const noFoundation = input(
      { now: march },
      { Base: null as unknown as number, Medium: 9_500, Degen: 500 },
    );
    expect(reasons(buildCandidates(noFoundation).candidates)).not.toContain("isa_year_end");
  });

  it("finds the next 5 April", () => {
    expect(nextIsaYearEnd(new Date("2027-04-05T23:00:00Z"))).toBe("2027-04-05");
    expect(nextIsaYearEnd(new Date("2027-04-06T00:00:00Z"))).toBe("2028-04-05");
  });
});

describe("big moves", () => {
  const moved = (
    bucket: HoldingInput["bucket"],
    percent: number,
    period: "day" | "week" = "week",
  ) =>
    holding({
      shortName: "GRG",
      bucket,
      moves: { day: null, week: null, month: null, [period]: { percent, pence: -4_100 } },
    });

  it("uses the week's move weekly, at each pot's own line", () => {
    expect(reasons(buildCandidates(input({ holdings: [moved("Medium", -7)] })).candidates)).toEqual(
      ["move"],
    );
    expect(
      reasons(buildCandidates(input({ holdings: [moved("Medium", -6.99)] })).candidates),
    ).toEqual(["quiet"]);
    expect(reasons(buildCandidates(input({ holdings: [moved("Base", 3)] })).candidates)).toEqual([
      "move",
    ]);
    expect(reasons(buildCandidates(input({ holdings: [moved("Degen", 14)] })).candidates)).toEqual([
      "quiet",
    ]);
  });

  it("follows the user's lines", () => {
    const tighter = settings({ bigMovePercent: { Base: 3, Medium: 5, Degen: 15 } });
    expect(
      reasons(
        buildCandidates(input({ holdings: [moved("Medium", 6)], settings: tighter })).candidates,
      ),
    ).toEqual(["move"]);
  });

  it("uses the day's move daily", () => {
    expect(
      reasons(
        buildCandidates(input({ cadence: "daily", holdings: [moved("Medium", 8, "day")] }))
          .candidates,
      ),
    ).toEqual(["move"]);
    expect(
      buildCandidates(input({ cadence: "daily", holdings: [moved("Medium", 8, "week")] }))
        .candidates,
    ).toEqual([]);
  });
});

describe("the daily budget", () => {
  const busyDay = () =>
    input(
      {
        cadence: "daily",
        holdings: [
          holding({ shortName: "NVDA", resultsDates: ["2026-09-18"] }),
          holding({
            shortName: "GRG",
            moves: { day: { percent: 9, pence: 900 }, week: null, month: null },
          }),
        ],
      },
      { Base: 7_000, Medium: 2_500, Degen: 900 },
    );

  it("shows the most important first: a broken cap, then results, then moves", () => {
    const build = buildCandidates(busyDay());
    expect(build.candidates.map((c) => [c.reason, c.shown])).toEqual([
      ["cap", true],
      ["earnings", false],
      ["move", false],
    ]);
    expect(build.counts.heldBack).toEqual({ daily_budget: 2 });
  });

  it("counts what's already been shown today and this week", () => {
    const today = {
      ...busyDay(),
      history: { dailyShownToday: 1, dailyShownThisWeek: 1, lastCapNudgeAt: null, shownKeys: [] },
    };
    expect(shown(buildCandidates(today).candidates)).toEqual([]);
    const week = {
      ...busyDay(),
      settings: settings({ dailyBudgetPerDay: 3, dailyBudgetPerWeek: 3 }),
      history: { dailyShownToday: 0, dailyShownThisWeek: 2, lastCapNudgeAt: null, shownKeys: [] },
    };
    expect(shown(buildCandidates(week).candidates).map((c) => c.reason)).toEqual(["cap"]);
  });

  it("never produces a 'nothing needs you' on a quiet day", () => {
    expect(buildCandidates(input({ cadence: "daily" })).candidates).toEqual([]);
  });
});

describe("determinism", () => {
  it("gives the same answer for the same input", () => {
    const one = input({ holdings: [planted()] });
    expect(buildCandidates(one)).toEqual(buildCandidates(structuredClone(one)));
  });
});
