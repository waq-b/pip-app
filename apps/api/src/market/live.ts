import type { Db } from "../db/user-scope.js";
import { withBudget } from "./budget.js";
import { isCrypto, symbolsFor, type PricedInstrument } from "./refresh.js";
import { createAlphaVantageSource } from "./sources/alpha-vantage.js";
import { createCoinGeckoSource } from "./sources/coingecko.js";
import type { PriceTarget } from "./sources/types.js";
import { withFallback } from "./sources/fallback.js";
import { createKrakenPublicSource } from "./sources/kraken-public.js";
import { createYahooSource } from "./sources/yahoo.js";

/**
 * The real market, on daily budgets counted in Postgres. Stocks and FX: Yahoo
 * first, Alpha Vantage second (none without `AV_ACCESS_KEY`). Crypto: CoinGecko
 * first (none without `COINGECKO_KEY`), Kraken's public prices second.
 * Returns a factory because each instrument has its own symbol per source.
 */
export function liveMarket(
  db: Db,
  options: { alphaVantageKey?: string; coinGeckoKey?: string; fetch?: typeof fetch } = {},
) {
  const yahoo = withBudget(createYahooSource({ fetch: options.fetch }), db);
  const alphaVantage = options.alphaVantageKey
    ? withBudget(
        createAlphaVantageSource({ apiKey: options.alphaVantageKey, fetch: options.fetch }),
        db,
      )
    : null;

  const coinGecko = options.coinGeckoKey
    ? withBudget(createCoinGeckoSource({ apiKey: options.coinGeckoKey, fetch: options.fetch }), db)
    : null;
  const krakenPublic = withBudget(createKrakenPublicSource({ fetch: options.fetch }), db);

  return (instrument: PricedInstrument | null) => {
    const symbols = instrument ? symbolsFor(instrument) : null;
    if (instrument && symbols && isCrypto(instrument)) {
      return withFallback([
        ...(coinGecko ? [{ source: coinGecko, symbolFor: symbols.coingecko }] : []),
        { source: krakenPublic, symbolFor: symbols.kraken },
      ]);
    }
    return withFallback([
      { source: yahoo, symbolFor: symbols ? symbols.yahoo : (target) => target },
      ...(alphaVantage
        ? [
            {
              source: alphaVantage,
              symbolFor: symbols ? symbols.alphaVantage : (target: PriceTarget) => target,
            },
          ]
        : []),
    ]);
  };
}
