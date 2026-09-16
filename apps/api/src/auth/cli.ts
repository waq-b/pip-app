/**
 * Allowlist admin: the only way anyone gets access.
 *
 *   pnpm --filter api allowlist list
 *   pnpm --filter api allowlist add someone@example.com
 *   pnpm --filter api allowlist remove someone@example.com
 *
 * Needs a real DATABASE_URL — it is the one part of auth that talks to Postgres
 * directly rather than through Auth.js.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { allowlist } from "../db/schema.js";
import { normaliseEmail } from "./allowlist.js";

const [command, rawEmail] = process.argv.slice(2);

async function main() {
  const db = getDb();

  switch (command) {
    case "list": {
      const rows = await db.select().from(allowlist).orderBy(allowlist.email);
      if (rows.length === 0) {
        console.log("Allowlist is empty — nobody can sign in.");
        return;
      }
      for (const row of rows) {
        console.log(`${row.email}\t${row.createdAt.toISOString()}`);
      }
      return;
    }

    case "add": {
      const email = requireEmail(rawEmail);
      await db.insert(allowlist).values({ email }).onConflictDoNothing();
      console.log(`Allowed: ${email}`);
      return;
    }

    case "remove": {
      const email = requireEmail(rawEmail);
      // Existing sessions stay alive until they expire; removing an address
      // only stops the next sign-in.
      await db.delete(allowlist).where(eq(allowlist.email, email));
      console.log(`Removed: ${email}`);
      return;
    }

    default:
      console.error("Usage: allowlist <list|add|remove> [email]");
      process.exitCode = 1;
  }
}

function requireEmail(value: string | undefined): string {
  if (!value) {
    console.error("An email address is required.");
    process.exit(1);
  }
  return normaliseEmail(value);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
