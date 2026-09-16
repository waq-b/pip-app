import { INSTRUMENT_FIXTURES } from "../../fixtures/portfolio.js";
import { allStubPositions } from "../../providers/stub/index.js";
import { priceFor, type SeriesAnchors } from "./index.js";

/**
 * Where the stub's charts start for each stub holding, worked out from the same
 * figures the screens show beside them: "All" from the average price paid, "Day"
 * from today's change per unit. Without these, a chart captioned "since you
 * bought" could start anywhere and contradict "+24% since you bought".
 *
 * Wiring only — it reads the trading stub's positions but gives the market
 * layer nothing except prices.
 */
export function stubSeriesAnchors(): Record<string, SeriesAnchors> {
  return Object.fromEntries(
    allStubPositions().map(({ position }) => {
      const today = INSTRUMENT_FIXTURES[position.id]?.today.amount ?? 0;
      const openedAt =
        position.quantity > 0
          ? Math.round(priceFor(position.id) - today / position.quantity)
          : undefined;
      return [position.id, { boughtAt: position.averagePrice, openedAt }];
    }),
  );
}
