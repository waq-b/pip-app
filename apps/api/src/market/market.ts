import type { Bucket, Pence, PriceFreshness, PriceRange, SeriesPoint } from "@finance-app/shared";

/**
 * Market data providers answer "what is it worth, and what has it done?"
 *. They are deliberately separate from trading providers, which
 * only ever answer "what is held, and how much cash?".
 *
 * Every price and every chart in the app comes from here. Nothing reads prices
 * from a trading API — that is design rule 7, and keeping the two layers apart is
 * how it stays true.
 */
export interface MarketData {
  /**
   * Named in the provenance line on every screen showing a live figure, so it
   * has to be something a person would recognise.
   */
  readonly source: string;

  /** The latest price for one instrument. */
  getPrice(instrumentId: string): Promise<Pence>;

  /** Historical series for a chart, oldest point first. */
  getSeries(instrumentId: string, range: PriceRange): Promise<SeriesPoint[]>;

  /**
   * How current this pot's prices are. Per pot rather than global because the
   * staleness ladder names the affected pot ("Side Bet is 2 hours old"), and
   * because pots will be fed by different sources from Phase 3 onwards.
   */
  getFreshness(bucket: Bucket): Promise<PriceFreshness>;
}
