import { and, eq, isNull } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema.js";

/**
 * The wall behind the wall (CLAUDE.md hard line 4). A verified token proves who
 * someone is; a row in `users` is what lets them in.
 *
 * An interface so tests inject a fake and never open a socket.
 */
export interface AllowedUser {
  id: string;
  email: string;
  authUserId: string | null;
  /** Personalised research (Phase 5), set only by the allowlist command. */
  personalResearch: boolean;
}

export interface AllowlistStore {
  find(email: string): Promise<AllowedUser | null>;
  /**
   * Links an allowlisted row to their Supabase identity the first time they
   * arrive. Never overwrites an existing link.
   */
  linkAuthUser(id: string, authUserId: string): Promise<void>;
}

/** Compared case-insensitively and trimmed; providers send emails as typed. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const dbAllowlistStore: AllowlistStore = {
  async find(email) {
    const rows = await getDb()
      .select({
        id: users.id,
        email: users.email,
        authUserId: users.authUserId,
        personalResearch: users.personalResearch,
      })
      .from(users)
      .where(eq(users.email, normaliseEmail(email)))
      .limit(1);
    return rows[0] ?? null;
  },

  async linkAuthUser(id, authUserId) {
    await getDb()
      .update(users)
      .set({ authUserId })
      .where(and(eq(users.id, id), isNull(users.authUserId)));
  },
};

/** In-memory store for tests. Never used in production. */
export function memoryAllowlistStore(emails: string[] = []): AllowlistStore & {
  rows: Map<string, AllowedUser>;
} {
  const rows = new Map<string, AllowedUser>(
    emails.map((email, index) => {
      const key = normaliseEmail(email);
      return [
        key,
        { id: `user-${index + 1}`, email: key, authUserId: null, personalResearch: false },
      ];
    }),
  );

  return {
    rows,
    find: async (email) => rows.get(normaliseEmail(email)) ?? null,
    linkAuthUser: async (id, authUserId) => {
      for (const row of rows.values()) {
        if (row.id === id && row.authUserId === null) row.authUserId = authUserId;
      }
    },
  };
}
