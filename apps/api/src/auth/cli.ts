/**
 * Allowlist admin: the only way anyone gets access.
 *
 *   pnpm --filter api allowlist list
 *   pnpm --filter api allowlist add someone@example.com
 *   pnpm --filter api allowlist remove someone@example.com
 *   pnpm --filter api allowlist personal someone@example.com on|off
 *
 * Needs a real DATABASE_URL.
 */
import { eq } from "drizzle-orm";
import { getDb } from "../db/client.js";
import { users } from "../db/schema.js";
import { normaliseEmail } from "./allowlist.js";

const [command, rawEmail, rawSwitch] = process.argv.slice(2);

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
        const research = row.personalResearch ? "personal research" : "general research";
        console.log(`${row.email}\t${linked}\t${research}\t${row.createdAt.toISOString()}`);
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

    case "personal": {
      // Personalised research (Phase 5): nudges written for this person's own
      // plan. Everyone else gets general notes (hard line 12). Only here, never
      // through the API.
      const email = requireEmail(rawEmail);
      if (rawSwitch !== "on" && rawSwitch !== "off") {
        console.error("Say on or off: allowlist personal <email> on|off");
        process.exitCode = 1;
        return;
      }
      const updated = await db
        .update(users)
        .set({ personalResearch: rawSwitch === "on" })
        .where(eq(users.email, email))
        .returning({ email: users.email });
      if (updated.length === 0) {
        console.error(`Not on the allowlist: ${email}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Personal research ${rawSwitch}: ${email}`);
      return;
    }

    default:
      console.error("Usage: allowlist <list|add|remove|personal> [email] [on|off]");
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
