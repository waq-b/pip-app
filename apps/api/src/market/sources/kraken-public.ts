import { PriceSourceError, type DailyClose, type PriceSource } from "./types.js";

/**
 * Kraken's public market data — no key, no account, so it's a market-data
 * source and not the trading API (Phase 3 decision 1). The fallback for crypto
 * prices, and the source for history older than CoinGecko's 365 days. The
 * target's `symbol` is a Kraken pair quoted in pounds (`XBTGBP`); coins with
 * no pounds pair aren't priced here.
 */
const BASE = "https://api.kraken.com/0/public/";
const DAY_MS = 86_400_000;

export function createKrakenPublicSource(
  options: { fetch?: typeof fetch; now?: () => Date } = {},
): PriceSource {
  const doFetch = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());

  async function get(path: string): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await doFetch(BASE + path, { headers: { Accept: "application/json" } });
    } catch {
      throw new PriceSourceError("kraken", "unavailable", "unreachable");
    }
    if (response.status === 429) throw new PriceSourceError("kraken", "blocked", "429");
    if (!response.ok) throw new PriceSourceError("kraken", "unavailable", String(response.status));
    let body: { error?: unknown; result?: unknown };
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new PriceSourceError("kraken", "unavailable", "not JSON");
    }
    const errors = Array.isArray(body.error) ? body.error.map(String) : [];
    if (errors.some((e) => e.startsWith("EQuery:Unknown asset pair"))) {
      throw new PriceSourceError("kraken", "not_found", path);
    }
    if (errors.length) throw new PriceSourceError("kraken", "unavailable", errors[0]!);
    if (typeof body.result !== "object" || body.result === null) {
      throw new PriceSourceError("kraken", "unavailable", "no result");
    }
    return body.result as Record<string, unknown>;
  }

  /** Kraken answers under its own pair name (`XXBTZGBP` for `XBTGBP`). */
  function only(result: Record<string, unknown>): unknown {
    const key = Object.keys(result).find((k) => k !== "last");
    if (!key) throw new PriceSourceError("kraken", "not_found", "empty result");
    return result[key];
  }

  return {
    id: "kraken",
    label: "Kraken",

    async quote(target) {
      if (target.kind !== "instrument") {
        throw new PriceSourceError("kraken", "unsupported", "not a pair");
      }
      const ticker = only(await get(`Ticker?pair=${encodeURIComponent(target.symbol)}`)) as {
        c?: unknown[];
        o?: unknown;
      };
      const price = Number(ticker.c?.[0]);
      const open = Number(ticker.o);
      if (!Number.isFinite(price)) {
        throw new PriceSourceError("kraken", "unavailable", "no price in response");
      }
      return {
        price,
        // Today's opening price is the price at 00:00 UTC — yesterday's close.
        previousClose: Number.isFinite(open) ? open : null,
        currency: "GBP",
        // The ticker carries no timestamp; it is live when fetched.
        asOf: now(),
      };
    },

    /** Daily candles (the latest 720 only); the last one is today, unfinished, and dropped. */
    async dailyCloses(target, from) {
      if (target.kind !== "instrument") {
        throw new PriceSourceError("kraken", "unsupported", "not a pair");
      }
      const since = Math.floor(from.getTime() / 1000) - 86_400;
      const rows = only(
        await get(`OHLC?pair=${encodeURIComponent(target.symbol)}&interval=1440&since=${since}`),
      );
      if (!Array.isArray(rows)) throw new PriceSourceError("kraken", "unavailable", "no candles");
      const today = Math.floor(now().getTime() / DAY_MS) * DAY_MS;
      const fromDay = from.toISOString().slice(0, 10);
      return rows
        .flatMap((row): DailyClose[] => {
          if (!Array.isArray(row)) return [];
          const openedAt = Number(row[0]) * 1000;
          const close = Number(row[4]);
          if (!Number.isFinite(openedAt) || !Number.isFinite(close) || openedAt >= today) return [];
          return [{ day: new Date(openedAt).toISOString().slice(0, 10), close }];
        })
        .filter((close) => close.day >= fromDay);
    },
  };
}
