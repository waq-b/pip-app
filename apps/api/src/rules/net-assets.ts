import { NET_ASSETS_REVIEW_MONTHS, type Pence } from "@finance-app/shared";
import { eq } from "drizzle-orm";
import { netAssets } from "../db/schema.js";
import type { Db } from "../db/user-scope.js";
import type { SecretBox } from "../crypto/secrets.js";
import type { ReadUser } from "../read/model.js";

/**
 * The user's net assets: the one figure Pip has no other way of knowing, and
 * the most sensitive thing it holds. Sealed at rest with the same box as
 * provider keys and opened only in memory, when the limit is worked out
 * (CLAUDE.md hard line 6). It is used for exactly one thing — Side Bet's limit
 * — and never leaves the API except when the user asks to see it.
 */

/** Sanity, not judgement: enough to catch a typo or a joke. */
export const NET_ASSETS_MAX_PENCE = 1_000_000_000_00;

export interface StoredNetAssets {
  /** Null when it has never been set. */
  pence: Pence | null;
  reviewedAt: Date | null;
}

export interface NetAssetsStore {
  /** For a screen: whether it's set and when it was reviewed, never the figure. */
  status(user: ReadUser): Promise<{ set: boolean; reviewedAt: Date | null; dueReview: boolean }>;
  /** The figure itself — only for the reveal route and the limit. */
  read(user: ReadUser): Promise<StoredNetAssets>;
  /** Server-side, for the refresh job working out limits. */
  pence(userId: string): Promise<Pence | null>;
  set(user: ReadUser, pence: Pence, now: Date): Promise<StoredNetAssets>;
}

export function dueReview(reviewedAt: Date | null, now: Date): boolean {
  if (!reviewedAt) return false;
  const due = new Date(reviewedAt);
  due.setUTCMonth(due.getUTCMonth() + NET_ASSETS_REVIEW_MONTHS);
  return now >= due;
}

/** Whole pounds in, pence out. Anything else is refused. */
export function parseNetAssets(
  body: unknown,
): { ok: true; pence: Pence } | { ok: false; error: "invalid_amount" | "amount_out_of_range" } {
  const input = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const pounds = input.pounds;
  if (typeof pounds !== "number" || !Number.isFinite(pounds) || !Number.isInteger(pounds)) {
    return { ok: false, error: "invalid_amount" };
  }
  const pence = pounds * 100;
  if (pounds < 0 || pence > NET_ASSETS_MAX_PENCE)
    return { ok: false, error: "amount_out_of_range" };
  return { ok: true, pence };
}

/** The context binds a sealed figure to its owner, so one can't be pasted over another. */
const contextFor = (userId: string) => `net-assets:${userId}`;

export function dbNetAssetsStore(db: Db, box: SecretBox, keyVersion: number): NetAssetsStore {
  const rowFor = async (userId: string) => {
    const [row] = await db.select().from(netAssets).where(eq(netAssets.userId, userId));
    return row;
  };
  const open = (row: typeof netAssets.$inferSelect, userId: string) =>
    Number(box.open(row.sealedAmount, contextFor(userId)));

  return {
    async status(user) {
      const row = await rowFor(user.userId);
      return {
        set: row !== undefined,
        reviewedAt: row?.reviewedAt ?? null,
        dueReview: dueReview(row?.reviewedAt ?? null, new Date()),
      };
    },

    async read(user) {
      const row = await rowFor(user.userId);
      if (!row) return { pence: null, reviewedAt: null };
      return { pence: open(row, user.userId), reviewedAt: row.reviewedAt };
    },

    async pence(userId) {
      const row = await rowFor(userId);
      return row ? open(row, userId) : null;
    },

    async set(user, pence, now) {
      const sealed = box.seal(String(pence), contextFor(user.userId));
      await db
        .insert(netAssets)
        .values({
          userId: user.userId,
          sealedAmount: sealed,
          masterKeyVersion: keyVersion,
          reviewedAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: netAssets.userId,
          set: {
            sealedAmount: sealed,
            masterKeyVersion: keyVersion,
            reviewedAt: now,
            updatedAt: now,
          },
        });
      return { pence, reviewedAt: now };
    },
  };
}

/** Dev and tests: the same rules, without a database or a master key. */
export function memoryNetAssetsStore(): NetAssetsStore {
  const rows = new Map<string, StoredNetAssets>();
  return {
    async status(user) {
      const row = rows.get(user.userId);
      return {
        set: row !== undefined,
        reviewedAt: row?.reviewedAt ?? null,
        dueReview: dueReview(row?.reviewedAt ?? null, new Date()),
      };
    },
    async read(user) {
      return rows.get(user.userId) ?? { pence: null, reviewedAt: null };
    },
    async pence(userId) {
      return rows.get(userId)?.pence ?? null;
    },
    async set(user, pence, now) {
      const row = { pence, reviewedAt: now };
      rows.set(user.userId, row);
      return row;
    },
  };
}
