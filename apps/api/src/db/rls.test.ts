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
