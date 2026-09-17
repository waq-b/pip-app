import { DEFAULT_TRUST_SETTINGS, type TrustSettings } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import {
  basisFor,
  capRoomCheck,
  domainMatches,
  excludedBy,
  exclusionsCheck,
  independentSourcesCheck,
  publisherKey,
  resultsQuietCheck,
  stageA,
  type NewsItem,
} from "./trust.js";

const NOW = new Date("2026-09-17T09:00:00Z");
const HOUR = 3_600_000;
const settings = (overrides: Partial<TrustSettings> = {}): TrustSettings => ({
  ...structuredClone(DEFAULT_TRUST_SETTINGS),
  ...overrides,
});

let n = 0;
function report(domain: string, hoursAgo: number, overrides: Partial<NewsItem> = {}): NewsItem {
  n += 1;
  return {
    id: `r${n}`,
    publisher: domain,
    publisherDomain: domain,
    headline: `ASML news ${n}`,
    snippet: null,
    url: `https://${domain}/${n}`,
    publishedAt: new Date(NOW.getTime() - hoursAgo * HOUR),
    ...overrides,
  };
}

const contextFor = (overrides: Partial<Parameters<typeof stageA>[1]> = {}) => ({
  now: NOW,
  cadence: "weekly" as const,
  settings: settings(),
  exclusions: [],
  ownNewsroomDomains: [],
  ...overrides,
});

describe("who a publisher is", () => {
  it.each([
    ["reuters.com", "reuters"],
    ["www.reuters.com", "reuters"],
    ["bbc.co.uk", "bbc"],
    ["bbc.com", "bbc"],
    ["finance.yahoo.com", "yahoo"],
    ["uk.finance.yahoo.com", "yahoo"],
    ["theblock.co", "theblock"],
    ["proactiveinvestors.co.uk", "proactiveinvestors"],
    ["nvidianews.nvidia.com", "nvidia"],
  ])("%s is %s", (domain, key) => {
    expect(publisherKey(domain)).toBe(key);
  });

  it("matches a named domain and its subdomains, nothing that merely ends the same", () => {
    expect(domainMatches("reuters.com", "reuters.com")).toBe(true);
    expect(domainMatches("uk.reuters.com", "reuters.com")).toBe(true);
    expect(domainMatches("notreuters.com", "reuters.com")).toBe(false);
    expect(domainMatches("reuters.com.evil.test", "reuters.com")).toBe(false);
  });
});

describe("stage A: which reports count", () => {
  it("keeps named publishers inside the recency window, newest first", () => {
    const old = report("reuters.com", 24 * 8);
    const ft = report("ft.com", 30);
    const reuters = report("reuters.com", 5);
    const { kept, dropped } = stageA([old, ft, reuters], contextFor());
    expect(kept).toEqual([reuters, ft]);
    expect(dropped).toEqual([{ item: old, rule: "recency" }]);
  });

  it("drops unnamed publishers — forums, socials and unknown sites", () => {
    const reddit = report("reddit.com", 2);
    const blog = report("stockchatter.example", 2);
    const { kept, dropped } = stageA([reddit, blog], contextFor());
    expect(kept).toEqual([]);
    expect(dropped.map((d) => d.rule)).toEqual(["named_publishers", "named_publishers"]);
  });

  it("counts a company's own newsroom for that company only", () => {
    const newsroom = report("nvidianews.nvidia.com", 3);
    expect(stageA([newsroom], contextFor()).kept).toEqual([]);
    expect(
      stageA([newsroom], contextFor({ ownNewsroomDomains: ["nvidianews.nvidia.com"] })).kept,
    ).toEqual([newsroom]);
  });

  it("uses a 48-hour window for daily nudges, whatever the weekly setting", () => {
    const yesterday = report("reuters.com", 30);
    const threeDays = report("reuters.com", 72);
    const { kept } = stageA([yesterday, threeDays], contextFor({ cadence: "daily" }));
    expect(kept).toEqual([yesterday]);
  });

  it("follows the recency setting at its edges", () => {
    const sixDays = report("reuters.com", 24 * 6);
    expect(stageA([sixDays], contextFor({ settings: settings({ recencyDays: 5 }) })).kept).toEqual(
      [],
    );
    expect(stageA([sixDays], contextFor({ settings: settings({ recencyDays: 6 }) })).kept).toEqual([
      sixDays,
    ]);
  });

  it("ignores a report dated in the future", () => {
    const future = report("reuters.com", -2);
    expect(stageA([future], contextFor()).dropped).toEqual([{ item: future, rule: "recency" }]);
  });

  it("drops reports that mention something on the exclusions list", () => {
    const tobacco = report("reuters.com", 2, { headline: "Tobacco maker agrees deal" });
    expect(stageA([tobacco], contextFor({ exclusions: ["tobacco"] })).dropped).toEqual([
      { item: tobacco, rule: "exclusions" },
    ]);
  });

  it("follows a user's own publisher list", () => {
    const guardian = report("theguardian.com", 2);
    expect(
      stageA([guardian], contextFor({ settings: settings({ namedPublishers: ["reuters.com"] }) }))
        .kept,
    ).toEqual([]);
  });
});

