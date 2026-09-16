import type { Bucket, Pence, PriceFreshness, PriceRange, SeriesPoint } from "@finance-app/shared";
import type { MarketData } from "../market.js";

/** What the provenance line says while Phase 1 runs on fixtures (DESIGN.md §5). */
export const STUB_SOURCE = "Sample prices · stub data";

/** How many points each range draws, and how far apart they sit. */
const SHAPE: Record<PriceRange, { points: number; stepMs: number }> = {
  day: { points: 24, stepMs: 60 * 60 * 1000 },
  month: { points: 30, stepMs: 24 * 60 * 60 * 1000 },
  year: { points: 52, stepMs: 7 * 24 * 60 * 60 * 1000 },
  all: { points: 36, stepMs: 30 * 24 * 60 * 60 * 1000 },
};

export interface StubStaleness {
  /** Age of the newest price, in hours. Drives green → amber → red. */
  hoursOld?: number;
  /** The last fetch failed outright, which is a red card rather than amber. */
  failed?: boolean;
  /** Markets shut. A Friday close isn't stale, it's Friday. */
  marketsClosed?: boolean;
}

export interface StubMarketDataOptions {
  /** Fixed clock, so tests and fixtures are reproducible. */
  now?: () => Date;
  /**
   * Per-pot overrides, so the staleness ladder can be exercised end to end
   * without a real feed ever having to fail.
   */
  staleness?: Partial<Record<Bucket, StubStaleness>>;
}

/**
 * Deterministic fake prices: the same instrument always produces the same
 * series, so screenshots, tests and fixtures agree with each other. No network,
 * no filesystem, no database (CLAUDE.md hard line 7).
 */
export function createStubMarketData(options: StubMarketDataOptions = {}): MarketData {
  const now = options.now ?? (() => new Date());

  return {
    source: STUB_SOURCE,

    async getPrice(instrumentId) {
      const series = await this.getSeries(instrumentId, "day");
      return series[series.length - 1]!.value;
    },

    async getSeries(instrumentId, range) {
      return buildSeries(instrumentId, range, now());
    },

    async getFreshness(bucket) {
      const override = options.staleness?.[bucket] ?? {};
      const asOf = new Date(now().getTime() - (override.hoursOld ?? 0) * 60 * 60 * 1000);

      return {
        source: STUB_SOURCE,
        asOf: asOf.toISOString(),
        failed: override.failed ?? false,
        marketsClosed: override.marketsClosed ?? false,
      } satisfies PriceFreshness;
    },
  };
}

export function buildSeries(instrumentId: string, range: PriceRange, now: Date): SeriesPoint[] {
  const { points, stepMs } = SHAPE[range];
  let state = seedFrom(instrumentId);

  // The starting price is seeded too, so a holding worth £4 never renders as
  // one worth £40,000 just because the range changed.
  const base = 50_00 + (state % 450_00);

  const values: Pence[] = [];
  let value = base;
  for (let i = 0; i < points; i++) {
    state = nextState(state);
    // A drift of ±2.5% per step: enough to look alive, never enough to look
    // like a crash.
    const drift = ((state % 5001) - 2500) / 100_000;
    value = Math.max(1, Math.round(value * (1 + drift)));
    values.push(value);
  }

  const oldest = now.getTime() - (points - 1) * stepMs;
  return values.map((point, index) => ({
    at: new Date(oldest + index * stepMs).toISOString(),
    value: point,
  }));
}

/** Small deterministic PRNG — reproducibility matters more than randomness here. */
function seedFrom(id: string): number {
  let seed = 7;
  for (let i = 0; i < id.length; i++) {
    seed = (seed * 31 + id.charCodeAt(i)) % 2_147_483_647;
  }
  return seed || 7;
}

function nextState(state: number): number {
  return (state * 48_271) % 2_147_483_647;
}
