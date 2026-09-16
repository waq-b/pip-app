import type { Bucket, Pence, PriceFreshness, PriceRange, SeriesPoint } from "@finance-app/shared";
import type { MarketData } from "../market.js";

/** What the provenance line says while Phase 1 runs on fixtures (DESIGN.md §5). */
export const STUB_SOURCE = "Sample prices · stub data";

/**
 * Current prices, in pence. These live here rather than with the holdings
 * because prices are the market layer's job — the trading layer only knows what
 * is held and what it is worth (CLAUDE.md hard line 8). Phase 2 replaces this
 * table with a real source behind the same interface.
 */
const PRICES: Record<string, Pence> = {
  "vanguard-ftse-global-all-cap": 218,
  "vanguard-sp-500": 9_430,
  "cash-waiting": 100,
  nvidia: 14_280,
  apple: 18_340,
  asml: 61_200,
  greggs: 2_460,
  "rolls-royce": 594,
  bitcoin: 4_890_000,
  ethereum: 214_000,
  solana: 11_820,
};

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
  /**
   * Where a holding's charts must start, so an invented shape still agrees
   * with the figures beside it: "All" starts at the price you paid, "Day" at
   * this morning's price. The stub has no history of its own to get these from.
   */
  anchors?: Record<string, SeriesAnchors>;
}

export interface SeriesAnchors {
  /** Average price paid — where the "All" range starts. */
  boughtAt?: Pence;
  /** Price at the start of today — where the "Day" range starts. */
  openedAt?: Pence;
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
      return priceFor(instrumentId);
    },

    async getSeries(instrumentId, range) {
      const anchor = options.anchors?.[instrumentId];
      const startAt =
        range === "all" ? anchor?.boughtAt : range === "day" ? anchor?.openedAt : undefined;
      return buildSeries(instrumentId, range, now(), startAt);
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

/** A known instrument gets its real fixture price; anything else gets a seeded one. */
export function priceFor(instrumentId: string): Pence {
  const known = PRICES[instrumentId];
  if (known !== undefined) return known;
  return 50_00 + (seedFrom(instrumentId) % 450_00);
}

export function buildSeries(
  instrumentId: string,
  range: PriceRange,
  now: Date,
  startAt?: Pence,
): SeriesPoint[] {
  const { points, stepMs } = SHAPE[range];
  let state = seedFrom(instrumentId);

  const values: number[] = [];
  let value = 1_000;
  for (let i = 0; i < points; i++) {
    state = nextState(state);
    // A drift of ±2.5% per step: enough to look alive, never enough to look
    // like a crash.
    const drift = ((state % 5001) - 2500) / 100_000;
    value = Math.max(1, value * (1 + drift));
    values.push(value);
  }

  // Anchor the walk so it ends at the instrument's actual price — and, when
  // given, starts where it really started. The shape is invented; the ends are
  // not. The scale blends from one anchor to the other along the walk.
  const endScale = priceFor(instrumentId) / values[values.length - 1]!;
  const startScale = startAt === undefined ? endScale : startAt / values[0]!;

  const oldest = now.getTime() - (points - 1) * stepMs;
  return values.map((point, index) => {
    const along = index / (points - 1);
    const scale = startScale + (endScale - startScale) * along;
    return {
      at: new Date(oldest + index * stepMs).toISOString(),
      value: Math.max(1, Math.round(point * scale)),
    };
  });
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
