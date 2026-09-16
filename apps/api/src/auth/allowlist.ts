import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { allowlist } from "../db/schema.js";

/**
 * The wall (CLAUDE.md hard line 4). Google only proves who someone is; this
 * decides whether they may come in.
 *
 * It is an interface so tests can inject a fake and never open a socket — the
 * database implementation is the only thing that touches Postgres.
 */
export interface AllowlistStore {
  isAllowed(email: string): Promise<boolean>;
}

/** Emails are compared case-insensitively and trimmed; Google sends them as typed. */
export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

export const dbAllowlistStore: AllowlistStore = {
  async isAllowed(email) {
    const rows = await getDb()
      .select({ email: allowlist.email })
      .from(allowlist)
      .where(eq(allowlist.email, normaliseEmail(email)))
      .limit(1);
    return rows.length > 0;
  },
};

/** In-memory store for tests and local experiments. Never used in production. */
export function memoryAllowlistStore(emails: string[] = []): AllowlistStore {
  const set = new Set(emails.map(normaliseEmail));
  return {
    isAllowed: async (email) => set.has(normaliseEmail(email)),
  };
}
