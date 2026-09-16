import type { Bucket, BucketFreshness } from "@finance-app/shared";
import { describe, expect, it } from "vitest";
import { ladder, rungFor } from "./staleness";

const NOW = Date.parse("2026-09-16T10:00:00Z");
const SOURCE = "Sample prices · stub data";

function entry(
  bucket: Bucket,
  minutesOld: number,
  flags: { failed?: boolean; marketsClosed?: boolean } = {},
): BucketFreshness {
  return {
    bucket,
    freshness: {
      source: SOURCE,
      asOf: new Date(NOW - minutesOld * 60_000).toISOString(),
      failed: flags.failed ?? false,
      marketsClosed: flags.marketsClosed ?? false,
    },
  };
}

describe("rungFor", () => {
  it("climbs green → amber at one hour → red after six", () => {
    expect(rungFor(entry("Base", 59).freshness, NOW)).toBe("fresh");
    expect(rungFor(entry("Base", 60).freshness, NOW)).toBe("amber");
    expect(rungFor(entry("Base", 360).freshness, NOW)).toBe("amber");
    expect(rungFor(entry("Base", 361).freshness, NOW)).toBe("red");
  });

  it("goes straight to red when a fetch failed, however recent", () => {
    expect(rungFor(entry("Base", 2, { failed: true }).freshness, NOW)).toBe("red");
  });

  it("stays green when markets are closed, however old — a Saturday price is Saturday's", () => {
    expect(rungFor(entry("Base", 60 * 40, { marketsClosed: true }).freshness, NOW)).toBe("closed");
  });
});

describe("the ladder across the three pots", () => {
  it("is silent and green when everything is fresh", () => {
    const result = ladder([entry("Base", 4), entry("Medium", 3), entry("Degen", 2)], { now: NOW });

    expect(result).toMatchObject({ state: "fresh", chipped: {}, dimmed: [] });
    expect(result.line).toBe(`${SOURCE} · updated 4 min ago`);
    expect(result.card).toBeUndefined();
  });

  it("names one late pot first, then reassures about the rest", () => {
    const result = ladder([entry("Base", 4), entry("Medium", 4), entry("Degen", 130)], {
      now: NOW,
    });

    expect(result.state).toBe("amber");
    expect(result.line).toBe("Side Bet is 2 hours old · everything else updated 4 min ago");
    expect(result.chipped).toEqual({ Degen: 130 / 60 });
    expect(result.dimmed).toEqual([]);
    expect(result.card).toBeUndefined();
  });

  it("keeps two late pots to one line, naming the one that's fine", () => {
    const result = ladder([entry("Base", 4), entry("Medium", 125), entry("Degen", 130)], {
      now: NOW,
    });

    expect(result.line).toBe(
      "Handpicked and Side Bet are 2 hours old · Foundation updated 4 min ago",
    );
    expect(Object.keys(result.chipped)).toEqual(["Medium", "Degen"]);
  });

  it("hands over to the red card when all three are late", () => {
    const result = ladder([entry("Base", 125), entry("Medium", 125), entry("Degen", 130)], {
      now: NOW,
    });

    expect(result.state).toBe("red");
    expect(result.card?.heading).toBe("All prices are 2 hours old");
    expect(result.dimmed).toEqual(["Base", "Medium", "Degen"]);
  });

  it("goes red for a failed pot, and the amber line stands down", () => {
    const result = ladder(
      [entry("Base", 4), entry("Medium", 130), entry("Degen", 120, { failed: true })],
      { now: NOW },
    );

    expect(result.state).toBe("red");
    expect(result.line).not.toMatch(/hours old/);
    expect(result.card).toEqual({
      heading: "Side Bet isn't updating",
      body: "Your Side Bet number is from 2 hours ago. Everything else is live.",
    });
    expect(result.dimmed).toEqual(["Degen"]);
  });

  it("goes red past six hours", () => {
    const result = ladder([entry("Base", 4), entry("Medium", 4), entry("Degen", 60 * 7)], {
      now: NOW,
    });
    expect(result.state).toBe("red");
    expect(result.card?.heading).toBe("Side Bet isn't updating");
  });

  it("says prices are from the last close when markets are shut", () => {
    const friday = Date.parse("2026-09-18T16:30:00");
    const saturday = Date.parse("2026-09-19T11:00:00");
    const closed = (bucket: Bucket): BucketFreshness => ({
      bucket,
      freshness: {
        source: SOURCE,
        asOf: new Date(friday).toISOString(),
        failed: false,
        marketsClosed: true,
      },
    });

    const result = ladder([closed("Base"), closed("Medium"), closed("Degen")], { now: saturday });
    expect(result.state).toBe("closed");
    expect(result.line).toBe(`${SOURCE} · Prices from Friday's close`);
    expect(result.card).toBeUndefined();
  });

  it("never names a broker", () => {
    const results = [
      ladder([entry("Base", 4), entry("Medium", 4), entry("Degen", 130)], { now: NOW }),
      ladder([entry("Base", 4), entry("Medium", 4), entry("Degen", 1, { failed: true })], {
        now: NOW,
      }),
    ];
    for (const result of results) {
      expect(JSON.stringify([result.line, result.card])).not.toMatch(/Trading 212|Kraken/);
    }
  });
});

describe("the ladder on a single pot or holding", () => {
  it("doesn't name the pot it's already on", () => {
    expect(ladder([entry("Degen", 130)], { now: NOW, single: "Price" }).line).toBe(
      "Price is 2 hours old",
    );
    expect(ladder([entry("Degen", 130)], { now: NOW, single: "Prices" }).line).toBe(
      "Prices are 2 hours old",
    );
  });

  it("stays amber for one late pot — the all-three rule is for the home screen", () => {
    expect(ladder([entry("Degen", 130)], { now: NOW, single: "Prices" }).state).toBe("amber");
  });

  it("says when the last figure was seen when the feed is gone", () => {
    const result = ladder([entry("Degen", 60 * 8)], { now: NOW, single: "Price" });

    expect(result.card?.heading).toBe("The price isn't coming through");
    expect(result.card?.body).toMatch(
      /^This is the last figure Pip saw, at \d\d:\d\d\. What you own hasn't changed/,
    );
  });
});
