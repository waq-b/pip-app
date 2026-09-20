import { CONNECTION_GAP_HOURS } from "@finance-app/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { connectionGaps, providerCredentials } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";

/**
 * When a connected account goes quiet (phase-6.md decision 4, round 2 Q2).
 * `last_polled_at` is only set by a poll that worked, so an account that
 * hasn't been read for `CONNECTION_GAP_HOURS` has a gap. One row per gap,
 * closed when the account answers again.
 *
 * A gap is a **bell row, never a push**: nothing about the money has changed,
 * only the age of the figure. Recorded by the refresh job after it polls.
 */

export interface GapOutcome {
  opened: number;
  closed: number;
}

export async function recordConnectionGaps(db: Db, now: Date): Promise<GapOutcome> {
  const quietBefore = new Date(now.getTime() - CONNECTION_GAP_HOURS * 3_600_000);
  const credentials = await db
    .select({
      userId: providerCredentials.userId,
      provider: providerCredentials.provider,
      lastPolledAt: providerCredentials.lastPolledAt,
    })
    .from(providerCredentials)
    .where(inArray(providerCredentials.status, ["live", "error"]));

  const open = await db.select().from(connectionGaps).where(isNull(connectionGaps.endedAt));
  const openFor = new Map(open.map((gap) => [`${gap.userId}|${gap.provider}`, gap]));
  const outcome: GapOutcome = { opened: 0, closed: 0 };

  for (const credential of credentials) {
    const key = `${credential.userId}|${credential.provider}`;
    const quiet = credential.lastPolledAt === null || credential.lastPolledAt < quietBefore;
    const already = openFor.get(key);

    if (quiet && !already) {
      // The gap started when the account was last read, not when Pip noticed.
      await db.insert(connectionGaps).values({
        userId: credential.userId,
        provider: credential.provider,
        startedAt: credential.lastPolledAt ?? now,
      });
      outcome.opened += 1;
    }
    if (!quiet && already) {
      await db
        .update(connectionGaps)
        .set({ endedAt: now })
        .where(eq(connectionGaps.id, already.id));
      outcome.closed += 1;
    }
  }
  return outcome;
}

/** A gap for an account that isn't connected any more is closed, not left open. */
export async function closeGapsFor(db: Db, userId: string, provider: string, now: Date) {
  await db
    .update(connectionGaps)
    .set({ endedAt: now })
    .where(
      and(
        eq(connectionGaps.userId, userId),
        eq(connectionGaps.provider, provider),
        isNull(connectionGaps.endedAt),
      ),
    );
}
