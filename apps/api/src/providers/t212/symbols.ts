/**
 * Trading 212 tickers carry the exchange: `NVDA_US_EQ`, `GRGl_EQ` (London),
 * `ASMLa_EQ` (Amsterdam). Market-data sources want their own spelling of the
 * same listing — never the ISIN, which is shared across listings (CLAUDE.md
 * s13). Unknown formats return null and need a manual override.
 */

interface Venue {
  yahoo: string;
  alphaVantage: string | null;
}

/** Lower-case suffix before `_EQ` → exchange. Verified against T212's instrument list. */
const SUFFIX_VENUES: Record<string, Venue> = {
  l: { yahoo: ".L", alphaVantage: ".LON" },
  d: { yahoo: ".DE", alphaVantage: ".DEX" },
  a: { yahoo: ".AS", alphaVantage: ".AMS" },
  p: { yahoo: ".PA", alphaVantage: ".PAR" },
  s: { yahoo: ".SW", alphaVantage: null },
  m: { yahoo: ".MI", alphaVantage: null },
  e: { yahoo: ".MC", alphaVantage: null },
};

/** `_XX_EQ` country codes → exchange. */
const COUNTRY_VENUES: Record<string, Venue> = {
  US: { yahoo: "", alphaVantage: "" },
  CA: { yahoo: ".TO", alphaVantage: ".TRT" },
  BE: { yahoo: ".BR", alphaVantage: null },
  AT: { yahoo: ".VI", alphaVantage: null },
  PT: { yahoo: ".LS", alphaVantage: null },
};

export interface MarketSymbols {
  yahoo: string | null;
  alphaVantage: string | null;
}

export function marketSymbolsFor(ticker: string): MarketSymbols {
  const country = /^([A-Z0-9.]+)_([A-Z]{2})_EQ$/.exec(ticker);
  if (country) {
    const venue = COUNTRY_VENUES[country[2]!];
    if (!venue) return { yahoo: null, alphaVantage: null };
    const base = country[1]!;
    return {
      // Yahoo spells share classes with a dash: BRK.B → BRK-B.
      yahoo: `${base.replace(/\./g, "-")}${venue.yahoo}`,
      alphaVantage: venue.alphaVantage === null ? null : `${base}${venue.alphaVantage}`,
    };
  }

  const suffixed = /^([A-Z0-9.]+?)([a-z])_EQ$/.exec(ticker);
  if (suffixed) {
    const venue = SUFFIX_VENUES[suffixed[2]!];
    if (!venue) return { yahoo: null, alphaVantage: null };
    const base = suffixed[1]!;
    return {
      yahoo: `${base.replace(/\./g, "-")}${venue.yahoo}`,
      alphaVantage: venue.alphaVantage === null ? null : `${base}${venue.alphaVantage}`,
    };
  }

  return { yahoo: null, alphaVantage: null };
}
