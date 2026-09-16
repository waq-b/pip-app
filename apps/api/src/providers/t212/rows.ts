import type { T212AccountSummary, T212Fill, T212Instrument, T212Position } from "./client.js";
import { marketSymbolsFor } from "./symbols.js";

/**
 * Trading 212 responses → the rows Pip stores. Facts about what is held and
 * what was paid only: `currentPrice` and `walletImpact.currentValue` are
 * deliberately dropped, because values come from market data (hard line 8).
 */

export class NotInPoundsError extends Error {
  constructor(readonly currency: string) {
    super(`Pip only works in pounds for now; this account is in ${currency}`);
    this.name = "NotInPoundsError";
  }
}

/** Pounds (as T212 sends them) to integer pence. */
export function toPence(pounds: number): number {
  return Math.round(pounds * 100);
}

/** Full precision as a string, so `numeric` columns keep every digit T212 sent. */
function exact(value: number): string {
  return String(value);
}

export function assertPounds(currency: string): void {
  if (currency !== "GBP") throw new NotInPoundsError(currency);
}

export function holdingRows(
  positions: T212Position[],
  context: { credentialId: string; userId: string; polledAt: Date },
) {
  return positions.map((position) => {
    assertPounds(position.walletImpact.currency);
    return {
      credentialId: context.credentialId,
      userId: context.userId,
      instrumentId: position.instrument.ticker,
      quantity: exact(position.quantity),
      averagePricePaid: exact(position.averagePricePaid),
      totalCostPence: toPence(position.walletImpact.totalCost),
      polledAt: context.polledAt,
    };
  });
}

export function cashRow(
  summary: T212AccountSummary,
  context: { credentialId: string; userId: string; polledAt: Date },
) {
  assertPounds(summary.currency);
  return {
    credentialId: context.credentialId,
    userId: context.userId,
    availablePence: toPence(summary.cash.availableToTrade),
    reservedPence: toPence(summary.cash.reservedForOrders),
    inPiesPence: toPence(summary.cash.inPies),
    polledAt: context.polledAt,
  };
}

export function instrumentRow(instrument: T212Instrument) {
  const symbols = marketSymbolsFor(instrument.ticker);
  return {
    id: instrument.ticker,
    isin: instrument.isin,
    name: instrument.name,
    shortName: instrument.shortName,
    currency: instrument.currencyCode,
    type: instrument.type,
    workingScheduleId: instrument.workingScheduleId,
    yahooSymbol: symbols.yahoo,
    alphaVantageSymbol: symbols.alphaVantage,
  };
}

export function tradeRows(fills: T212Fill[], context: { credentialId: string; userId: string }) {
  return fills.map((fill) => {
    assertPounds(fill.walletCurrency);
    return {
      credentialId: context.credentialId,
      userId: context.userId,
      fillId: fill.fillId,
      instrumentId: fill.ticker,
      side: fill.side,
      quantity: exact(fill.quantity),
      price: exact(fill.price),
      netValuePence: toPence(fill.netValue),
      feesPence: toPence(fill.fees),
      filledAt: new Date(fill.filledAt),
    };
  });
}
