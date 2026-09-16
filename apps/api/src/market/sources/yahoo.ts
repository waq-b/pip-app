import {
  normaliseCurrency,
  PriceSourceError,
  type PriceSource,
  type PriceTarget,
} from "./types.js";

/**
 * Yahoo Finance's chart endpoint — unofficial, keyless, and against Yahoo's
 * terms for automated use (Waqar's call for Phase 2; re-decided before anyone
 * else uses Pip). Treated as fragile: every response is checked, a 429 is
 * "blocked", and callers fall back to Alpha Vantage.
 */
const BASE = "https://query1.finance.yahoo.com/v8/finance/chart/";

export function createYahooSource(options: { fetch?: typeof fetch } = {}): PriceSource {
  const doFetch = options.fetch ?? fetch;

  async function chart(target: PriceTarget, query: string) {
    const symbol = target.kind === "fx" ? `GBP${target.quote}=X` : target.symbol;
    let response: Response;
    try {
      response = await doFetch(`${BASE}${encodeURIComponent(symbol)}?${query}`, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; Pip/0.2)", Accept: "application/json" },
      });
    } catch {
      throw new PriceSourceError("yahoo", "unavailable", "unreachable");
    }
    if (response.status === 429) throw new PriceSourceError("yahoo", "blocked", "429");
    let body: YahooChart;
    try {
      body = (await response.json()) as YahooChart;
    } catch {
      throw new PriceSourceError("yahoo", "unavailable", `${response.status} not JSON`);
    }
    const result = body.chart?.result?.[0];
    if (
      response.status === 404 ||
      body.chart?.error?.code === "Not Found" ||
      (response.ok && !result)
    ) {
      throw new PriceSourceError("yahoo", "not_found", symbol);
    }
    if (!response.ok || !result?.meta) {
      throw new PriceSourceError("yahoo", "unavailable", String(response.status));
    }
    return result;
  }

  return {
    id: "yahoo",
    label: "Yahoo Finance",

    async quote(target) {
      const result = await chart(target, "range=1d&interval=5m");
      const { meta } = result;
      if (
        typeof meta.regularMarketPrice !== "number" ||
        typeof meta.regularMarketTime !== "number"
      ) {
        throw new PriceSourceError("yahoo", "unavailable", "no price in response");
      }
      const closes = result.indicators?.quote?.[0]?.close ?? [];
      const intraday = (result.timestamp ?? []).flatMap((time, index) => {
        const price = closes[index];
        return typeof price === "number" ? [{ at: new Date(time * 1000), price }] : [];
      });
      return {
        price: meta.regularMarketPrice,
        previousClose:
          typeof meta.chartPreviousClose === "number"
            ? meta.chartPreviousClose
            : typeof meta.previousClose === "number"
              ? meta.previousClose
              : null,
        currency: target.kind === "fx" ? target.quote : normaliseCurrency(meta.currency ?? ""),
        asOf: new Date(meta.regularMarketTime * 1000),
        intraday,
      };
    },

    async dailyCloses(target, from) {
      const period1 = Math.floor(from.getTime() / 1000);
      const period2 = Math.floor(Date.now() / 1000);
      const result = await chart(target, `period1=${period1}&period2=${period2}&interval=1d`);
      const zone = result.meta.exchangeTimezoneName ?? "UTC";
      const closes = result.indicators?.quote?.[0]?.close ?? [];
      const byDay = new Map<string, number>();
      (result.timestamp ?? []).forEach((time, index) => {
        const close = closes[index];
        if (typeof close === "number") byDay.set(dayIn(zone, time), close);
      });
      return [...byDay]
        .map(([day, close]) => ({ day, close }))
        .sort((a, b) => a.day.localeCompare(b.day));
    },
  };
}

function dayIn(timeZone: string, unixSeconds: number): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(unixSeconds * 1000));
}

interface YahooChart {
  chart?: {
    error?: { code?: string } | null;
    result?: {
      meta: {
        currency?: string;
        regularMarketPrice?: number;
        regularMarketTime?: number;
        chartPreviousClose?: number;
        previousClose?: number;
        exchangeTimezoneName?: string;
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
}
