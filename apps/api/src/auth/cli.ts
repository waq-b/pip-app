/**
 * Allowlist admin: the only way anyone gets access.
 *
 *   pnpm --filter api allowlist list
 *   pnpm --filter api allowlist add someone@example.com
 *   pnpm --filter api allowlist remove someone@example.com
 *
 * Needs a real DATABASE_URL.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { normaliseEmail } from "./allowlist.js";

const [command, rawEmail] = process.argv.slice(2);

async function main() {
  const db = getDb();

  switch (command) {
    case "list": {
      const rows = await db.select().from(users).orderBy(users.email);
      if (rows.length === 0) {
        console.log("Allowlist is empty — nobody can get in.");
        return;
      }
      for (const row of rows) {
        const linked = row.authUserId ? "signed in" : "not yet signed in";
        console.log(`${row.email}\t${linked}\t${row.createdAt.toISOString()}`);
      }
      return;
    }

    case "add": {
      const email = requireEmail(rawEmail);
      await db.insert(users).values({ email }).onConflictDoNothing();
      console.log(`Allowed: ${email}`);
      return;
    }

    case "remove": {
      const email = requireEmail(rawEmail);
      // Takes effect on their very next request: the API checks the allowlist
      // every time, not once at sign-in.
      await db.delete(users).where(eq(users.email, email));
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
