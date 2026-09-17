import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { dailyCloses, dailyValues, nudges } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { poundsPerUnit } from "../valuation/value.js";

/**
 * Outcomes (Phase 5 task 8): what happened after a nudge — a holding's price
 * 7 and 30 days on, a pot's share for shape nudges — filled in from cached
 * closes, never a new call, never an LLM. Nothing reads them on screen yet;
 * they're for learning, months on, which kinds of nudge earned trust.
 *
 * Prices are pence of pounds per unit, the same basis as `price_at` (the
 * screen's price when the nudge was built): the close on or before the day,
 * converted at that day's FX close. A pot's share is its invested value over
 * every pot's on that day (`daily_values` — investments only, so it can differ
 * a little from the share at build time, which counted cash).
 */

const DAY_MS = 86_400_000;
export const OUTCOME_DAYS = [7, 30] as const;
/** Don't reach further back than this for "the close on or before". */
const CLOSE_LOOKBACK_DAYS = 5;
/** Closes that still aren't there this long after they were due never will be. */
export const GIVE_UP_AFTER_DAYS = 14;

const addDays = (day: string, days: number) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

async function closeOnOrBefore(db: Db, key: string, day: string) {
  const [row] = await db
    .select()
    .from(dailyCloses)
    .where(and(eq(dailyCloses.key, key), lte(dailyCloses.day, day)))
    .orderBy(desc(dailyCloses.day))
    .limit(1);
  if (!row || row.day < addDays(day, -CLOSE_LOOKBACK_DAYS)) return null;
  return row;
}

/** Pence of pounds per unit on `day`, or null when the closes aren't cached. */
export async function pencePerUnitOn(
  db: Db,
  instrumentId: string,
  day: string,
): Promise<number | null> {
  const close = await closeOnOrBefore(db, instrumentId, day);
  if (!close) return null;
  const fx = new Map<string, number>();
  if (close.currency !== "GBP" && close.currency !== "GBX") {
    const rate = await closeOnOrBefore(db, `FX:GBP${close.currency}`, day);
    if (!rate) return null;
    fx.set(close.currency, Number(rate.close));
  }
  return (
    Math.round(Number(close.close) * poundsPerUnit(close.currency, fx) * 100 * 10_000) / 10_000
  );
}

async function potShareOn(
  db: Db,
  userId: string,
  bucket: string,
  day: string,
): Promise<number | null> {
  const rows = await db
    .select()
    .from(dailyValues)
    .where(and(eq(dailyValues.userId, userId), eq(dailyValues.day, day)));
  const total = rows.reduce((sum, row) => sum + row.valuePence, 0);
  const pot = rows.find((row) => row.bucket === bucket);
  if (!pot || total === 0) return null;
  return Math.round((pot.valuePence * 10_000) / total) / 100;
}

export interface OutcomeSummary {
  filled: number;
  /** Due, but the closes or values weren't there yet — tried again next run. */
  waiting: number;
  /** Given up on: nothing to measure after `GIVE_UP_AFTER_DAYS`. */
  givenUp: number;
}

export async function fillOutcomes(db: Db, now: Date): Promise<OutcomeSummary> {
  const summary: OutcomeSummary = { filled: 0, waiting: 0, givenUp: 0 };
  for (const days of OUTCOME_DAYS) {
    // `price_7d_at` / `price_30d_at` mark a nudge's outcome as done, whatever kind it is.
    const doneColumn = days === 7 ? nudges.price7dAt : nudges.price30dAt;
    const cutoff = new Date(now.getTime() - days * DAY_MS);
    const due = await db
      .select()
      .from(nudges)
      .where(and(isNull(doneColumn), lte(nudges.createdAt, cutoff)));

    const markDone = (id: string) =>
      db
        .update(nudges)
        .set(days === 7 ? { price7dAt: now } : { price30dAt: now })
        .where(eq(nudges.id, id));
    const wait = async (nudge: (typeof due)[number]) => {
      if (now.getTime() - nudge.createdAt.getTime() > (days + GIVE_UP_AFTER_DAYS) * DAY_MS) {
        await markDone(nudge.id);
        summary.givenUp += 1;
      } else summary.waiting += 1;
    };

    for (const nudge of due) {
      const day = addDays(nudge.builtOn, days);
      if (nudge.instrumentId) {
        const price = await pencePerUnitOn(db, nudge.instrumentId, day);
        if (price === null) {
          await wait(nudge);
          continue;
        }
        await db
          .update(nudges)
          .set(
            days === 7
              ? { price7d: String(price), price7dAt: now }
              : { price30d: String(price), price30dAt: now },
          )
          .where(eq(nudges.id, nudge.id));
        summary.filled += 1;
      } else if (nudge.kind === "shape" && nudge.bucket) {
        const share = await potShareOn(db, nudge.userId, nudge.bucket, day);
        if (share === null) {
          await wait(nudge);
          continue;
        }
        await db
          .update(nudges)
          .set(
            days === 7
              ? { potShare7d: String(share), price7dAt: now }
              : { potShare30d: String(share), price30dAt: now },
          )
          .where(eq(nudges.id, nudge.id));
        summary.filled += 1;
      } else {
        // The ISA year end and quiet weeks have nothing to measure.
        await markDone(nudge.id);
      }
    }
  }
  return summary;
}
