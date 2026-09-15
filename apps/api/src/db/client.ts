import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

/**
 * Lazy singleton: no socket is opened until a caller actually runs a query.
 * Keeps `DATABASE_URL` out of the import graph for anything that never touches the DB —
 * tests and stub-mode routes included.
 */
export function getDb() {
  if (!db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is not set");
    }
    const pool = new Pool({ connectionString });
    db = drizzle(pool, { schema });
  }
  return db;
}
