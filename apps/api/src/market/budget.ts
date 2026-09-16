import { sql } from "drizzle-orm";
import { sourceUsage } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { PriceSourceError, type PriceSource } from "./sources/types.js";

/**
 * Hard daily ceilings per source, counted in Postgres so they survive restarts
 * and apply across every refresh path. Alpha Vantage's free tier is 25/day; a
 * margin is kept. Yahoo publishes no limit, so Pip sets a polite one.
 */
export const DAILY_CALL_LIMITS: Record<PriceSource["id"], number> = {
  yahoo: 1_500,
  "alpha-vantage": 22,
  /** Demo plan: 10k calls a month, so ~300 a day keeps the month safe. */
  coingecko: 300,
  /** Public, keyless; Pip keeps it polite. */
  kraken: 1_000,
};

/** UTC day, so the count resets at a fixed moment. */
function today(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * Wraps a source so each call first takes one unit of today's budget —
 * atomically, so two refreshes can't both spend the last call. Over budget,
 * the call isn't made and the source reports itself blocked, which the
 * fallback and the staleness ladder already handle.
 */
export function withBudget(
  source: PriceSource,
  db: Db,
  options: { limit?: number; now?: () => Date } = {},
): PriceSource {
  const limit = options.limit ?? DAILY_CALL_LIMITS[source.id];
  const now = options.now ?? (() => new Date());

  async function take() {
    const rows = await db
      .insert(sourceUsage)
      .values({ source: source.id, day: today(now()), calls: 1 })
      .onConflictDoUpdate({
        target: [sourceUsage.source, sourceUsage.day],
        set: { calls: sql`${sourceUsage.calls} + 1` },
        setWhere: sql`${sourceUsage.calls} < ${limit}`,
      })
      .returning({ calls: sourceUsage.calls });
    if (rows.length === 0)
      throw new PriceSourceError(source.id, "blocked", "daily call budget used");
  }

  return {
    ...source,
    async quote(target) {
      await take();
      return source.quote(target);
    },
    async dailyCloses(target, from) {
      await take();
      return source.dailyCloses(target, from);
    },
  };
}
