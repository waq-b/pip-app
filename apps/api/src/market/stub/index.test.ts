import { describe, expect, it } from "vitest";
import { createStubMarketData, STUB_SOURCE } from "./index.js";

const NOW = new Date("2026-09-16T12:00:00Z");
const market = createStubMarketData({ now: () => NOW });

describe("the stub market data source", () => {
  it("names itself the way the provenance line expects — a market source, never a broker", async () => {
    expect(market.source).toBe(STUB_SOURCE);
    expect(market.source).not.toMatch(/Trading 212|Kraken/);
  });

  it("gives the same instrument the same series every time", async () => {
    const first = await market.getSeries("NVDA", "month");
    const second = await market.getSeries("NVDA", "month");

    expect(first).toEqual(second);
  });

  it("gives different instruments different series", async () => {
    const nvidia = await market.getSeries("NVDA", "month");
    const apple = await market.getSeries("AAPL", "month");

    expect(nvidia).not.toEqual(apple);
  });

  it("draws the right number of points for each range, oldest first", async () => {
    for (const [range, points] of [
      ["day", 24],
      ["month", 30],
      ["year", 52],
      ["all", 36],
    ] as const) {
      const series = await market.getSeries("NVDA", range);

      expect(series).toHaveLength(points);
      expect(new Date(series[0]!.at).getTime()).toBeLessThan(
        new Date(series[series.length - 1]!.at).getTime(),
      );
      expect(new Date(series[series.length - 1]!.at)).toEqual(NOW);
    }
  });

  it("never produces a price of zero or less", async () => {
    const series = await market.getSeries("SOL", "all");
    for (const point of series) {
      expect(point.value).toBeGreaterThan(0);
    }
  });

  it("prices an instrument at the newest point of its series", async () => {
    const series = await market.getSeries("BTC", "day");
    await expect(market.getPrice("BTC")).resolves.toBe(series[series.length - 1]!.value);
  });
});

describe("freshness", () => {
  it("is current for every pot by default", async () => {
    const freshness = await market.getFreshness("Base");

    expect(freshness.asOf).toBe(NOW.toISOString());
    expect(freshness.failed).toBe(false);
    expect(freshness.marketsClosed).toBe(false);
    expect(freshness.source).toBe(STUB_SOURCE);
  });

  it("can age one pot without touching the others, which is what amber needs", async () => {
    const stale = createStubMarketData({
      now: () => NOW,
      staleness: { Degen: { hoursOld: 2 } },
    });

    const degen = await stale.getFreshness("Degen");
    const base = await stale.getFreshness("Base");

    expect(new Date(degen.asOf)).toEqual(new Date(NOW.getTime() - 2 * 60 * 60 * 1000));
    expect(new Date(base.asOf)).toEqual(NOW);
  });

  it("can report an outright failure, which is a red card rather than amber", async () => {
    const down = createStubMarketData({ now: () => NOW, staleness: { Degen: { failed: true } } });

    await expect(down.getFreshness("Degen")).resolves.toMatchObject({ failed: true });
  });

  it("can report markets closed, which stays green", async () => {
    const closed = createStubMarketData({
      now: () => NOW,
      staleness: { Base: { marketsClosed: true } },
    });

    await expect(closed.getFreshness("Base")).resolves.toMatchObject({ marketsClosed: true });
  });
});