describe("stage B checks", () => {
  it("counts independent publishers, not reports", () => {
    const twoBbc = [report("bbc.co.uk", 2), report("bbc.com", 3)];
    expect(independentSourcesCheck(twoBbc, settings())).toMatchObject({
      passed: false,
      detail: "1 publisher: bbc.co.uk",
    });
    const planted = [report("reuters.com", 30), report("ft.com", 26)];
    expect(independentSourcesCheck(planted, settings())).toMatchObject({ passed: true });
    expect(independentSourcesCheck(planted, settings({ minSources: 3 }))).toMatchObject({
      passed: false,
      setting: 3,
    });
  });

  it("keeps quiet around results, either side, at the setting's edge", () => {
    const quiet = settings({ resultsQuietDays: 3 });
    expect(resultsQuietCheck(["2026-09-20"], NOW, quiet)).toMatchObject({
      passed: false,
      detail: "Results in 3 days (2026-09-20)",
    });
    expect(resultsQuietCheck(["2026-09-21"], NOW, quiet)).toMatchObject({ passed: true });
    expect(resultsQuietCheck(["2026-09-15"], NOW, quiet)).toMatchObject({
      passed: false,
      detail: "Results 2 days ago (2026-09-15)",
    });
    expect(resultsQuietCheck(["2026-09-17"], NOW, settings({ resultsQuietDays: 0 }))).toMatchObject(
      {
        passed: false,
        detail: "Results today (2026-09-17)",
      },
    );
  });

  it("says so when no results date is known, rather than skipping silently", () => {
    expect(resultsQuietCheck([], NOW, settings())).toEqual({
      rule: "results_quiet",
      setting: 3,
      passed: true,
      detail: "No results date known",
    });
  });

  it("blocks Side Bet only while it's over its cap", () => {
    expect(capRoomCheck(true, true).passed).toBe(false);
    expect(capRoomCheck(true, false).passed).toBe(true);
    expect(capRoomCheck(false, true).passed).toBe(true);
  });

  it("matches exclusions as whole words, any case", () => {
    expect(excludedBy(["greggs"], "Greggs results")).toBe("greggs");
    expect(excludedBy(["Gregg"], "Greggs results")).toBeNull();
    expect(exclusionsCheck(["NVDA"], "Nvidia", "NVDA")).toMatchObject({
      passed: false,
      detail: "NVDA",
    });
  });
});

describe("the basis line", () => {
  it("names sources and days, never a percentage", () => {
    expect(
      basisFor([report("reuters.com", 30), report("ft.com", 26), report("reuters.com", 2)]),
    ).toMatch(/^Based on 2 sources over \d days?$/);
    expect(basisFor([report("reuters.com", 1)])).toBe("Based on 1 source over 1 day");
  });
});
