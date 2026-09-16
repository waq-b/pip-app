import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createAlphaVantageSource } from "./alpha-vantage.js";
import { withFallback } from "./fallback.js";
import { PriceSourceError, type PriceSource, type PriceTarget } from "./types.js";
import { createYahooSource } from "./yahoo.js";

const recorded = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../../../fixtures/recorded", path), "utf8");

function answering(body: string | object, status = 200) {
  return vi.fn<typeof fetch>(
    async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

const meta = (path: string) =>
  (JSON.parse(recorded(path)) as { chart: { result: { meta: Record<string, number> }[] } }).chart
    .result[0]!.meta;

const nvda: PriceTarget = { kind: "instrument", symbol: "NVDA", currency: "USD" };

describe("Yahoo", () => {
  it("reads a US quote with today's intraday points", async () => {
    const yahoo = createYahooSource({ fetch: answering(recorded("yahoo/NVDA-1d.json")) });
    const quote = await yahoo.quote(nvda);

    const { regularMarketPrice, chartPreviousClose } = meta("yahoo/NVDA-1d.json");
    expect(quote).toMatchObject({
      price: regularMarketPrice,
      previousClose: chartPreviousClose,
      currency: "USD",
    });
    expect(quote.intraday!.length).toBeGreaterThan(0);
    expect(quote.asOf).toBeInstanceOf(Date);
  });

  it("marks London pence as GBX", async () => {
    const yahoo = createYahooSource({ fetch: answering(recorded("yahoo/GRG_L-1d.json")) });
    const quote = await yahoo.quote({ kind: "instrument", symbol: "GRG.L", currency: "GBX" });
    expect(quote.currency).toBe("GBX");
    expect(quote.price).toBe(meta("yahoo/GRG_L-1d.json").regularMarketPrice);
  });

  it("keeps a pounds-priced London ETF in GBP", async () => {
    const yahoo = createYahooSource({ fetch: answering(recorded("yahoo/VWRL_L-1d.json")) });
    expect(
      (await yahoo.quote({ kind: "instrument", symbol: "VWRL.L", currency: "GBP" })).currency,
    ).toBe("GBP");
  });

  it("reads GBP→USD as units of dollars per pound", async () => {
    const fetchMock = answering(recorded("yahoo/GBPUSD_X-1d.json"));
    const quote = await createYahooSource({ fetch: fetchMock }).quote({ kind: "fx", quote: "USD" });
    expect(quote).toMatchObject({
      price: meta("yahoo/GBPUSD_X-1d.json").regularMarketPrice,
      currency: "USD",
    });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("GBPUSD%3DX");
  });

  it("reads daily closes by the exchange's own calendar day, skipping gaps", async () => {
    const body = {
      chart: {
        result: [
          {
            meta: {
              exchangeTimezoneName: "Europe/London",
              regularMarketPrice: 1,
              regularMarketTime: 1,
            },
            // 16:30 London on 14 and 15 Sep 2026 (15:30 UTC), and a null close.
            timestamp: [1789399800, 1789486200, 1789572600],
            indicators: { quote: [{ close: [1700, null, 1741] }] },
          },
        ],
      },
    };
    const closes = await createYahooSource({ fetch: answering(body) }).dailyCloses(
      nvda,
      new Date("2026-09-01"),
    );
    expect(closes).toEqual([
      { day: "2026-09-14", close: 1700 },
      { day: "2026-09-16", close: 1741 },
    ]);
  });

  it("says blocked on a 429 and not found on an unknown symbol", async () => {
    await expect(
      createYahooSource({ fetch: answering("", 429) }).quote(nvda),
    ).rejects.toMatchObject({ reason: "blocked" });
    const missing = { chart: { result: null, error: { code: "Not Found" } } };
    await expect(
      createYahooSource({ fetch: answering(missing, 404) }).quote(nvda),
    ).rejects.toMatchObject({
      reason: "not_found",
    });
  });
});

describe("Alpha Vantage", () => {
  const av = (body: string | object) =>
    createAlphaVantageSource({ apiKey: "AVKEY123", fetch: answering(body) });

  it("reads a quote, taking pence from the instrument since AV doesn't say", async () => {
    const quote = await av(recorded("alpha-vantage/quote-RR.LON.json")).quote({
      kind: "instrument",
      symbol: "RR.LON",
      currency: "GBX",
    });
    expect(quote).toMatchObject({ price: 1420.2, previousClose: 1423.8, currency: "GBX" });
    expect(quote.asOf.toISOString()).toBe("2026-09-15T21:00:00.000Z");
    expect(quote.intraday).toBeUndefined();
  });

  it("reads daily closes from a date, oldest first", async () => {
    const closes = await av(recorded("alpha-vantage/daily-VWRL.LON.json")).dailyCloses(
      { kind: "instrument", symbol: "VWRL.LON", currency: "GBP" },
      new Date("2026-09-10"),
    );
    expect(closes.at(-1)).toEqual({ day: "2026-09-15", close: 137.15 });
    expect(closes.every((c, i) => i === 0 || c.day > closes[i - 1]!.day)).toBe(true);
    expect(closes[0]!.day >= "2026-09-10").toBe(true);
  });

  it("reads FX daily closes", async () => {
    const closes = await av(recorded("alpha-vantage/fx-GBPUSD.json")).dailyCloses(
      { kind: "fx", quote: "USD" },
      new Date("2026-09-15"),
    );
    expect(closes).toEqual([{ day: "2026-09-15", close: 1.3474 }]);
  });

  it("treats AV's 200-with-a-note rate limit as blocked, and never leaks the key", async () => {
    const error = await av({ Information: "rate limit reached" })
      .quote(nvda)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PriceSourceError);
    expect((error as PriceSourceError).reason).toBe("blocked");
    expect(String((error as Error).message)).not.toContain("AVKEY123");
  });
});

describe("falling back", () => {
  const failing = (id: PriceSource["id"], reason: PriceSourceError["reason"]): PriceSource => ({
    id,
    label: id,
    quote: async () => {
      throw new PriceSourceError(id, reason, "test");
    },
    dailyCloses: async () => {
      throw new PriceSourceError(id, reason, "test");
    },
  });
  const working: PriceSource = {
    id: "alpha-vantage",
    label: "Alpha Vantage",
    quote: async () => ({ price: 1, previousClose: null, currency: "USD", asOf: new Date(0) }),
    dailyCloses: async () => [],
  };

  it("uses the next source when the first is blocked, and says which answered", async () => {
    const market = withFallback([
      { source: failing("yahoo", "blocked"), symbolFor: (t) => t },
      { source: working, symbolFor: (t) => t },
    ]);
    const result = await market.quote(nvda);
    expect(result.source.label).toBe("Alpha Vantage");
  });

  it("skips a source with no symbol for the target", async () => {
    const skipped = { ...working, id: "yahoo" as const, quote: vi.fn(working.quote) };
    const market = withFallback([
      { source: skipped, symbolFor: () => null },
      { source: working, symbolFor: (t) => t },
    ]);
    await market.quote(nvda);
    expect(skipped.quote).not.toHaveBeenCalled();
  });

  it("throws the last failure when nothing can answer", async () => {
    const market = withFallback([
      { source: failing("yahoo", "blocked"), symbolFor: (t) => t },
      { source: failing("alpha-vantage", "not_found"), symbolFor: (t) => t },
    ]);
    await expect(market.quote(nvda)).rejects.toMatchObject({
      source: "alpha-vantage",
      reason: "not_found",
    });
  });
});
