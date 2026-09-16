import { integer, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  image: text("image"),
  emailVerified: timestamp("email_verified", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * The wall. Sign-in checks this table and nothing else — Google only proves who
 * someone is, never that they may come in (CLAUDE.md s3).
 */
export const allowlist = pgTable("allowlist", {
  email: text("email").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Someone who signed in with Google and wasn't on the allowlist. The email is
 * whatever Google verified, never free text typed into a form.
 */
export const waitlist = pgTable("waitlist", {
  email: text("email").primaryKey(),
  name: text("name"),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Auth.js tables below. Shapes are dictated by @auth/drizzle-adapter — don't
 * rename columns to match house style, the adapter queries them by name.
 */
export const accounts = pgTable(
  "accounts",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (account) => [primaryKey({ columns: [account.provider, account.providerAccountId] })],
);

/**
 * Server-side sessions. Auth.js rolls `expires` forward while someone is
 * active; `created_at` is ours, and caps the session at 7 days however active
 * they've been (docs/phases/phase-1.md). The cookie carries the token, never a
 * user id.
 */
export const sessions = pgTable("sessions", {
  sessionToken: text("session_token").primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  expires: timestamp("expires", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { withTimezone: true }).notNull(),
  },
  (vt) => [primaryKey({ columns: [vt.identifier, vt.token] })],
);
