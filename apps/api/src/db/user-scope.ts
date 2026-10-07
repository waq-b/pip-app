import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import type * as schema from "./schema.js";

// Any Drizzle Postgres database: node-postgres in the server, PGlite in tests.
export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export type UserTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `work` as the signed-in user, so Row Level Security decides what it can
 * see (the second wall behind the API — docs/ARCHITECTURE.md).
 *
 * Inside one transaction it sets the verified Supabase user id as the JWT
 * claims Supabase's `auth.uid()` reads, then drops to the `authenticated`
 * role. Both are **transaction-local** (`set_config(…, true)`, `SET LOCAL`), so
 * nothing survives into the next request on a pooled connection.
 *
 * `authUserId` must come from a verified token (`request.authUser`), never from
 * anything a client sent.
 */
export async function asUser<T>(
  db: Db,
  authUserId: string,
  work: (tx: UserTx) => Promise<T>,
): Promise<T> {
  if (!UUID.test(authUserId)) throw new Error("asUser needs a verified Supabase user id");

  return db.transaction(async (tx) => {
    const claims = JSON.stringify({ sub: authUserId, role: "authenticated" });
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);
    await tx.execute(sql`set local role authenticated`);
    return work(tx);
  });
}
