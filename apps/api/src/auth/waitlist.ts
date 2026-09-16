import { getDb } from "../db/client.js";
import { waitlist } from "../db/schema.js";
import { normaliseEmail } from "./allowlist.js";

/**
 * Being on the waiting list grants nothing — it's a note that someone asked.
 * Access still comes from the allowlist, by hand.
 */
export interface WaitlistStore {
  add(email: string, name?: string): Promise<void>;
}

export const dbWaitlistStore: WaitlistStore = {
  async add(email, name) {
    await getDb()
      .insert(waitlist)
      .values({ email: normaliseEmail(email), name: name ?? null })
      // Asking twice is not an error, and must not overwrite the first ask.
      .onConflictDoNothing();
  },
};

export function memoryWaitlistStore(): WaitlistStore & {
  entries: Map<string, string | undefined>;
} {
  const entries = new Map<string, string | undefined>();
  return {
    entries,
    async add(email, name) {
      const key = normaliseEmail(email);
      if (!entries.has(key)) entries.set(key, name);
    },
  };
}
