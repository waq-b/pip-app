import { eq } from "drizzle-orm";
import type { RecommendationState, RecommendationTrigger } from "@finance-app/shared";
import { recommendationState } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import type { TriggerStateStore } from "./triggers.js";

/**
 * Where each trigger stands, per person and subject — the calmer rule's
 * memory. Server-side only: the job writes it, nobody signed in reads it.
 */
export function dbTriggerStateStore(db: Db): TriggerStateStore {
  return {
    async load(userId) {
      const rows = await db
        .select()
        .from(recommendationState)
        .where(eq(recommendationState.userId, userId));
      return rows.map((row) => ({
        trigger: row.trigger as RecommendationTrigger,
        subject: row.subject,
        state: row.state as RecommendationState,
        eventId: row.eventId,
        since: row.since,
      }));
    },

    async save(userId, state, now) {
      await db
        .insert(recommendationState)
        .values({ userId, ...state, lastCheckedAt: now })
        .onConflictDoUpdate({
          target: [
            recommendationState.userId,
            recommendationState.trigger,
            recommendationState.subject,
          ],
          set: {
            state: state.state,
            eventId: state.eventId,
            since: state.since,
            lastCheckedAt: now,
          },
        });
    },
  };
}
