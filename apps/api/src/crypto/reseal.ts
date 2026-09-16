import { eq, ne } from "drizzle-orm";
import type { SecretBox } from "./secrets.js";

/**
 * The context a credential's halves are sealed with. One definition, used by
 * every seal and open, so a value only ever opens in the row and column it was
 * written to.
 */
export function credentialContext(
  credential: { userId: string; provider: string; accountKind: string },
  field: "key" | "secret",
): string {
  return `user:${credential.userId}|${credential.provider}|${credential.accountKind}|${field}`;
}

export interface SealedCredential {
  id: string;
  userId: string;
  provider: string;
  accountKind: string;
  sealedKey: string;
  sealedSecret: string;
  keyVersion: number;
}

export interface ResealStore {
  /** Credentials not sealed with `currentVersion`. */
  stale(currentVersion: number): Promise<SealedCredential[]>;
  replace(id: string, sealedKey: string, sealedSecret: string, keyVersion: number): Promise<void>;
}

/**
 * Step 3 of the master key rotation runbook (ARCHITECTURE.md): open every
 * credential still sealed with an older key and seal it again with the current
 * one. Safe to run repeatedly — already-current rows aren't touched. Returns
 * counts only; never a key.
 */
export async function resealStaleCredentials(
  box: SecretBox,
  currentVersion: number,
  store: ResealStore,
): Promise<{ resealed: number; failed: number }> {
  let resealed = 0;
  let failed = 0;
  for (const credential of await store.stale(currentVersion)) {
    try {
      const key = box.open(credential.sealedKey, credentialContext(credential, "key"));
      const secret = box.open(credential.sealedSecret, credentialContext(credential, "secret"));
      await store.replace(
        credential.id,
        box.seal(key, credentialContext(credential, "key")),
        box.seal(secret, credentialContext(credential, "secret")),
        currentVersion,
      );
      resealed += 1;
    } catch {
      // One unreadable row mustn't stop the rest; the count says it happened.
      failed += 1;
    }
  }
  return { resealed, failed };
}

/** The Postgres side, on the privileged connection — sealed columns aren't readable any other way. */
export async function dbResealStore(): Promise<ResealStore> {
  const { getDb } = await import("../db/client.js");
  const { providerCredentials } = await import("../db/schema.js");
  const db = getDb();
  return {
    async stale(currentVersion) {
      return db
        .select({
          id: providerCredentials.id,
          userId: providerCredentials.userId,
          provider: providerCredentials.provider,
          accountKind: providerCredentials.accountKind,
          sealedKey: providerCredentials.sealedKey,
          sealedSecret: providerCredentials.sealedSecret,
          keyVersion: providerCredentials.keyVersion,
        })
        .from(providerCredentials)
        .where(ne(providerCredentials.keyVersion, currentVersion));
    },
    async replace(id, sealedKey, sealedSecret, keyVersion) {
      await db
        .update(providerCredentials)
        .set({ sealedKey, sealedSecret, keyVersion })
        .where(eq(providerCredentials.id, id));
    },
  };
}
