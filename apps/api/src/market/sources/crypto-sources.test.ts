import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createCoinGeckoSource, krakenCoinIds } from "./coingecko.js";
import { withFallback } from "./fallback.js";
import { createKrakenPublicSource } from "./kraken-public.js";
import { PriceSourceError, type PriceTarget } from "./types.js";

const recorded = (path: string) =>
  readFileSync(resolve(import.meta.dirname, "../../../fixtures/recorded", path), "utf8");

function answering(body: string | object, status = 200) {
  return vi.fn<typeof fetch>(
    async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }),
  );
}

const DAY_MS = 86_400_000;
const bitcoin: PriceTarget = { kind: "instrument", symbol: "bitcoin", currency: "GBP" };
const xbtGbp: PriceTarget = { kind: "instrument", symbol: "XBTGBP", currency: "GBP" };

const chartPoints = (path: string) =>
  (JSON.parse(recorded(path)) as { prices: [number, number][] }).prices;

describe("CoinGecko", () => {
  const dayPoints = chartPoints("coingecko/market-chart-bitcoin-gbp-1.json");
  const lastAt = dayPoints[dayPoints.length - 1]![0];
  const midnight = Math.floor(lastAt / DAY_MS) * DAY_MS;

  it("reads a price in pounds, yesterday's close and today's points", async () => {
    const fetchMock = answering(recorded("coingecko/market-chart-bitcoin-gbp-1.json"));
    const source = createCoinGeckoSource({
      apiKey: "demo-key",
      fetch: fetchMock,
      now: () => new Date(lastAt),
    });
    const quote = await source.quote(bitcoin);

    const beforeMidnight = dayPoints.filter(([at]) => at <= midnight);
    expect(quote).toMatchObject({
      price: dayPoints[dayPoints.length - 1]![1],
      previousClose: beforeMidnight[beforeMidnight.length - 1]![1],
      currency: "GBP",
      asOf: new Date(lastAt),
    });
    expect(quote.intraday!.every((point) => point.at.getTime() > midnight)).toBe(true);
    expect(quote.intraday!.length).toBe(dayPoints.filter(([at]) => at > midnight).length);

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("coins/bitcoin/market_chart?vs_currency=gbp&days=1");
    expect((init!.headers as Record<string, string>)["x-cg-demo-api-key"]).toBe("demo-key");
  });

  it("turns midnight-stamped daily points into the previous day's closes", async () => {
    const points = chartPoints("coingecko/market-chart-bitcoin-gbp-365-daily.json");
    const last = points[points.length - 1]![0];
    const source = createCoinGeckoSource({
      apiKey: "demo-key",
      fetch: answering(recorded("coingecko/market-chart-bitcoin-gbp-365-daily.json")),
      now: () => new Date(last),
    });
    const from = new Date(last - 30 * DAY_MS);
    const closes = await source.dailyCloses(bitcoin, from);

    const midnightPoints = points.filter(([at]) => at % DAY_MS === 0);
    const [lastMidnight, lastClose] = midnightPoints[midnightPoints.length - 1]!;
    expect(closes[closes.length - 1]).toEqual({
      day: new Date(lastMidnight - DAY_MS).toISOString().slice(0, 10),
      close: lastClose,
    });
    expect(closes[0]!.day >= from.toISOString().slice(0, 10)).toBe(true);
    expect(closes.map((c) => c.day)).toEqual([...closes.map((c) => c.day)].sort());
    expect(new Set(closes.map((c) => c.day)).size).toBe(closes.length);
  });

  it("refuses history older than 365 days so the fallback can answer", async () => {
    const fetchMock = answering(recorded("coingecko/range-too-long.json"), 401);
    const source = createCoinGeckoSource({ apiKey: "demo-key", fetch: fetchMock });
    await expect(
      source.dailyCloses(bitcoin, new Date(Date.now() - 400 * DAY_MS)),
    ).rejects.toMatchObject({ reason: "unsupported" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports blocked, missing and broken answers", async () => {
    const at = (body: string, status: number) =>
      createCoinGeckoSource({ apiKey: "k", fetch: answering(body, status) }).quote(bitcoin);
    await expect(at("{}", 429)).rejects.toMatchObject({ reason: "blocked" });
    await expect(at('{"error":"coin not found"}', 404)).rejects.toMatchObject({
      reason: "not_found",
    });
    await expect(at("oops", 200)).rejects.toMatchObject({ reason: "unavailable" });
  });

  it("maps Kraken's asset names to CoinGecko coin ids", async () => {
    const ids = await krakenCoinIds({
      apiKey: "k",
      fetch: answering(recorded("coingecko/exchange-kraken-tickers-sample.json")),
    });
    expect(ids.get("XBT")).toBe("bitcoin");
    expect(ids.get("ETH")).toBe("ethereum");
    expect(ids.get("SOL")).toBe("solana");
  });
});

describe("Kraken public prices", () => {
  it("reads the last trade in pounds, with today's open as yesterday's close", async () => {
    const body = JSON.parse(recorded("kraken/public-ticker-XBTGBP.json")) as {
      result: { XXBTZGBP: { c: string[]; o: string } };
    };
    const fetchMock = answering(recorded("kraken/public-ticker-XBTGBP.json"));
    const fetchedAt = new Date("2026-09-16T21:00:00Z");
    const quote = await createKrakenPublicSource({ fetch: fetchMock, now: () => fetchedAt }).quote(
      xbtGbp,
    );
    expect(quote).toEqual({
      price: Number(body.result.XXBTZGBP.c[0]),
      previousClose: Number(body.result.XXBTZGBP.o),
      currency: "GBP",
      asOf: fetchedAt,
    });
    expect(String(fetchMock.mock.calls[0]![0])).toBe(
      "https://api.kraken.com/0/public/Ticker?pair=XBTGBP",
    );
  });

  it("reads daily candles and drops today's unfinished one", async () => {
    const body = JSON.parse(recorded("kraken/public-ohlc-XBTGBP-daily-last40.json")) as {
      result: { XXBTZGBP: [number, string, string, string, string][] };
    };
    const candles = body.result.XXBTZGBP;
    const todayOpen = candles[candles.length - 1]![0] * 1000;
    const source = createKrakenPublicSource({
      fetch: answering(recorded("kraken/public-ohlc-XBTGBP-daily-last40.json")),
      now: () => new Date(todayOpen + 3_600_000),
    });
    const closes = await source.dailyCloses(xbtGbp, new Date(candles[0]![0] * 1000));

    expect(closes).toHaveLength(candles.length - 1);
    const lastFinished = candles[candles.length - 2]!;
    expect(closes[closes.length - 1]).toEqual({
      day: new Date(lastFinished[0] * 1000).toISOString().slice(0, 10),
      close: Number(lastFinished[4]),
    });
  });

  it("reports an unknown pair as not found", async () => {
    const source = createKrakenPublicSource({
      fetch: answering({ error: ["EQuery:Unknown asset pair"] }),
    });
    await expect(source.quote(xbtGbp)).rejects.toMatchObject({ reason: "not_found" });
  });
});

describe("crypto fallback", () => {
  it("asks Kraken for history older than CoinGecko keeps", async () => {
    const coinGecko = createCoinGeckoSource({ apiKey: "k", fetch: answering("{}") });
    const kraken = createKrakenPublicSource({
      fetch: answering(recorded("kraken/public-ohlc-XBTGBP-daily-last40.json")),
    });
    const market = withFallback([
      { source: coinGecko, symbolFor: () => bitcoin },
      { source: kraken, symbolFor: () => xbtGbp },
    ]);
    const answer = await market.dailyCloses(bitcoin, new Date(Date.now() - 500 * DAY_MS));
    expect(answer.source.id).toBe("kraken");
  });

  it("skips Kraken for a coin with no pounds pair", async () => {
    const market = withFallback([
      {
        source: createCoinGeckoSource({ apiKey: "k", fetch: answering("{}", 503) }),
        symbolFor: () => bitcoin,
      },
      { source: createKrakenPublicSource({ fetch: answering("{}") }), symbolFor: () => null },
    ]);
    await expect(market.quote(bitcoin)).rejects.toBeInstanceOf(PriceSourceError);
  });
});
