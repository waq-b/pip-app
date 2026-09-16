import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

/**
 * The allowlist, and the only record of who may use Pip (CLAUDE.md s3).
 *
 * Supabase Auth proves who someone is; a row here is what lets them in. Rows are
 * added by hand, keyed by email, before the person ever signs in.
 * `auth_user_id` links the row to Supabase's `auth.users` the first time they
 * do — a plain uuid column rather than a foreign key, so our migrations never
 * reach into the `auth` schema Supabase owns.
 */
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  authUserId: uuid("auth_user_id").unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Someone who signed in and wasn't on the allowlist. The email comes from their
 * verified Supabase token, never from anything they typed. Being here grants
 * nothing.
 */
export const waitlist = pgTable("waitlist", {
  email: text("email").primaryKey(),
  name: text("name"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
});
