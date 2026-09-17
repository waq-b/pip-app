import { DEFAULT_RULES, type RuleSettings } from "@finance-app/shared";
import { eq } from "drizzle-orm";
import { userRules } from "../db/schema.js";
import { asUser, type Db } from "../db/user-scope.js";
import type { ReadUser } from "../read/model.js";

/** A user's rules and when they last changed them — the defaults, never changed, until they do. */
export interface StoredRules {
  settings: RuleSettings;
  /** Null until the user first changes a rule. */
  updatedAt: Date | null;
}

export interface RulesStore {
  get(user: ReadUser): Promise<StoredRules>;
  /** Settings must already be validated (`parseRuleSettings`). */
  set(user: ReadUser, settings: RuleSettings, at: Date): Promise<StoredRules>;
}

/**
 * Real accounts: one row per user. Reads run as the user, so RLS applies;
 * saves go through the privileged connection after the guard has verified who
 * is asking, like every other write.
 */
export function dbRulesStore(db: Db): RulesStore {
  return {
    async get(user) {
      const [row] = await asUser(db, user.authUserId, (tx) => tx.select().from(userRules));
      return row
        ? {
            settings: { handpickedTarget: row.handpickedTarget },
            updatedAt: row.updatedAt,
          }
        : { settings: DEFAULT_RULES, updatedAt: null };
    },
    async set(user, settings, at) {
      const values = { ...settings, updatedAt: at };
      await db
        .insert(userRules)
        .values({ userId: user.userId, ...values })
        .onConflictDoUpdate({ target: userRules.userId, set: values });
      const [row] = await db.select().from(userRules).where(eq(userRules.userId, user.userId));
      return {
        settings: { handpickedTarget: row!.handpickedTarget },
        updatedAt: row!.updatedAt,
      };
    },
  };
}

/** Stub mode: kept in memory, per user, for as long as the server runs. */
export function memoryRulesStore(): RulesStore {
  const saved = new Map<string, StoredRules>();
  return {
    async get(user) {
      return saved.get(user.userId) ?? { settings: DEFAULT_RULES, updatedAt: null };
    },
    async set(user, settings, at) {
      const stored = { settings, updatedAt: at };
      saved.set(user.userId, stored);
      return stored;
    },
  };
}
