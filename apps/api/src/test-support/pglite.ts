import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as schema from "../db/schema.js";
import type { Db } from "../db/user-scope.js";

/**
 * A real Postgres, in-process, with our real migrations applied — for tests
 * that need Row Level Security to actually run. No network, no Supabase
 * (CLAUDE.md hard line 7).
 *
 * Supabase provides the `anon` and `authenticated` roles and `auth.uid()`; this
 * recreates just those, with `auth.uid()` reading the JWT claims the same way.
 */
export async function testDatabase(): Promise<{ db: Db; client: PGlite }> {
  const client = new PGlite();
  await client.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(
        coalesce(
          nullif(current_setting('request.jwt.claim.sub', true), ''),
          nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'
        ), ''
      )::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);

  const dir = resolve(import.meta.dirname, "../../drizzle");
  const journal = JSON.parse(readFileSync(resolve(dir, "meta/_journal.json"), "utf8")) as {
    entries: { tag: string }[];
  };
  for (const { tag } of journal.entries) {
    const sqlText = readFileSync(resolve(dir, `${tag}.sql`), "utf8");
    for (const statement of sqlText.split("--> statement-breakpoint")) {
      if (statement.trim()) await client.exec(statement);
    }
  }
  // Every migration file must be in the journal, or the dev database and this one would differ.
  const files = readdirSync(dir).filter((file) => file.endsWith(".sql")).length;
  if (files !== journal.entries.length) throw new Error("A migration file isn't in the journal");

  return { db: drizzle(client, { schema }) as unknown as Db, client };
}
