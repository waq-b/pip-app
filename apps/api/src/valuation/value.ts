import type { Bucket } from "@finance-app/shared";

/**
 * Turning what's held into pounds. Prices come from market data, never from a
 * trading API (hard line 8). Everything leaves here as integer pence.
 */

export interface PriceRow {
  price: string;
  previousClose: string | null;
  currency: string;
}

export class MissingPriceError extends Error {
  constructor(readonly key: string) {
    super(`No price for ${key}`);
    this.name = "MissingPriceError";
  }
}

/**
 * Pounds per one unit of the listing's currency. GBP is 1, pence 1/100, and
 * USD or EUR divide by the GBP→quote rate (units of that currency per pound).
 */
export function poundsPerUnit(currency: string, fxRates: Map<string, number>): number {
  if (currency === "GBP") return 1;
  if (currency === "GBX") return 0.01;
  const rate = fxRates.get(currency);
  if (!rate) throw new MissingPriceError(`FX:GBP${currency}`);
  return 1 / rate;
}

/** A quantity at a price in the listing's currency, as pence of pounds. */
export function toPencePounds(
  quantity: number,
  price: number,
  currency: string,
  fxRates: Map<string, number>,
): number {
  return Math.round(quantity * price * poundsPerUnit(currency, fxRates) * 100);
}

/** T212 account kind → pot. Money never crosses pots (hard line 11). */
export function bucketForAccountKind(accountKind: string): Bucket {
  if (accountKind === "isa") return "Base";
  if (accountKind === "invest") return "Medium";
  throw new Error(`Unknown account kind ${accountKind}`);
}
