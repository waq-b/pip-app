import type { NudgeCadence, NudgeResponse } from "@finance-app/shared";
import { and, desc, eq, gte, sql } from "drizzle-orm";
import { digests, nudges } from "../db/schema.js";
import { asUser, type Db } from "../db/user-scope.js";
import type { ReadUser } from "../read/model.js";
import type { TrustCheck } from "../rules/trust.js";
import type { NudgeHistory } from "./candidates.js";

/**
 * The nudge log (Phase 5 decision 10): every nudge Pip built, shown or held
 * back, with what it was built from. Reads run as the user (RLS); writes go
 * through the privileged connection after the guard or the job has decided
 * whose they are.
 */

export type NewNudge = Omit<
  StoredNudge,
  "id" | "userId" | "digestId" | "createdAt" | "response" | "respondedAt"
>;

export interface StoredNudge {
  id: string;
  userId: string;
  digestId: string | null;
  cadence: NudgeCadence;
  kind: string;
  reason: string;
  bucket: string | null;
  instrumentId: string | null;
  title: string;
  body: string;
  basis: string | null;
  facts: Record<string, unknown>;
  checks: TrustCheck[];
  shown: boolean;
  model: string;
  promptVersion: string | null;
  personalised: boolean;
  dedupeKey: string;
  builtOn: string;
  createdAt: Date;
  response: NudgeResponse | null;
  respondedAt: Date | null;
  priceAt: string | null;
  priceCurrency: string | null;
  priceSource: string | null;
  potShareAt: string | null;
  /** Past the urgent line: pushed straight away rather than waiting (Phase 6). */
  urgent: boolean;
  /** Pip's take on a `recommendation` nudge, and the trigger behind it (Phase 6). */
  recommendation?: string | null;
  trigger?: string | null;
}

export interface WeekRecord {
  weekOf: string;
  opening: string;
  counts: Record<string, unknown>;
  builtAt: Date;
}

export interface StoredWeek extends WeekRecord {
  id: string;
  nudges: StoredNudge[];
}

