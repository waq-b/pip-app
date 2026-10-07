import {
  EMPTY_PROFILE,
  PROFILE_LIMITS,
  type Profile,
  type ProfileError,
} from "@finance-app/shared";
import { eq } from "drizzle-orm";
import { userProfiles } from "../db/schema.js";
import { asUser, type Db } from "../db/user-scope.js";
import type { ReadUser } from "../read/model.js";

/**
 * What a user tells Pip about their plan : goals, horizon,
 * monthly money in, risk in their own words, and things never to nudge on.
 * The nudge writer reads it for personalised users only.
 */

export function parseProfile(
  body: unknown,
): { ok: true; profile: Profile } | { ok: false; error: ProfileError } {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, error: "invalid_body" };
  }
  const input = body as Record<string, unknown>;
  const text = (value: unknown) => (typeof value === "string" ? value.trim() : null);

  const goals = text(input.goals ?? "");
  const riskWords = text(input.riskWords ?? "");
  if (goals === null || riskWords === null) return { ok: false, error: "invalid_body" };
  if (goals.length > PROFILE_LIMITS.textMax) return { ok: false, error: "goals_too_long" };
  if (riskWords.length > PROFILE_LIMITS.textMax) return { ok: false, error: "risk_words_too_long" };

  const horizonYears = input.horizonYears ?? null;
  if (
    horizonYears !== null &&
    (!Number.isInteger(horizonYears) ||
      (horizonYears as number) < PROFILE_LIMITS.horizonYears.min ||
      (horizonYears as number) > PROFILE_LIMITS.horizonYears.max)
  ) {
    return { ok: false, error: "horizon_out_of_range" };
  }

  const monthlyInPence = input.monthlyInPence ?? null;
  if (
    monthlyInPence !== null &&
    (!Number.isSafeInteger(monthlyInPence) || (monthlyInPence as number) < 0)
  ) {
    return { ok: false, error: "monthly_in_invalid" };
  }

  const rawExclusions = input.exclusions ?? [];
  if (!Array.isArray(rawExclusions)) return { ok: false, error: "exclusion_invalid" };
  const exclusions: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawExclusions) {
    const item = text(raw);
    if (item === null || item.length > PROFILE_LIMITS.exclusionMaxLength) {
      return { ok: false, error: "exclusion_invalid" };
    }
    // Blanks are dropped and repeats kept once, ignoring case.
    if (!item || seen.has(item.toLowerCase())) continue;
    seen.add(item.toLowerCase());
    exclusions.push(item);
  }
  if (exclusions.length > PROFILE_LIMITS.exclusionsMax) {
    return { ok: false, error: "too_many_exclusions" };
  }

  return {
    ok: true,
    profile: {
      goals,
      horizonYears: horizonYears as number | null,
      monthlyInPence: monthlyInPence as number | null,
      riskWords,
      exclusions,
    },
  };
}

export interface StoredProfile {
  profile: Profile;
  /** Null until the user first saves. */
  updatedAt: Date | null;
}

export interface ProfileStore {
  get(user: ReadUser): Promise<StoredProfile>;
  /** The profile must already be parsed (`parseProfile`). */
  set(user: ReadUser, profile: Profile, at: Date): Promise<StoredProfile>;
}

function fromRow(row: typeof userProfiles.$inferSelect): StoredProfile {
  return {
    profile: {
      goals: row.goals,
      horizonYears: row.horizonYears,
      monthlyInPence: row.monthlyInPence,
      riskWords: row.riskWords,
      exclusions: row.exclusions,
    },
    updatedAt: row.updatedAt,
  };
}

/** Reads run as the user (RLS); saves go through the privileged connection, like rules. */
export function dbProfileStore(db: Db): ProfileStore {
  return {
    async get(user) {
      const [row] = await asUser(db, user.authUserId, (tx) => tx.select().from(userProfiles));
      return row ? fromRow(row) : { profile: EMPTY_PROFILE, updatedAt: null };
    },
    async set(user, profile, at) {
      const values = { ...profile, updatedAt: at };
      await db
        .insert(userProfiles)
        .values({ userId: user.userId, ...values })
        .onConflictDoUpdate({ target: userProfiles.userId, set: values });
      const [row] = await db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, user.userId));
      return fromRow(row!);
    },
  };
}

/** Stub mode: in memory, per user, for as long as the server runs. */
export function memoryProfileStore(): ProfileStore {
  const saved = new Map<string, StoredProfile>();
  return {
    async get(user) {
      return saved.get(user.userId) ?? { profile: EMPTY_PROFILE, updatedAt: null };
    },
    async set(user, profile, at) {
      const stored = { profile, updatedAt: at };
      saved.set(user.userId, stored);
      return stored;
    },
  };
}
