import { PriceSourceError, type DailyClose, type PriceSource, type PriceTarget } from "./types.js";

/**
 * CoinGecko's Demo API — crypto prices in pounds (Phase 3 decision 1). Needs a
 * free key; attribution is required, which the provenance line gives by naming
 * it. The target's `symbol` is CoinGecko's coin id (`bitcoin`). History only
 * reaches back 365 days on this plan, so older requests are refused as
 * `unsupported` and the fallback asks Kraken.
 */
const BASE = "https://api.coingecko.com/api/v3/";
export const COINGECKO_HISTORY_DAYS = 365;
const DAY_MS = 86_400_000;

export function createCoinGeckoSource(options: {
  apiKey: string;
  fetch?: typeof fetch;
  now?: () => Date;
}): PriceSource {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  async function get(path: string): Promise<unknown> {
    let response: Response;
    try {
      response = await doFetch(BASE + path, {
        headers: { "x-cg-demo-api-key": options.apiKey, Accept: "application/json" },
      });
    } catch {
      throw new PriceSourceError("coingecko", "unavailable", "unreachable");
    }
    if (response.status === 429) throw new PriceSourceError("coingecko", "blocked", "429");
    if (response.status === 404) throw new PriceSourceError("coingecko", "not_found", path);
    if (!response.ok) {
      throw new PriceSourceError("coingecko", "unavailable", String(response.status));
    }
    try {
      return await response.json();
    } catch {
      throw new PriceSourceError("coingecko", "unavailable", "not JSON");
    }
  }

  function coin(target: PriceTarget): string {
    if (target.kind !== "instrument") {
      throw new PriceSourceError("coingecko", "unsupported", "not a coin");
    }
    return encodeURIComponent(target.symbol);
  }

  async function chart(target: PriceTarget, query: string): Promise<[number, number][]> {
    const body = (await get(`coins/${coin(target)}/market_chart?vs_currency=gbp&${query}`)) as {
      prices?: unknown;
    };
    const points = body.prices;
    if (
      !Array.isArray(points) ||
      points.some((p) => !Array.isArray(p) || typeof p[0] !== "number" || typeof p[1] !== "number")
    ) {
      throw new PriceSourceError("coingecko", "unavailable", "no prices in response");
    }
    if (points.length === 0) throw new PriceSourceError("coingecko", "not_found", coin(target));
    return points as [number, number][];
  }

  return {
    id: "coingecko",
    label: "CoinGecko",

    /**
     * The last 24 hours at ~5-minute points: the newest is the price, the last
     * point at or before 00:00 UTC is yesterday's close, and the points since
     * then are today's chart. Crypto never closes, so "today" is the UTC day.
     */
    async quote(target) {
      const points = await chart(target, "days=1");
      const [latestAt, price] = points[points.length - 1]!;
      // The UTC day of the newest point, not of the clock, so a lagging answer stays consistent.
      const midnight = Math.floor(latestAt / DAY_MS) * DAY_MS;
      const beforeMidnight = points.filter(([at]) => at <= midnight);
      return {
        price,
        previousClose: beforeMidnight.length ? beforeMidnight[beforeMidnight.length - 1]![1] : null,
        currency: "GBP",
        asOf: new Date(latestAt),
        intraday: points
          .filter(([at]) => at > midnight)
          .map(([at, value]) => ({ at: new Date(at), price: value })),
      };
    },

    /**
     * Daily points are stamped 00:00 UTC with the price at that moment — the
     * close of the day before. The final point is "now", not a close, and is
     * dropped.
     */
    async dailyCloses(target, from) {
      const today = Math.floor(now().getTime() / DAY_MS) * DAY_MS;
      const days = Math.ceil((today - from.getTime()) / DAY_MS) + 1;
      if (days > COINGECKO_HISTORY_DAYS) {
        throw new PriceSourceError("coingecko", "unsupported", "more than 365 days back");
      }
      const points = await chart(target, `days=${Math.max(days, 2)}&interval=daily`);
      const byDay = new Map<string, number>();
      for (const [at, price] of points) {
        if (at % DAY_MS !== 0 || at > today) continue;
        byDay.set(new Date(at - DAY_MS).toISOString().slice(0, 10), price);
      }
      const fromDay = from.toISOString().slice(0, 10);
      return [...byDay]
        .map(([day, close]): DailyClose => ({ day, close }))
        .filter((close) => close.day >= fromDay)
        .sort((a, b) => a.day.localeCompare(b.day));
    },
  };
}

/**
 * Kraken's asset names → CoinGecko coin ids, from CoinGecko's own list of
 * Kraken's markets (`base` `XBT` → `bitcoin`). About 15 pages; only called when
 * Pip meets an asset it hasn't mapped yet.
 */
export async function krakenCoinIds(options: {
  apiKey: string;
  fetch?: typeof fetch;
  maxPages?: number;
}): Promise<Map<string, string>> {
  const doFetch = options.fetch ?? fetch;
  const ids = new Map<string, string>();
  for (let page = 1; page <= (options.maxPages ?? 30); page++) {
    let response: Response;
    try {
      response = await doFetch(`${BASE}exchanges/kraken/tickers?page=${page}`, {
        headers: { "x-cg-demo-api-key": options.apiKey, Accept: "application/json" },
      });
    } catch {
      throw new PriceSourceError("coingecko", "unavailable", "unreachable");
    }
    if (!response.ok) {
      throw new PriceSourceError("coingecko", "unavailable", String(response.status));
    }
    const body = (await response.json()) as { tickers?: { base?: unknown; coin_id?: unknown }[] };
    const tickers = body.tickers ?? [];
    for (const ticker of tickers) {
      if (typeof ticker.base === "string" && typeof ticker.coin_id === "string") {
        if (!ids.has(ticker.base)) ids.set(ticker.base, ticker.coin_id);
      }
    }
    if (tickers.length < 100) break;
  }
  return ids;
}

/** Names and ticker symbols for CoinGecko coin ids (`bitcoin` → Bitcoin, BTC). One call. */
export async function coinDetails(options: {
  apiKey: string;
  ids: string[];
  fetch?: typeof fetch;
}): Promise<Map<string, { name: string; symbol: string }>> {
  const details = new Map<string, { name: string; symbol: string }>();
  if (options.ids.length === 0) return details;
  const doFetch = options.fetch ?? fetch;
  let response: Response;
  try {
    response = await doFetch(
      `${BASE}coins/markets?vs_currency=gbp&ids=${options.ids.map(encodeURIComponent).join(",")}`,
      { headers: { "x-cg-demo-api-key": options.apiKey, Accept: "application/json" } },
    );
  } catch {
    throw new PriceSourceError("coingecko", "unavailable", "unreachable");
  }
  if (!response.ok) throw new PriceSourceError("coingecko", "unavailable", String(response.status));
  const body = (await response.json()) as { id?: unknown; name?: unknown; symbol?: unknown }[];
  for (const coin of Array.isArray(body) ? body : []) {
    if (typeof coin.id === "string" && typeof coin.name === "string") {
      details.set(coin.id, {
        name: coin.name,
        symbol: typeof coin.symbol === "string" ? coin.symbol.toUpperCase() : coin.id,
      });
    }
  }
  return details;
}
