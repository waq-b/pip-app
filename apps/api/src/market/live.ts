import type { Db } from "../db/user-scope.js";
import { withBudget } from "./budget.js";
import { symbolsFor, type PricedInstrument } from "./refresh.js";
import { createAlphaVantageSource } from "./sources/alpha-vantage.js";
import type { PriceTarget } from "./sources/types.js";
import { withFallback } from "./sources/fallback.js";
import { createYahooSource } from "./sources/yahoo.js";

/**
 * The real market: Yahoo first, Alpha Vantage second, both on daily budgets
 * counted in Postgres. Returns a factory because each instrument has its own
 * symbol per source. Without `AV_ACCESS_KEY` there's simply no fallback.
 */
export function liveMarket(
  db: Db,
  options: { alphaVantageKey?: string; fetch?: typeof fetch } = {},
) {
  const yahoo = withBudget(createYahooSource({ fetch: options.fetch }), db);
  const alphaVantage = options.alphaVantageKey
    ? withBudget(
        createAlphaVantageSource({ apiKey: options.alphaVantageKey, fetch: options.fetch }),
        db,
      )
    : null;

  return (instrument: PricedInstrument | null) => {
    const symbols = instrument ? symbolsFor(instrument) : null;
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
