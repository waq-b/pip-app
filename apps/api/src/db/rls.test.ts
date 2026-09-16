import { is } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as schema from "./schema.js";

/**
 * The frontend ships Supabase's public anon key, and Supabase's REST API exposes
 * tables in `public` to it. A table without Row Level Security switched on is
 * readable by anyone. So every table in our schema must have RLS enabled in a
 * migration — checked here, so a new table can't forget.
 */
const tables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableConfig(table).name);

const migrationsDir = resolve(__dirname, "../../drizzle");
const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => readFileSync(resolve(migrationsDir, file), "utf8"))
  .join("\n");

describe("Row Level Security", () => {
  it("found the tables, rather than passing vacuously", () => {
    expect(tables.length).toBeGreaterThanOrEqual(2);
  });

  it.each(tables)("is switched on for %s", (table) => {
    expect(migrations).toContain(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`);
  });
});

/**
 * A table that holds one user's data must say whose rows a signed-in user may
 * read — otherwise the second wall is either shut to everyone (harmless, but a
 * route running as that user would see nothing) or, worse, someone later adds
 * a blanket grant. Tables with a `user_id` column are user-owned by definition.
 */
const userOwned = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((table) => getTableConfig(table))
  .filter((config) => config.columns.some((column) => column.name === "user_id"))
  .map((config) => config.name);

describe("user-owned tables", () => {
  it("found them", () => {
    expect(userOwned).toEqual(
      expect.arrayContaining([
        "provider_credentials",
        "holdings",
        "cash",
        "trades",
        "daily_values",
      ]),
    );
  });

  it.each(userOwned)("limit %s to the signed-in user's own rows", (table) => {
    // Policies may be altered by later migrations, so the latest statement for
    // the table decides, and it must use the helper in the unexposed schema.
    const statements = [
      ...migrations.matchAll(
        new RegExp(
          `(?:CREATE|ALTER) POLICY "[^"]+" ON "${table}"[^;]*USING \\("user_id" = (\\w+)\\.current_app_user_id\\(\\)\\)`,
          "g",
        ),
      ),
    ];
    expect(statements.length).toBeGreaterThan(0);
    expect(statements.at(-1)![1]).toBe("private");
    const policy = new RegExp(
      `CREATE POLICY "[^"]+" ON "${table}" FOR SELECT TO authenticated\\s+USING \\("user_id" = (public|private)\\.current_app_user_id\\(\\)\\)`,
    );
    expect(migrations).toMatch(policy);
  });

  it("never grants the sealed credential columns to signed-in users", () => {
    const grant = migrations.match(/GRANT SELECT \(([^)]*)\)\s+ON "provider_credentials"/);
    expect(grant).not.toBeNull();
    expect(grant![1]).not.toMatch(/sealed_/);
    // Any other grant touching the table must also name columns, never the whole table.
    const grants = migrations
      .split(";")
      .filter(
        (statement) => /\bGRANT\b/.test(statement) && statement.includes('"provider_credentials"'),
      );
    for (const statement of grants) expect(statement).toMatch(/GRANT SELECT \(/);
  });
});
