/**
 * Real market-data sources (Phase 2). Each answers "what is it worth, and what
 * has it done" for one listing or FX pair; the fallback chooses between them.
 * Prices stay in the listing's own currency here — pence and FX conversion
 * happen when a holding is valued.
 */

/** A listing (by that source's symbol) or GBP → another currency. */
export type PriceTarget =
  | {
      kind: "instrument";
      symbol: string;
      /** T212's currency for it, e.g. GBX — some sources don't say. */ currency: string;
    }
  | { kind: "fx"; /** Units of this currency per 1 GBP. */ quote: "USD" | "EUR" };

export interface Quote {
  price: number;
  previousClose: number | null;
  /** Normalised: pence are always `GBX`. For FX, the quote currency. */
  currency: string;
  /** When the source says the price is from. */
  asOf: Date;
  /** Today's points, when the source has them. */
  intraday?: IntradayPoint[];
}

export interface IntradayPoint {
  at: Date;
  price: number;
}

export interface DailyClose {
  /** `YYYY-MM-DD` in the exchange's own time zone. */
  day: string;
  close: number;
}

export interface PriceSource {
  id: "yahoo" | "alpha-vantage";
  /** What the provenance line names. */
  label: string;
  quote(target: PriceTarget): Promise<Quote>;
  /** Oldest first. `from` is a hint; sources may return less history. */
  dailyCloses(target: PriceTarget, from: Date): Promise<DailyClose[]>;
}

export class PriceSourceError extends Error {
  constructor(
    readonly source: PriceSource["id"],
    readonly reason: "not_found" | "blocked" | "unavailable" | "unsupported",
    detail: string,
  ) {
    super(`${source}: ${reason} — ${detail}`);
    this.name = "PriceSourceError";
  }
}

export function targetKey(target: PriceTarget): string {
  return target.kind === "fx" ? `FX:GBP${target.quote}` : target.symbol;
}

/** Sources spell pence differently (Yahoo says `GBp`); Pip always says `GBX`. */
export function normaliseCurrency(currency: string): string {
  return currency === "GBp" || currency === "GBx" ? "GBX" : currency.toUpperCase();
}