export interface NudgeStore {
  history(user: ReadUser, today: string, monday: string): Promise<NudgeHistory>;
  weekExists(user: ReadUser, weekOf: string): Promise<boolean>;
  /** False when that week was already built — the first build stands. */
  saveWeek(user: ReadUser, week: WeekRecord, rows: NewNudge[]): Promise<boolean>;
  /**
   * Rows already logged today (same key) are skipped. Returns how many were
   * new. `now` is when the build ran: the log says when a note was written,
   * which is what the trust rules judge its facts' age against on a re-read.
   */
  saveDaily(user: ReadUser, rows: NewNudge[], now: Date): Promise<number>;
  week(user: ReadUser, weekOf: string | "latest"): Promise<StoredWeek | null>;
  /** Mondays, newest first. */
  weeks(user: ReadUser): Promise<string[]>;
  daily(user: ReadUser, day: string): Promise<StoredNudge[]>;
  /**
   * Adds a check to a daily nudge already logged, so the log says why it
   * wasn't pushed. Server-side only.
   */
  addCheck(user: ReadUser, dedupeKey: string, builtOn: string, check: TrustCheck): Promise<void>;
  /** Null when there's no such nudge of theirs. */
  respond(
    user: ReadUser,
    id: string,
    response: NudgeResponse,
    at: Date,
  ): Promise<StoredNudge | null>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fromRow(row: typeof nudges.$inferSelect): StoredNudge {
  return {
    ...row,
    cadence: row.cadence as NudgeCadence,
    facts: row.facts as Record<string, unknown>,
    checks: row.checks as TrustCheck[],
    response: row.response as NudgeResponse | null,
  };
}

function historyFrom(rows: StoredNudge[], today: string, monday: string): NudgeHistory {
  // A recommendation is one per crossing, not one of the day's notes: it
  // doesn't use up the daily budget.
  const shownDaily = rows.filter(
    (n) => n.shown && n.cadence === "daily" && n.kind !== "recommendation",
  );
  const caps = rows.filter((n) => n.shown && n.reason === "cap").map((n) => n.createdAt.getTime());
  return {
    dailyShownToday: shownDaily.filter((n) => n.builtOn === today).length,
    dailyShownThisWeek: shownDaily.filter((n) => n.builtOn >= monday).length,
    lastCapNudgeAt: caps.length ? new Date(Math.max(...caps)) : null,
    shownKeys: [...new Set(shownDaily.map((n) => n.dedupeKey))],
  };
}

export function dbNudgeStore(db: Db): NudgeStore {
  const recentOf = (user: ReadUser, since: string) =>
    asUser(db, user.authUserId, (tx) => tx.select().from(nudges).where(gte(nudges.builtOn, since)));

  async function nudgesOf(user: ReadUser, digestId: string) {
    const rows = await asUser(db, user.authUserId, (tx) =>
      tx.select().from(nudges).where(eq(nudges.digestId, digestId)).orderBy(nudges.createdAt),
    );
    return rows.map(fromRow);
  }

  return {
    async history(user, today, monday) {
      // A daily nudge's repeat window is at most a week; a month covers every key.
      const since = new Date(Date.parse(`${today}T00:00:00Z`) - 31 * 86_400_000)
        .toISOString()
        .slice(0, 10);
      return historyFrom((await recentOf(user, since)).map(fromRow), today, monday);
    },

    async weekExists(user, weekOf) {
      const rows = await asUser(db, user.authUserId, (tx) =>
        tx.select({ id: digests.id }).from(digests).where(eq(digests.weekOf, weekOf)),
      );
      return rows.length > 0;
    },

    async saveWeek(user, week, rows) {
      return db.transaction(async (tx) => {
        const [digest] = await tx
          .insert(digests)
          .values({ userId: user.userId, ...week })
          .onConflictDoNothing()
          .returning({ id: digests.id });
        if (!digest) return false;
        if (rows.length > 0) {
          await tx
            .insert(nudges)
            .values(rows.map((row) => ({ ...row, userId: user.userId, digestId: digest.id })));
        }
        return true;
      });
    },

    async saveDaily(user, rows, now) {
      if (rows.length === 0) return 0;
      const inserted = await db
        .insert(nudges)
        .values(
          rows.map((row) => ({ ...row, userId: user.userId, digestId: null, createdAt: now })),
        )
        .onConflictDoNothing()
        .returning({ id: nudges.id });
      return inserted.length;
    },

    async week(user, weekOf) {
      const [digest] = await asUser(db, user.authUserId, (tx) =>
        weekOf === "latest"
          ? tx.select().from(digests).orderBy(desc(digests.weekOf)).limit(1)
          : tx.select().from(digests).where(eq(digests.weekOf, weekOf)),
      );
      if (!digest) return null;
      return {
        id: digest.id,
        weekOf: digest.weekOf,
        opening: digest.opening,
        counts: digest.counts as Record<string, unknown>,
        builtAt: digest.builtAt,
        nudges: await nudgesOf(user, digest.id),
      };
    },

    async weeks(user) {
      const rows = await asUser(db, user.authUserId, (tx) =>
        tx.select({ weekOf: digests.weekOf }).from(digests).orderBy(desc(digests.weekOf)),
      );
      return rows.map((row) => row.weekOf);
    },

    async daily(user, day) {
      const rows = await asUser(db, user.authUserId, (tx) =>
        tx
          .select()
          .from(nudges)
          .where(and(eq(nudges.cadence, "daily"), eq(nudges.builtOn, day)))
          .orderBy(nudges.createdAt),
      );
      return rows.map(fromRow);
    },

    async addCheck(user, key, builtOn, check) {
      await db
        .update(nudges)
        .set({ checks: sql`${nudges.checks} || ${JSON.stringify([check])}::jsonb` })
        .where(
          and(
            eq(nudges.userId, user.userId),
            eq(nudges.cadence, "daily"),
            eq(nudges.dedupeKey, key),
            eq(nudges.builtOn, builtOn),
          ),
        );
    },

    async respond(user, id, response, at) {
      if (!UUID.test(id)) return null;
      const [row] = await db
        .update(nudges)
        .set({ response, respondedAt: at })
        .where(and(eq(nudges.id, id), eq(nudges.userId, user.userId)))
        .returning();
      return row ? fromRow(row) : null;
    },
  };
}

/** Stub mode: kept in memory for as long as the server runs. */
export function memoryNudgeStore(): NudgeStore & { all: () => StoredNudge[] } {
  const weeks: (StoredWeek & { userId: string })[] = [];
  const daily: StoredNudge[] = [];
  let counter = 0;
  const id = () => {
    counter += 1;
    return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
  };
  const make = (
    user: ReadUser,
    row: NewNudge,
    digestId: string | null,
    createdAt: Date,
  ): StoredNudge => ({
    ...row,
    id: id(),
    userId: user.userId,
    digestId,
    createdAt,
    response: null,
    respondedAt: null,
  });
  const allOf = (user: ReadUser) => [
    ...weeks.filter((w) => w.userId === user.userId).flatMap((w) => w.nudges),
    ...daily.filter((n) => n.userId === user.userId),
  ];

  return {
    all: () => [...weeks.flatMap((w) => w.nudges), ...daily],
    async history(user, today, monday) {
      return historyFrom(allOf(user), today, monday);
    },
    async weekExists(user, weekOf) {
      return weeks.some((w) => w.userId === user.userId && w.weekOf === weekOf);
    },
    async saveWeek(user, week, rows) {
      if (await this.weekExists(user, week.weekOf)) return false;
      const digestId = id();
      weeks.push({
        ...week,
        id: digestId,
        userId: user.userId,
        nudges: rows.map((r) => make(user, r, digestId, week.builtAt)),
      });
      return true;
    },
    async saveDaily(user, rows, now) {
      let added = 0;
      for (const row of rows) {
        const exists = daily.some(
          (n) =>
            n.userId === user.userId && n.dedupeKey === row.dedupeKey && n.builtOn === row.builtOn,
        );
        if (exists) continue;
        daily.push(make(user, row, null, now));
        added += 1;
      }
      return added;
    },
    async week(user, weekOf) {
      const mine = weeks
        .filter((w) => w.userId === user.userId)
        .sort((a, b) => b.weekOf.localeCompare(a.weekOf));
      return (weekOf === "latest" ? mine[0] : mine.find((w) => w.weekOf === weekOf)) ?? null;
    },
    async weeks(user) {
      return weeks
        .filter((w) => w.userId === user.userId)
        .map((w) => w.weekOf)
        .sort((a, b) => b.localeCompare(a));
    },
    async daily(user, day) {
      return daily.filter((n) => n.userId === user.userId && n.builtOn === day);
    },
    async addCheck(user, key, builtOn, check) {
      const found = allOf(user).find(
        (n) => n.cadence === "daily" && n.dedupeKey === key && n.builtOn === builtOn,
      );
      if (found) found.checks = [...found.checks, check];
    },

    async respond(user, nudgeId, response, at) {
      const found = allOf(user).find((n) => n.id === nudgeId);
      if (!found) return null;
      found.response = response;
      found.respondedAt = at;
      return found;
    },
  };
}
