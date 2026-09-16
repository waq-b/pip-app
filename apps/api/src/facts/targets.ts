import type { AssetType, FactsAdapter, FactsTarget, HoldingNewsAdapter, Region } from "./types.js";

/**
 * From an instrument row to what the facts layer needs: where it trades, what
 * kind of thing it is, and the words that mean a headline is about it.
 */

const EU_SUFFIXES = new Set(["a", "d", "p", "s", "m", "e"]);
const EU_COUNTRIES = new Set(["BE", "AT", "PT"]);

export function regionFor(instrumentId: string, type: string): Region {
  if (type === "CRYPTO" || instrumentId.startsWith("kraken:")) return "global";
  const country = /_([A-Z]{2})_EQ$/.exec(instrumentId);
  if (country) {
    if (country[1] === "US") return "US";
    return EU_COUNTRIES.has(country[1]!) ? "EU" : "other";
  }
  const suffix = /[A-Z0-9.]([a-z])_EQ$/.exec(instrumentId);
  if (suffix?.[1] === "l") return "UK";
  if (suffix && EU_SUFFIXES.has(suffix[1]!)) return "EU";
  return "other";
}

export function assetFor(type: string): AssetType {
  if (type === "CRYPTO") return "crypto";
  if (type === "ETF") return "etf";
  return "equity";
}

/** Legal and share-class words that never appear in a headline about the company. */
const NAME_NOISE =
  /\b(inc|incorporated|corp|corporation|plc|ltd|limited|n\.?v\.?|s\.?a\.?|se|ag|holdings?|group|co|company|class [a-z]|adr|ord|ordinary shares?)\b\.?/gi;

/**
 * Names are matched case-insensitively as whole words ("Greggs", "ASML",
 * "Vanguard FTSE All-World"); tickers only in capitals and only when three
 * letters or more, so "RR" or "ON" don't match every headline.
 */
export function aliasesFor(name: string, shortName: string): FactsTarget["aliases"] {
  const cleaned = name
    .replace(/\([^)]*\)/g, " ")
    .replace(NAME_NOISE, " ")
    .replace(/[,]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const ticker = shortName.trim().toUpperCase();
  return {
    names: cleaned.length >= 3 ? [cleaned] : [],
    tickers: /^[A-Z]{3,}$/.test(ticker) ? [ticker] : [],
  };
}

export function factsTarget(row: {
  id: string;
  name: string;
  shortName: string;
  type: string;
}): FactsTarget {
  return {
    instrumentId: row.id,
    name: row.name,
    shortName: row.shortName.toUpperCase(),
    region: regionFor(row.id, row.type),
    asset: assetFor(row.type),
    aliases: aliasesFor(row.name, row.shortName),
  };
}

const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Is this headline (and snippet) about the holding? Deterministic, no guessing. */
export function mentions(target: FactsTarget, text: string): boolean {
  const byName = target.aliases.names.some((name) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escape(name)}($|[^\\p{L}\\p{N}])`, "iu").test(text),
  );
  const byTicker = target.aliases.tickers.some((ticker) =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escape(ticker)}($|[^\\p{L}\\p{N}])`, "u").test(text),
  );
  return byName || byTicker;
}

/** The holding adapters whose declared coverage includes this holding. */
export function adaptersFor(target: FactsTarget, adapters: FactsAdapter[]): HoldingNewsAdapter[] {
  return adapters.filter(
    (adapter): adapter is HoldingNewsAdapter =>
      adapter.scope === "holding" &&
      adapter.coverage.regions.includes(target.region) &&
      adapter.coverage.assets.includes(target.asset) &&
      (adapter.covers?.(target) ?? true),
  );
}
