import { LIMIT_ALERT_SHARES, LIMIT_REARM_PENCE, type Pence } from "@finance-app/shared";
import { and, desc, eq, isNull } from "drizzle-orm";
import { limitAlerts } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import { londonDay, type Notifier } from "../notify/notify.js";
import type { SideBetInput } from "./engine.js";

/**
 * Side Bet's two alerts (phase-6.md decision 2): one when money in reaches 80%
 * of the limit, one when it reaches the limit itself.
 *
 * Money in, less taken out, only moves when the user moves money, so there's
 * nothing to flicker and no need for the two-run confirmation the old cap
 * needed. An alert fires once and stays quiet until it has clearly cleared —
 * money in back under the threshold by `LIMIT_REARM_PENCE` — after which the
 * same threshold can alert again.
 *
 * The alert is information: it says where the line is. Pip can't stop anyone
 * buying anything (hard line 1).
 */

const THRESHOLDS = LIMIT_ALERT_SHARES.map((share) => Math.round(share * 100) as 80 | 100);

export type LimitAlertOutcome =
  | { threshold: number; action: "alerted"; pushed: boolean }
  | { threshold: number; action: "cleared" };

function words(threshold: number, moneyIn: Pence, limit: Pence, starter: boolean) {
  const pounds = (pence: Pence) => `£${Math.round(pence / 100).toLocaleString("en-GB")}`;
  const line = starter ? "starter limit" : "limit";
  // A real limit is net assets ÷ 10, and a push shows on a lock screen: no
  // pounds that give it away. The flat £350 starter limit gives nothing away.
  if (!starter) {
    return threshold === 100
      ? {
          title: "Side Bet has reached its limit",
          body: "Money in over the last year, less what you've taken out, has reached it. Pip can't stop anything — the figures are in Pip.",
        }
      : {
          title: "Side Bet is near its limit",
          body: "Money in over the last year, less what you've taken out, is past 80% of it. The figures are in Pip.",
        };
  }
  return threshold === 100
    ? {
        title: `Side Bet has reached its ${line}`,
        body: `You've put in ${pounds(moneyIn)} over the last year, against ${pounds(limit)}. Pip can't stop anything — this is just where the line is.`,
      }
    : {
        title: "Side Bet is near its limit",
        body: `${pounds(moneyIn)} of ${pounds(limit)} put in over the last year, less what you've taken out.`,
      };
}

/**
 * Judges both thresholds for one person and records what changed. Pushing is
 * `notify()`'s business — it decides whether this user wants it and sends one
 * push per event.
 */
export async function checkLimitAlerts(
  deps: { db: Db; notifier?: Notifier },
  user: { userId: string },
  sideBet: SideBetInput,
  now: Date,
): Promise<LimitAlertOutcome[]> {
  const outcomes: LimitAlertOutcome[] = [];
  if (sideBet.limitPence <= 0) return outcomes;

  for (const threshold of THRESHOLDS) {
    const at = Math.round((sideBet.limitPence * threshold) / 100);
    const [open] = await deps.db
      .select()
      .from(limitAlerts)
      .where(
        and(
          eq(limitAlerts.userId, user.userId),
          eq(limitAlerts.threshold, threshold),
          isNull(limitAlerts.clearedAt),
        ),
      )
      .orderBy(desc(limitAlerts.alertedAt))
      .limit(1);

    if (open) {
      // Clearly back under, so this threshold can speak again later.
      if (sideBet.moneyInPence <= at - LIMIT_REARM_PENCE) {
        await deps.db
          .update(limitAlerts)
          .set({ clearedAt: now })
          .where(eq(limitAlerts.id, open.id));
        outcomes.push({ threshold, action: "cleared" });
      }
      continue;
    }

    if (sideBet.moneyInPence < at) continue;

    const windowStart = londonDay(now);
    const [row] = await deps.db
      .insert(limitAlerts)
      .values({
        userId: user.userId,
        threshold,
        windowStart,
        moneyInPence: sideBet.moneyInPence,
        limitPence: sideBet.limitPence,
        starterLimit: sideBet.starterLimit,
        alertedAt: now,
      })
      // Another run beat us to it: that's the one alert for this window.
      .onConflictDoNothing()
      .returning({ id: limitAlerts.id });
    if (!row) continue;

    const message = words(
      threshold,
      sideBet.moneyInPence,
      sideBet.limitPence,
      sideBet.starterLimit,
    );
    const outcome = await deps.notifier?.push(
      {
        userId: user.userId,
        kind: "limit",
        dedupeKey: `limit:${threshold}:${windowStart}`,
        message: { ...message, url: "/rules" },
      },
      now,
    );
    outcomes.push({ threshold, action: "alerted", pushed: outcome?.sent === true });
  }

  return outcomes;
}
