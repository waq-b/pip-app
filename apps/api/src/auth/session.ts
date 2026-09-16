import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { sessions, users } from "../db/schema.js";
import { SESSION_ABSOLUTE_SECONDS } from "./config.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string | null;
}

/**
 * Looks a session cookie up. Returns null for anything that isn't a live
 * session, so callers can't accidentally treat "expired" as "signed in".
 *
 * It is an interface for the same reason the allowlist is: the route guard's
 * tests inject a fake and never open a socket.
 */
export interface SessionStore {
  find(token: string): Promise<SessionUser | null>;
}

/** Auth.js names the cookie itself; the prefix appears only on https. */
export function sessionCookieName(useSecureCookies: boolean): string {
  return useSecureCookies ? "__Secure-authjs.session-token" : "authjs.session-token";
}

export const dbSessionStore: SessionStore = {
  async find(token) {
    const rows = await getDb()
      .select({
        expires: sessions.expires,
        createdAt: sessions.createdAt,
        id: users.id,
        email: users.email,
        name: users.name,
      })
      .from(sessions)
      .innerJoin(users, eq(users.id, sessions.userId))
      .where(eq(sessions.sessionToken, token))
      .limit(1);

    const row = rows[0];
    if (!row) return null;

    return isLive(row.expires, row.createdAt)
      ? { id: row.id, email: row.email, name: row.name }
      : null;
  },
};

/**
 * Two clocks: Auth.js rolls `expires` forward while you're active, and
 * `created_at` caps the whole session at 7 days however active you are
 * (docs/phases/phase-1.md).
 */
export function isLive(expires: Date, createdAt: Date, now: Date = new Date()): boolean {
  if (expires.getTime() <= now.getTime()) return false;
  const absoluteDeadline = createdAt.getTime() + SESSION_ABSOLUTE_SECONDS * 1000;
  return now.getTime() < absoluteDeadline;
}

/** In-memory store for tests. */
export function memorySessionStore(entries: Record<string, SessionUser> = {}): SessionStore {
  return {
    find: async (token) => entries[token] ?? null,
  };
}
