import {
  normaliseCurrency,
  PriceSourceError,
  type PriceSource,
  type PriceTarget,
} from "./types.js";

/**
 * Alpha Vantage free tier — the fallback for daily closes (25 calls/day). No
 * intraday, latest data is the previous trading day, and it never says what
 * currency a listing is in, so the instrument's T212 currency is used
 * (LSE comes back in pence, unmarked). The key never appears in an error.
 */
const BASE = "https://www.alphavantage.co/query";

export function createAlphaVantageSource(options: {
  apiKey: string;
  fetch?: typeof fetch;
}): PriceSource {
  const doFetch = options.fetch ?? fetch;
  if (!options.apiKey) throw new Error("Alpha Vantage needs AV_ACCESS_KEY");

  async function call(params: Record<string, string>): Promise<Record<string, unknown>> {
    const query = new URLSearchParams({ ...params, apikey: options.apiKey });
    let response: Response;
    try {
      response = await doFetch(`${BASE}?${query}`);
    } catch {
      throw new PriceSourceError("alpha-vantage", "unavailable", "unreachable");
    }
    if (!response.ok)
      throw new PriceSourceError("alpha-vantage", "unavailable", String(response.status));
    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      throw new PriceSourceError("alpha-vantage", "unavailable", "not JSON");
    }
    // Rate limits and premium-only features come back as 200 with a message.
    if (typeof body.Information === "string" || typeof body.Note === "string") {
      throw new PriceSourceError("alpha-vantage", "blocked", "rate limit or premium");
    }
    if (typeof body["Error Message"] === "string") {
      throw new PriceSourceError(
        "alpha-vantage",
        "not_found",
        params.symbol ?? params.from_symbol ?? "",
      );
    }
    return body;
  }

  const number = (value: unknown, what: string) => {
    const parsed = typeof value === "string" ? Number(value) : NaN;
    if (!Number.isFinite(parsed))
      throw new PriceSourceError("alpha-vantage", "unavailable", `bad ${what}`);
    return parsed;
  };

  function series(body: Record<string, unknown>, key: string, from: Date) {
    const points = body[key];
    if (typeof points !== "object" || points === null) {
      throw new PriceSourceError("alpha-vantage", "not_found", "no series");
    }
    const fromDay = from.toISOString().slice(0, 10);
    return Object.entries(points as Record<string, Record<string, string>>)
      .filter(([day]) => day >= fromDay)
      .map(([day, values]) => ({ day, close: number(values["4. close"], "close") }))
      .sort((a, b) => a.day.localeCompare(b.day));
  }

  return {
    id: "alpha-vantage",
    label: "Alpha Vantage",

    async quote(target: PriceTarget) {
      if (target.kind === "fx") {
        const body = await call({
          function: "CURRENCY_EXCHANGE_RATE",
          from_currency: "GBP",
          to_currency: target.quote,
        });
        const rate = body["Realtime Currency Exchange Rate"] as Record<string, string> | undefined;
        if (!rate) throw new PriceSourceError("alpha-vantage", "not_found", `GBP${target.quote}`);
        return {
          price: number(rate["5. Exchange Rate"], "rate"),
          previousClose: null,
          currency: target.quote,
          asOf: new Date(`${rate["6. Last Refreshed"]?.replace(" ", "T")}Z`),
        };
      }
      const body = await call({ function: "GLOBAL_QUOTE", symbol: target.symbol });
      const quote = body["Global Quote"] as Record<string, string> | undefined;
      if (!quote || !quote["05. price"])
        throw new PriceSourceError("alpha-vantage", "not_found", target.symbol);
      return {
        price: number(quote["05. price"], "price"),
        previousClose: quote["08. previous close"]
          ? number(quote["08. previous close"], "previous close")
          : null,
        currency: normaliseCurrency(target.currency),
        // The close of the latest trading day; the exact time isn't given.
        asOf: new Date(`${quote["07. latest trading day"]}T21:00:00Z`),
      };
    },

    async dailyCloses(target, from) {
      if (target.kind === "fx") {
        const body = await call({
          function: "FX_DAILY",
          from_symbol: "GBP",
          to_symbol: target.quote,
          outputsize: "compact",
        });
        return series(body, "Time Series FX (Daily)", from);
      }
      // `full` history is premium; compact is the last 100 trading days.
      const body = await call({
        function: "TIME_SERIES_DAILY",
        symbol: target.symbol,
        outputsize: "compact",
      });
      return series(body, "Time Series (Daily)", from);
    },
  };
}
